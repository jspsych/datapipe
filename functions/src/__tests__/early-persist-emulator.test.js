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

function createMockOSFServer(port) {
  const app = express();
  app.put("/endpoint", (req, res) => {
    res.status(201).json({ data: { attributes: { name: req.query.name || "uploaded.json" } } });
  });
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}

beforeAll(async () => {
  mockServerInstance = await createMockOSFServer(3001);

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
    osfFilesLink: "http://localhost:3001/endpoint",
  });

  await db.collection("experiments").doc("persist-test-inactive").set({
    active: false,
    owner: "persist-test-user",
  });
});

afterAll(async () => {
  mockServerInstance.close();
});

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
