/**
 * @jest-environment node
 */

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
// payload/token crypto: any 64-hex key works in tests
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
// app.js (imported transitively by the lib modules below) calls
// initializeApp() with no args, which reads the default bucket from
// FIREBASE_CONFIG — set it before those imports run so storage.bucket()
// resolves to the same emulator bucket this test uses directly.
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

const { randomUUID } = require("crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const {
  promoteToQueue,
  METADATA_KEPT_FAILURE_REASON,
  INTERRUPTED_UPLOAD_FAILURE_REASON,
} = require("../../lib/scheduled-pending-recovery.js");
const { persistPending } = require("../../lib/persist-pending.js");
// The expected path comes from the layout module rather than being spelled
// out here: this suite's job is to prove recovery agrees with the Psych-DS
// layout, not to re-assert the flattening rules (metadata-derived-files.test
// pins those). Hardcoding the encoding here is what silently went stale when
// the flattening changed.
const { uploadPathFor } = require("../../lib/metadata-derived-files.js");

jest.setTimeout(30000);

const db = getFirestore();
const bucket = getStorage().bucket();

async function seedExperiment(experimentID, metadataActive) {
  await db.collection("experiments").doc(experimentID).set({
    active: true,
    metadataActive,
    owner: "recovery-test-user",
    osfFilesLink: "http://localhost:0/endpoint",
  });
}

// Only the docs THIS suite created. A collection-wide wipe here used to
// delete uploadQueue docs belonging to whatever suite was running in
// parallel (upload-queue.test.js, metadata-derived-upload-emulator,
// pending-recovery-provider-regression), which is half of the long-standing
// cross-suite flake -- the other half was the global pending-data sweep in
// pending-recovery-provider-regression.
const createdQueueDocIds = [];

afterEach(async () => {
  if (createdQueueDocIds.length === 0) return;
  const batch = db.batch();
  for (const docId of createdQueueDocIds) {
    batch.delete(db.collection("uploadQueue").doc(docId));
  }
  await batch.commit();
  createdQueueDocIds.length = 0;
});

describe("scheduled-pending-recovery layout awareness", () => {
  it("queues the raw-data path and matching dedup key when metadata is active", async () => {
    const experimentID = `recovery-test-metadata-on-${randomUUID()}`;
    await seedExperiment(experimentID, true);

    const storagePath = await persistPending(
      experimentID,
      "condition-A/data.json",
      "[]"
    );
    const file = bucket.file(storagePath);

    await promoteToQueue(file);

    const expectedFilename = uploadPathFor(true, "condition-A/data.json");
    const expectedDedupKey = `${experimentID}:${expectedFilename}`;
    const docId = expectedDedupKey.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    const doc = await db.collection("uploadQueue").doc(docId).get();

    expect(doc.exists).toBe(true);
    // Sanity-check the shape so a uploadPathFor that silently became identity
    // could not make this test pass vacuously.
    expect(expectedFilename).toMatch(/^data\/raw\/condition-A-data~[0-9a-f]{8}\.json$/);
    expect(doc.data().filename).toBe(expectedFilename);
    expect(doc.data().deduplicationKey).toBe(expectedDedupKey);
  });

  it("queues the original filename and matching dedup key when metadata is off", async () => {
    const experimentID = `recovery-test-metadata-off-${randomUUID()}`;
    await seedExperiment(experimentID, false);

    const storagePath = await persistPending(experimentID, "data.json", "[]");
    const file = bucket.file(storagePath);

    await promoteToQueue(file);

    const expectedDedupKey = `${experimentID}:data.json`;
    const docId = expectedDedupKey.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    const doc = await db.collection("uploadQueue").doc(docId).get();

    expect(doc.exists).toBe(true);
    expect(doc.data().filename).toBe("data.json");
    expect(doc.data().deduplicationKey).toBe(expectedDedupKey);
  });
});

