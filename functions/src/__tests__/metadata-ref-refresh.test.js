/**
 * @jest-environment node
 */

// metadata-block.ts's performUpdate used to DISCARD the WriteResult its
// provider.updateFile call returned, so the metadataFileRef stored on the
// metadata doc was written once and never refreshed. That is invisible on OSF
// and Drive, whose updateFile edits in place and echoes the same ref back --
// but Dataverse's is DELETE + re-add, and the re-added file gets a brand-new
// id. Firestore was left pointing at a file that had just been deleted, so
// every later submission 404'd on update and self-healed by creating another
// dataset_description.json, which Dataverse silently renames rather than
// rejecting: one orphaned dataset_description-N.json per submission, with the
// canonical file never updated again.
//
// The only mock-provider harness in this suite (metadata-ref-emulator.test.js)
// speaks OSF, whose adapter returns `existingFileRef` unconditionally and so
// cannot express a ref change at all. This drives blockMetadata directly
// instead, against a fake adapter registered under the one StorageProviderId
// with no real adapter behind it ("figshare"), which lets updateFile return
// whatever ref the case under test needs.

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "datapipe-test";
// payload/token crypto: any 64-hex key works in tests
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

// Every adapter imports node-fetch at module scope, and it is ESM-only.
// Nothing here makes a provider HTTP call -- the fake adapter below stands in
// for all of them -- so a bare stub is enough. Same convention as
// providers-*.test.js.
jest.mock("node-fetch", () => ({ __esModule: true, default: jest.fn() }));

jest.setTimeout(30000);

const sampleData = `[{"trial_type":"html-keyboard-response","trial_index":1,"time_elapsed":776}]`;

// updateMetadata (real, unmocked) reads `variableMeasured` and throws
// "Invalid metadata format" on anything else, so seeded metadata must have
// this shape or these tests would fail for an unrelated reason.
const existingMetadata = { variableMeasured: [{ name: "existing_var" }] };

let db;
let blockMetadata;
let fake;

// Mutable per test: what the fake adapter's updateFile hands back.
let updateResult;
const updateCalls = [];

beforeAll(async () => {
  const app = initializeApp({ projectId: "datapipe-test" }, "metadata-ref-refresh-test");
  db = getFirestore(app);

  // Dynamic imports, deferred until after the process.env assignments above.
  // These are the COMPILED modules (functions/lib/), so `npm run build` must
  // run first -- same seam as upload-queue.test.js.
  const { registerProvider } = await import("../../lib/providers/index.js");
  ({ default: blockMetadata } = await import("../../lib/metadata-block.js"));

  fake = {
    id: "figshare",
    authMethod: "static-token",
    capabilities: { nativeSubfolders: false, supportsRegion: false, maxFileSizeBytes: null, quotaNote: null },
    containerInput: [],
    async resolveToken() {
      return { success: true, token: "t" };
    },
    async createDataContainer() {
      throw new Error("not used");
    },
    async writeSessionFile(_auth, _container, filename) {
      return { success: true, fileRef: { name: filename, id: `created-${randomUUID()}` }, storedFilename: filename };
    },
    async updateFile(_auth, _container, existingFileRef) {
      updateCalls.push(existingFileRef);
      return updateResult;
    },
    async listFiles() {
      return [];
    },
    async downloadFile() {
      return { success: true, content: "{}" };
    },
  };
  registerProvider(fake);
});

beforeEach(() => {
  updateCalls.length = 0;
});

