/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import express from "express";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";

jest.setTimeout(30000);

const config = {
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
};

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

async function listPendingFiles(bucket, experimentID) {
  const [files] = await bucket.getFiles({
    prefix: `pending-data/${experimentID}/`,
  });
  return files;
}

const sampleData = `[{
  "trial_type": "html-keyboard-response",
  "trial_index": 1,
  "time_elapsed": 776
}]`;

let db;
let bucket;
let mockServerInstance;
let mockServerPort;

function createMockOSFServer() {
  const app = express();
  app.put("/endpoint", (req, res) => {
    res.status(201).json({ data: { attributes: { name: req.query.name || "uploaded.json" } } });
  });
  // Collision-cache rehydration lists the container on an experiment's first
  // write (see collision-cache.ts); an empty listing keeps this suite's
  // experiments cold-start-clean without changing what it tests.
  app.get("/endpoint", (req, res) => {
    res.json({ data: [] });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve(server);
    });
  });
}

beforeAll(async () => {
  mockServerInstance = await createMockOSFServer();
  mockServerPort = mockServerInstance.address().port;

  const app = initializeApp(config);
  db = getFirestore();
  bucket = getStorage(app).bucket();

  await db.collection("users").doc("persist-test-user").set({
    osfTokenValid: true,
    osfToken: "valid",
    usingPersonalToken: true,
  });

  await db.collection("experiments").doc("persist-test-exp").set({
    active: true,
    metadataActive: false,
    owner: "persist-test-user",
    osfFilesLink: `http://localhost:${mockServerPort}/endpoint`,
  });

  await db.collection("experiments").doc("persist-test-inactive").set({
    active: false,
    owner: "persist-test-user",
  });
});

afterAll(async () => {
  mockServerInstance.close();
});

// A second, dedicated mock server: the suite's main one (createMockOSFServer
// above) succeeds on every PUT unconditionally, which can never reach
// api-data.ts's METADATA_ERROR branch. This one fails only the
// dataset_description.json write (metadata-block.ts's createMetadataFile),
// so the RAW data write would still succeed if the handler ever reached it —
// isolating "metadata generation failed" from every other way a request can
// fail.
function createFailingMetadataMockServer() {
  const app = express();
  app.put("/endpoint", (req, res) => {
    if (req.query.name === "dataset_description.json") {
      res.status(500).json({ error: "mock metadata write failure" });
      return;
    }
    res.status(201).json({ data: { attributes: { name: req.query.name || "uploaded.json" } } });
  });
  app.get("/endpoint", (req, res) => {
    res.json({ data: [] });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve(server);
    });
  });
}

describe("early persist data loss prevention", () => {
  it("should clean up pending data after successful OSF upload", async () => {
    const result = await saveData({
      experimentID: "persist-test-exp",
      data: sampleData,
      filename: "test-persist-cleanup.json",
    });

    // The request should succeed
    expect(result.body.message).toEqual("Success");

    // After success, there should be no pending files for this experiment
    const pendingFiles = await listPendingFiles(bucket, "persist-test-exp");
    const matchingFiles = pendingFiles.filter((f) =>
      f.name.includes("test-persist-cleanup")
    );
    expect(matchingFiles.length).toBe(0);
  });

  it("should not persist data when validation fails before persist step", async () => {
    // Missing parameters should fail before the persist step
    const result = await saveData({
      experimentID: "persist-test-exp",
    });

    expect(result.body).toEqual(MESSAGES.MISSING_PARAMETER);

    // No pending files should exist since we failed before persist
    const pendingFiles = await listPendingFiles(bucket, "persist-test-exp");
    expect(pendingFiles.length).toBe(0);
  });

  it("should not persist data when experiment is inactive", async () => {
    const result = await saveData({
      experimentID: "persist-test-inactive",
      data: sampleData,
      filename: "test-inactive.json",
    });

    expect(result.body).toEqual(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);

    // No pending files since we fail before persist step
    const pendingFiles = await listPendingFiles(
      bucket,
      "persist-test-inactive"
    );
    expect(pendingFiles.length).toBe(0);
  });

  it("should handle multiple submissions without leaving pending files", async () => {
    // Submit multiple requests
    for (let i = 0; i < 3; i++) {
      await saveData({
        experimentID: "persist-test-exp",
        data: sampleData,
        filename: `test-multi-${i}.json`,
      });
    }

    // All pending files should be cleaned up
    const pendingFiles = await listPendingFiles(bucket, "persist-test-exp");
    expect(pendingFiles.length).toBe(0);
  });
});