// Regression coverage for the corruption bug: a pending envelope for a base64
// media upload (api-base64.ts) carries no data-type marker of its own, so
// promoteToQueue used to hardcode `dataType: "data"` on every recovered
// entry. scheduled-upload-retry.ts branches on that field to decide whether
// to base64-decode the cached payload before writing it -- stuck at "data",
// a recovered .webm/.png lands in the researcher's storage as base64 ASCII
// text, with no error anywhere. It also used to run every recovered file
// (base64 included) through uploadPathFor, which places it at data/raw/ for
// a metadata-active experiment -- a location the live base64 path
// (api-base64.ts) never uses, since it has no metadata block at all.
describe("scheduled-pending-recovery propagates the envelope's dataType", () => {
  it("promotes a base64 envelope with dataType: base64, and does NOT place it under data/raw/ even when metadata is active", async () => {
    const experimentID = `recovery-test-base64-${randomUUID()}`;
    // metadataActive: true is the crux of the path half of this regression --
    // a base64 upload must still land at the bare filename, not data/raw/.
    await seedExperiment(experimentID, true);

    const filename = "recording.webm";
    const base64Payload = Buffer.from("not really webm bytes, just a marker").toString("base64");

    const storagePath = await persistPending(
      experimentID,
      filename,
      base64Payload,
      "base64"
    );
    const file = bucket.file(storagePath);

    await promoteToQueue(file);

    // Base64 uploads are keyed on the bare filename (see api-base64.ts),
    // never on uploadPathFor's data/raw/ placement.
    const expectedDedupKey = `${experimentID}:${filename}`;
    const docId = expectedDedupKey.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    const doc = await db.collection("uploadQueue").doc(docId).get();

    expect(doc.exists).toBe(true);
    const data = doc.data();
    expect(data.dataType).toBe("base64");
    expect(data.filename).toBe(filename);
    expect(data.filename).not.toMatch(/^data\/raw\//);
    expect(data.deduplicationKey).toBe(expectedDedupKey);
  });

  it("promotes a legacy envelope with no dataType field as dataType: data", async () => {
    const experimentID = `recovery-test-legacy-${randomUUID()}`;
    await seedExperiment(experimentID, false);

    // Bypass persistPending's dataType parameter entirely to reproduce an
    // envelope written before this field existed. persistPending still
    // JSON.stringifies an envelope missing the key when dataType is
    // undefined (JSON.stringify drops undefined properties), which is
    // exactly this shape -- so this call is representative of every object
    // already sitting in pending-data/ before this fix shipped.
    const filename = "legacy-data.json";
    const storagePath = await persistPending(experimentID, filename, "[]");
    const file = bucket.file(storagePath);

    await promoteToQueue(file);

    const expectedDedupKey = `${experimentID}:${filename}`;
    const docId = expectedDedupKey.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    const doc = await db.collection("uploadQueue").doc(docId).get();

    expect(doc.exists).toBe(true);
    expect(doc.data().dataType).toBe("data");
  });
});

// keptReason threading: api-data.ts's METADATA_ERROR branch labels the
// pending object it keeps (persist-pending.ts's markPendingKept) so this
// promotion can tell "kept on purpose, no metadata" apart from the generic
// "something interrupted the request" case. recoverPendingUploads reads the
// label off the SAME getMetadata() call it already makes for the staleness
// check and passes it through as promoteToQueue's second, optional
// parameter -- these tests exercise that parameter and, separately, prove
// the storage emulator actually round-trips the custom metadata
// markPendingKept writes (recoverPendingUploads' classification depends on
// that read succeeding).
describe("scheduled-pending-recovery threads keptReason into the promoted failureReason", () => {
  it("promotes with METADATA_KEPT_FAILURE_REASON when the pending object carries keptReason: metadata-failure", async () => {
    const experimentID = `recovery-test-metadata-kept-${randomUUID()}`;
    await seedExperiment(experimentID, false);

    const filename = "kept-after-metadata.json";
    const storagePath = await persistPending(experimentID, filename, "[]");
    const file = bucket.file(storagePath);

    // Simulate persist-pending.ts's markPendingKept -- the exact same
    // setMetadata call api-data.ts's METADATA_ERROR branch triggers.
    await file.setMetadata({ metadata: { keptReason: "metadata-failure" } });

    // Round-trip proof: the storage emulator DOES preserve custom metadata
    // written this way -- confirmed here rather than assumed, since
    // recoverPendingUploads' whole classification depends on this read
    // returning what was written.
    const [metadata] = await file.getMetadata();
    expect(metadata.metadata).toEqual(
      expect.objectContaining({ keptReason: "metadata-failure" })
    );

    await promoteToQueue(file, metadata.metadata?.keptReason);

    const expectedDedupKey = `${experimentID}:${filename}`;
    const docId = expectedDedupKey.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    const doc = await db.collection("uploadQueue").doc(docId).get();

    expect(doc.exists).toBe(true);
    expect(doc.data().failureReason).toBe(METADATA_KEPT_FAILURE_REASON);
  });

  it("promotes with the generic INTERRUPTED_UPLOAD_FAILURE_REASON when the pending object carries no keptReason", async () => {
    const experimentID = `recovery-test-generic-reason-${randomUUID()}`;
    await seedExperiment(experimentID, false);

    const filename = "no-keptreason.json";
    const storagePath = await persistPending(experimentID, filename, "[]");
    const file = bucket.file(storagePath);

    // No markPendingKept call here -- every pending object persisted before
    // that existed, and every one persisted by a request that never reached
    // a labeling branch, looks like this.
    await promoteToQueue(file);

    const expectedDedupKey = `${experimentID}:${filename}`;
    const docId = expectedDedupKey.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    const doc = await db.collection("uploadQueue").doc(docId).get();

    expect(doc.exists).toBe(true);
    expect(doc.data().failureReason).toBe(INTERRUPTED_UPLOAD_FAILURE_REASON);
  });
});