// blockMetadata reads and writes through app.js's default Firestore instance,
// so the doc ref handed to it has to come from that same instance. Reading it
// back through this suite's own named app is fine -- both point at the same
// emulator.
async function seedAndRun({ storedRef }) {
  const experimentID = `metadata-ref-refresh-${randomUUID()}`;
  const { db: prodDb } = await import("../../lib/app.js");
  const metadataDocRef = prodDb.collection("metadata").doc(experimentID);

  await metadataDocRef.set({ metadata: existingMetadata, metadataFileRef: storedRef });

  const expData = {
    active: true,
    metadataActive: true,
    owner: "metadata-ref-refresh-owner",
    storageProvider: "figshare",
    providerContainer: { provider: "figshare", articleId: 1 },
  };

  const result = await blockMetadata(
    expData,
    { token: "t" },
    metadataDocRef,
    sampleData,
    "session-1.json",
    {}
  );

  const after = (await db.collection("metadata").doc(experimentID).get()).data();
  return { result, after, experimentID };
}

describe("performUpdate persists a ref the provider replaced", () => {
  it("stores the NEW file id when updateFile returns a different one (Dataverse's delete + re-add)", async () => {
    updateResult = {
      success: true,
      fileRef: { name: "dataset_description.json", id: "55" },
      storedFilename: "dataset_description.json",
    };

    const { result, after } = await seedAndRun({
      storedRef: { id: "42", name: "dataset_description.json" },
    });

    expect(result.success).toBe(true);
    // The update was attempted against the ref that was stored...
    expect(updateCalls).toEqual([{ id: "42", name: "dataset_description.json" }]);
    // ...and the doc now points at the file that actually exists.
    expect(after.metadataFileRef).toEqual({ name: "dataset_description.json", id: "55" });
  });

  it("leaves the stored ref alone when updateFile echoes it back unchanged (OSF/Drive)", async () => {
    const sameRef = { id: "42", name: "dataset_description.json" };
    updateResult = { success: true, fileRef: sameRef, storedFilename: "dataset_description.json" };

    const { result, after } = await seedAndRun({ storedRef: sameRef });

    expect(result.success).toBe(true);
    expect(after.metadataFileRef).toEqual(sameRef);
  });

  // Same guard as createMetadataFile's: a ref with no usable id is something
  // no future update could address, so it must not overwrite a good one.
  it("does not overwrite the stored ref with one that carries no id", async () => {
    updateResult = {
      success: true,
      fileRef: { name: "dataset_description.json" },
      storedFilename: "dataset_description.json",
    };

    const { after } = await seedAndRun({ storedRef: { id: "42", name: "dataset_description.json" } });

    expect(after.metadataFileRef).toEqual({ id: "42", name: "dataset_description.json" });
  });
});

describe("CONTENTION is not self-healed", () => {
  // Dataverse is both the provider that emits CONTENTION and the one whose
  // updateFile is delete-then-re-add, so a collision means the re-add lost a
  // race. Re-creating the file immediately is a THIRD write into the same
  // still-contended container, which loses the same race and takes the
  // submission down with it. Failing straight out leaves the stale ref for a
  // later submission to self-heal from, once the container is quiet.
  it("fails the block instead of immediately re-creating the metadata file", async () => {
    updateResult = {
      success: false,
      error: "CONTENTION",
      providerStatus: 400,
      providerMessage: "Failed to add file to dataset.",
    };

    const writeSpy = jest.spyOn(fake, "writeSessionFile");

    const { result } = await seedAndRun({ storedRef: { id: "42", name: "dataset_description.json" } });

    expect(result.success).toBe(false);
    // No re-create attempt -- the self-heal branch was not taken.
    expect(writeSpy).not.toHaveBeenCalled();

    writeSpy.mockRestore();
  });

  it("still self-heals a stale ref, which is what the branch is for", async () => {
    updateResult = {
      success: false,
      error: "UNAVAILABLE",
      providerStatus: 404,
      providerMessage: "File not found",
    };

    const writeSpy = jest.spyOn(fake, "writeSessionFile");

    const { result } = await seedAndRun({ storedRef: { id: "gone", name: "dataset_description.json" } });

    expect(result.success).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "dataset_description.json",
      expect.any(String),
      expect.anything()
    );

    writeSpy.mockRestore();
  });
});
