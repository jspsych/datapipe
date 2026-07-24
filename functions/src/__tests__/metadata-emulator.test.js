/**
 * @jest-environment node
 */

// Rewritten for step 3b (docs/provider-migration-design.md,
// scratchpad/step3b-metadata-ref-spec.md).
//
// The original `runTransaction` block simulated OSF metadata-file
// presence/absence by flipping a single shared test user's osfToken
// validity, which flipped mock-server.ts's fixed GET /endpoint response
// between "has dataset_description.json" and "doesn't" (see
// mock-server.ts's `bearerInvalid` branch). metadata-block.ts no longer
// lists the provider folder on every request -- presence/absence is now
// read from the metadataFileRef stored on the metadata doc -- so that
// token-validity trick no longer produces the scenario it used to.
//
// This rewrite seeds metadataFileRef directly (a ref object, or explicit
// null) instead of toggling token validity, and replaces mock-server.ts
// (which defines no PUT route at all -- see below) with a real inline
// mock OSF server, following the pattern already established in
// metadata-ref-emulator.test.js.
//
// Notably, mock-server.ts's complete absence of a PUT route means the two
// "not in OSF" scenarios in the original file (METADATA_NOT_IN_FIRESTORE_OR_OSF
// and METADATA_IN_FIRESTORE_NOT_IN_OSF) could only reach putFileOSF via a 404
// from the mock. In the METADATA_IN_FIRESTORE_NOT_IN_OSF case this fed
// straight into the (now-removed) `status !== 210` bug in metadata-block.ts:
// the create branch always threw, and the request as a whole FAILED --
// but the old test only asserted `response.metadataMessage`, never
// `response.success` or the HTTP status, so the failure was invisible. That
// gap is exactly how the 210 bug survived undetected; each rewritten test
// below asserts the HTTP status alongside metadataMessage to close it.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";
import MESSAGES from "../../lib/api-messages.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

jest.setTimeout(30000);

const config = {
  projectId: "datapipe-test",
};

const OWNER_ID = "metadata-matrix-owner";

async function saveData(body) {
  const response = await fetch(
    "http://localhost:5001/datapipe-test/us-central1/apidata",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body: JSON.stringify(body),
    }
  );
  const message = await response.json();
  return { status: response.status, body: message };
}

const sampleData = `[{
  "trial_type": "html-keyboard-response",
  "trial_index": 1,
  "time_elapsed": 776
}]`;

// A valid Psych-DS-shaped metadata object. metadata-update.ts's
// updateMetadata (real, unmocked) requires `variableMeasured`, and
// metadata-download.ts's downloadMetadata additionally requires the full
// Psych-DS field set -- both throw "Invalid ..." otherwise, which would fail
// these tests for the wrong reason (an unrelated throw, not the scenario
// under test).
const existingMetadata = { variableMeasured: [{ name: "existing_var" }] };
const downloadedMetadata = {
  name: "test-dataset",
  schemaVersion: "Psych-DS 0.4.0",
  "@context": "https://schema.org",
  "@type": "Dataset",
  description: "test dataset for download",
  author: [{ name: "tester" }],
  variableMeasured: [{ name: "downloaded_var" }],
};