// api-data.ts's METADATA_ERROR branch deliberately keeps the pending copy
// ("scheduled-pending-recovery salvages it later instead of losing it
// outright") and, since this change, labels it with markPendingKept so
// scheduled-pending-recovery.ts can later promote it with a reason that says
// "no Psych-DS metadata" instead of the generic OOM/restart wording. This is
// the one suite in this repo that drives a REAL METADATA_ERROR through the
// full HTTP handler (every other metadata suite asserts on the metadata
// block's own return value, never on api-data.ts's pending-copy side
// effect) -- extended here rather than creating a new suite.
//
// THE TWO-BUCKET GOTCHA (see payload-encryption-emulator.test.js's longer
// explanation, "THE TWO BUCKETS"): every OTHER test in this file only checks
// for ABSENCE of a pending object after calling `saveData` (the real HTTP
// call to the Functions emulator, a SEPARATE process from this jest file).
// Every one of those assertions passes VACUOUSLY under a bucket mismatch,
// because "no matching files" is also what you get when you list the wrong
// bucket entirely. Checking for PRESENCE, as this describe block does, is
// what actually exposed it: this file's top-level `bucket` is
// datapipe-test.appspot.com (this file's own hardcoded FIREBASE_CONFIG), but
// the Functions emulator's own FIREBASE_CONFIG (which the Firebase CLI
// derives itself, independent of this file) resolves to
// datapipe-test.firebasestorage.app on current firebase-tools -- confirmed by
// instrumenting persist-pending.ts's `bucket.name` directly while developing
// this test. So this block resolves its own bucket handle rather than reusing
// the file-level one.
describe("METADATA_ERROR keeps and labels the pending copy", () => {
  // The Functions emulator's actual default bucket (see the comment above).
  // Not the file-level `bucket` var, which points at .appspot.com and would
  // never see anything this describe block's HTTP calls write. Resolved
  // inside beforeAll, not at describe-body-evaluation time, because the
  // default app this file initializes (the outer `beforeAll` above) does not
  // exist yet while Jest is still collecting describe blocks.
  let emulatorBucket;
  let failingMetadataServer;
  let failingMetadataPort;

  beforeAll(async () => {
    emulatorBucket = getStorage().bucket("datapipe-test.firebasestorage.app");
    failingMetadataServer = await createFailingMetadataMockServer();
    failingMetadataPort = failingMetadataServer.address().port;

    await db.collection("experiments").doc("persist-test-metadata-failure").set({
      active: true,
      metadataActive: true,
      owner: "persist-test-user",
      osfFilesLink: `http://localhost:${failingMetadataPort}/endpoint`,
    });
  });

  afterAll(async () => {
    failingMetadataServer.close();
  });

  it("returns METADATA_ERROR, keeps the pending copy, and labels it keptReason: metadata-failure", async () => {
    const result = await saveData({
      experimentID: "persist-test-metadata-failure",
      data: sampleData,
      filename: "test-metadata-failure.json",
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe(MESSAGES.METADATA_ERROR.error);

    const pendingFiles = await listPendingFiles(emulatorBucket, "persist-test-metadata-failure");
    const matching = pendingFiles.filter((f) => f.name.includes("test-metadata-failure"));
    // Kept, not cleaned up -- the opposite of every "should clean up"/"should
    // not persist" assertion above in this file.
    expect(matching.length).toBe(1);

    // api-data.ts calls markPendingKept AFTER res.status(400).json(...) has
    // already been sent (deliberately -- see its call site's comment: a
    // labeling failure must never turn a handled refusal into a 500). That
    // means the metadata WRITE is still in flight, on the server's own
    // connection to the storage emulator, at the exact moment this test's
    // `saveData` call resolves on ITS connection -- two independent round
    // trips with no ordering guarantee between them. Poll briefly rather than
    // assert on the first read.
    let keptReason;
    for (let attempt = 0; attempt < 10 && keptReason === undefined; attempt++) {
      const [metadata] = await matching[0].getMetadata();
      keptReason = metadata.metadata?.keptReason;
      if (keptReason === undefined) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // Round-trip proof: this is the same storage emulator the rest of this
    // suite runs against, so if custom metadata did not survive a
    // setMetadata()/getMetadata() round trip here, scheduled-pending-
    // recovery.ts's classification would silently never fire in the
    // emulator even though markPendingKept "succeeded" (it swallows every
    // error by design). Confirmed: it does round-trip.
    expect(keptReason).toBe("metadata-failure");
  });
});
