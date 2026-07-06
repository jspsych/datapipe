/**
 * @jest-environment node
 */

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
// app.js (imported transitively by the lib modules below) calls
// initializeApp() with no args, which reads the default bucket from
// FIREBASE_CONFIG — set it before those imports run so storage.bucket()
// resolves to the same emulator bucket this test uses directly.
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { promoteToQueue } = require("../../lib/scheduled-pending-recovery.js");
const { persistPending } = require("../../lib/persist-pending.js");

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

afterEach(async () => {
  const docs = await db.collection("uploadQueue").get();
  const batch = db.batch();
  docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
});

describe("scheduled-pending-recovery layout awareness", () => {
  it("queues the raw-data path and matching dedup key when metadata is active", async () => {
    const experimentID = "recovery-test-metadata-on";
    await seedExperiment(experimentID, true);

    const storagePath = await persistPending(
      experimentID,
      "condition-A/data.json",
      "[]"
    );
    const file = bucket.file(storagePath);

    await promoteToQueue(file);

    const expectedDedupKey = `${experimentID}:data/raw/condition-A-data.json`;
    const docId = expectedDedupKey.replace(/[/\\]/g, "_");
    const doc = await db.collection("uploadQueue").doc(docId).get();

    expect(doc.exists).toBe(true);
    expect(doc.data().filename).toBe("data/raw/condition-A-data.json");
    expect(doc.data().deduplicationKey).toBe(expectedDedupKey);
  });

  it("queues the original filename and matching dedup key when metadata is off", async () => {
    const experimentID = "recovery-test-metadata-off";
    await seedExperiment(experimentID, false);

    const storagePath = await persistPending(experimentID, "data.json", "[]");
    const file = bucket.file(storagePath);

    await promoteToQueue(file);

    const expectedDedupKey = `${experimentID}:data.json`;
    const docId = expectedDedupKey.replace(/[/\\]/g, "_");
    const doc = await db.collection("uploadQueue").doc(docId).get();

    expect(doc.exists).toBe(true);
    expect(doc.data().filename).toBe("data.json");
    expect(doc.data().deduplicationKey).toBe(expectedDedupKey);
  });
});