// A minimal, self-contained mock OSF "files" container, following the
// pattern established in metadata-ref-emulator.test.js:
//   GET  /files      -> osfProvider.listFiles (collision-cache rehydration
//                        only in this file -- metadataFileRef is always
//                        seeded explicitly below, so metadata-block.ts's
//                        legacy-discovery listing never fires)
//   GET  /files/:id  -> metadata-download.ts's downloadMetadata
//   PUT  /files      -> create (putFileOSF / writeSessionFile)
//   PUT  /files/:id  -> update (updateFileOSF / updateFile)
// mock-server.ts defines none of the PUT routes this needs, and is left
// untouched -- nothing else in the repo still imports it after this file
// stops doing so.
function createMockOSFServer() {
  const app = express();
  let nextId = 1;
  let nextFolderId = 1;
  const createCallsByFilename = new Map();
  const updateCallsById = new Map();

  // Handles both a file create (kind=file, the pre-existing behavior) and a
  // folder create (kind=folder). The latter is new: now that a
  // metadata-active raw file uploads under data/raw/ (Psych-DS layout),
  // subfolder.ts's resolveFolder needs to walk/create that path, and its
  // folder-create step requires a WaterButler-shaped `data.links.move` in the
  // response (see subfolder.ts) -- without it resolveFolder throws and the
  // raw upload gets queued instead of succeeding. The shape mirrors
  // put-file-osf.test.js's `folderCreated` helper.
  function handleFilesPut(req, res) {
    const filename = String(req.query.name || "");

    if (req.query.kind === "folder") {
      const moveLink = `${req.protocol}://${req.get("host")}/folder-${nextFolderId++}/`;
      res.status(201).json({ data: { links: { move: moveLink } } });
      return;
    }

    createCallsByFilename.set(filename, (createCallsByFilename.get(filename) || 0) + 1);
    const id = `mock-file-${nextId++}`;
    res.status(201).json({ data: { id, attributes: { name: filename, kind: "file" } } });
  }

  app.get("/files", (req, res) => {
    res.json({ data: [] });
  });

  app.get("/files/:id", (req, res) => {
    res.json(downloadedMetadata);
  });

  app.put("/files", handleFilesPut);

  app.put("/files/:id", (req, res) => {
    const id = req.params.id;
    updateCallsById.set(id, (updateCallsById.get(id) || 0) + 1);
    res.status(200).json({});
  });

  // Every folder resolveFolder creates gets its own `/folder-N/` path,
  // reused for both listing (always empty, so a multi-level path like
  // data/raw/ always creates fresh at each level) and the next level's
  // create/upload -- same behavior as the root /files route above.
  app.get("/folder-:n", (req, res) => {
    res.json({ data: [] });
  });

  app.put("/folder-:n", handleFilesPut);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        server,
        port: server.address().port,
        getCreateCount: (filename) => createCallsByFilename.get(filename) || 0,
        getUpdateCount: (id) => updateCallsById.get(id) || 0,
        // Every scenario below creates/updates a file literally named
        // "dataset_description.json", so counts must be reset between
        // tests -- otherwise a later test's assertion would include
        // creates/updates left over from an earlier one.
        resetCounts: () => {
          createCallsByFilename.clear();
          updateCallsById.clear();
        },
      });
    });
  });
}

let db;
let mockOSF;
let filesLink;

beforeAll(async () => {
  mockOSF = await createMockOSFServer();
  filesLink = `http://localhost:${mockOSF.port}/files/`;

  initializeApp(config);
  db = getFirestore();

  await db.collection("users").doc(OWNER_ID).set({
    osfTokenValid: true,
    osfToken: "valid",
    usingPersonalToken: true,
  });
});

afterEach(() => {
  mockOSF.resetCounts();
});

afterAll(async () => {
  mockOSF.server.close();
});

async function createExperiment(experimentID) {
  await db.collection("experiments").doc(experimentID).set({
    active: true,
    metadataActive: true,
    owner: OWNER_ID,
    osfFilesLink: filesLink,
  });
}

