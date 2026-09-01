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
const { promoteToQueue } = require("../../lib/scheduled-pending-recovery.js");
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