describe("runTransaction", () => {
  // Was: "should handle the case when metadata is present in OSF but not in
  // firestore", driven by an invalid osfToken flipping mock-server.ts's fixed
  // GET response to include a dataset_description.json entry. Now: a ref is
  // seeded directly and no firestore `metadata` field exists, which is the
  // same (metadataFileRef present, firestoreMetadata absent) pairing the old
  // test intended. Newly asserted: status/success -- the old test only
  // checked metadataMessage.
  it("should handle the case when metadata is present in OSF but not in firestore", async () => {
    const experimentID = `metadata-matrix1-${randomUUID()}`;
    const refId = `ref1-${randomUUID()}`;
    await createExperiment(experimentID);
    await db.collection("metadata").doc(experimentID).set({
      metadataFileRef: { id: refId, name: "dataset_description.json" },
    });

    const response = await saveData({
      experimentID,
      data: sampleData,
      filename: `matrix1-${randomUUID()}.json`,
    });

    expect(response.status).toBe(201);
    expect(response.body.metadataMessage).toEqual(MESSAGES.METADATA_IN_OSF_NOT_IN_FIRESTORE.metadataMessage);
    expect(mockOSF.getUpdateCount(refId)).toBe(1);
  });

  // Was: "should handle the case when metadata is neither in firestore nor
  // OSF", driven by an invalid osfToken. Now: metadataFileRef is explicitly
  // null (known absent -- this experiment's metadata doc was never
  // populated) and there's no firestore `metadata` field either. Newly
  // asserted: status/success, and that a create actually occurred.
  it("should handle the case when metadata is neither in firestore nor OSF", async () => {
    const experimentID = `metadata-matrix2-${randomUUID()}`;
    await createExperiment(experimentID);
    await db.collection("metadata").doc(experimentID).set({ metadataFileRef: null });

    const response = await saveData({
      experimentID,
      data: sampleData,
      filename: `matrix2-${randomUUID()}.json`,
    });

    expect(response.status).toBe(201);
    expect(response.body.metadataMessage).toEqual(MESSAGES.METADATA_NOT_IN_FIRESTORE_OR_OSF.metadataMessage);
    expect(mockOSF.getCreateCount("dataset_description.json")).toBe(1);
  });

  // Was: "should handle the case when metadata is in OSF and in firestore",
  // driven by a valid osfToken. Now: a ref plus firestore `metadata` are
  // both seeded directly. Newly asserted: status/success, and that the
  // ref'd file (not a fresh one) received the update.
  it("should handle the case when metadata is in OSF and in firestore", async () => {
    const experimentID = `metadata-matrix3-${randomUUID()}`;
    const refId = `ref3-${randomUUID()}`;
    await createExperiment(experimentID);
    await db.collection("metadata").doc(experimentID).set({
      metadata: existingMetadata,
      metadataFileRef: { id: refId, name: "dataset_description.json" },
    });

    const response = await saveData({
      experimentID,
      data: sampleData,
      filename: `matrix3-${randomUUID()}.json`,
    });

    expect(response.status).toBe(201);
    expect(response.body.metadataMessage).toEqual(MESSAGES.METADATA_IN_OSF_AND_FIRESTORE.metadataMessage);
    expect(mockOSF.getUpdateCount(refId)).toBe(1);
  });

  // Was: "should handle the case when metadata is not in OSF but is in
  // firestore", driven by an invalid osfToken. This is the scenario the
  // now-removed `status !== 210` bug always threw on: the old mock-server.ts
  // has no PUT route at all, so the create attempt 404'd, the buggy check
  // threw regardless, and the request FAILED end-to-end -- invisible to the
  // old test because it asserted only `metadataMessage`, which the catch
  // block still populated from the already-set-before-the-throw local
  // variable. With the bug removed and a real create route in place, this
  // now genuinely succeeds. Newly asserted: status 201 (was silently 400)
  // and that a create occurred.
  it("should handle the case when metadata is not in OSF but is in firestore", async () => {
    const experimentID = `metadata-matrix4-${randomUUID()}`;
    await createExperiment(experimentID);
    await db.collection("metadata").doc(experimentID).set({
      metadata: existingMetadata,
      metadataFileRef: null,
    });

    const response = await saveData({
      experimentID,
      data: sampleData,
      filename: `matrix4-${randomUUID()}.json`,
    });

    expect(response.status).toBe(201);
    expect(response.body.metadataMessage).toEqual(MESSAGES.METADATA_IN_FIRESTORE_NOT_IN_OSF.metadataMessage);
    expect(mockOSF.getCreateCount("dataset_description.json")).toBe(1);
  });
});
