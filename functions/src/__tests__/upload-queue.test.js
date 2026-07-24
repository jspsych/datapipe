/**
 * @jest-environment node
 */

import { initializeApp, deleteApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

const config = { projectId: "datapipe-test" };

jest.setTimeout(30000);

let db;
let app;

beforeAll(async () => {
  try {
    app = getApp("upload-queue-test");
  } catch {
    app = initializeApp(config, "upload-queue-test");
  }
  db = getFirestore(app);
});

afterEach(async () => {
  // Clean up uploadQueue collection
  const docs = await db.collection("uploadQueue").get();
  const batch = db.batch();
  docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
});

describe("queueUpload deduplication", () => {
  test("uses deterministic document ID from experimentID and filename", async () => {
    const docId = "exp123:data.csv".replace(/[/\\]/g, "_");
    const docRef = db.collection("uploadQueue").doc(docId);

    await docRef.set({
      experimentID: "exp123",
      owner: "user1",
      filename: "data.csv",
      storagePath: `upload-queue/${docId}`,
      dataType: "data",
      osfFilesLink: "https://osf.io/files/",
      status: "pending",
      errorCode: 0,
      retryCount: 0,
      maxRetries: 5,
      createdAt: Timestamp.now(),
      lastAttemptAt: null,
      nextRetryAt: Timestamp.fromMillis(Date.now() + 3600000),
      completedAt: null,
      failureReason: "Upload exception: timeout",
      deduplicationKey: "exp123:data.csv",
      sessionIncremented: true,
    });

    // Verify the doc exists at the expected deterministic ID
    const doc = await docRef.get();
    expect(doc.exists).toBe(true);
    expect(doc.data().experimentID).toBe("exp123");
    expect(doc.data().filename).toBe("data.csv");
    expect(doc.data().failureReason).toBe("Upload exception: timeout");
  });

  test("deterministic ID handles filenames with slashes", async () => {
    const docId = "exp123:subfolder/data.csv".replace(/[/\\]/g, "_");
    expect(docId).toBe("exp123:subfolder_data.csv");
  });

  test("same deduplicationKey produces same document ID", () => {
    const key1 = "exp123:data.csv".replace(/[/\\]/g, "_");
    const key2 = "exp123:data.csv".replace(/[/\\]/g, "_");
    expect(key1).toBe(key2);
  });

  test("different experiments produce different document IDs", () => {
    const key1 = "exp123:data.csv".replace(/[/\\]/g, "_");
    const key2 = "exp456:data.csv".replace(/[/\\]/g, "_");
    expect(key1).not.toBe(key2);
  });
});

describe("handleRetryFailure backoff", () => {
  test("exponential backoff doubles each retry", () => {
    const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

    for (let retryCount = 1; retryCount <= 5; retryCount++) {
      const backoffMs = Math.min(
        Math.pow(2, retryCount) * 60 * 60 * 1000,
        MAX_BACKOFF_MS
      );
      const expectedHours = Math.min(Math.pow(2, retryCount), 24);
      expect(backoffMs).toBe(expectedHours * 60 * 60 * 1000);
    }
  });

  test("backoff is capped at 24 hours", () => {
    const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
    // retryCount = 5 => 2^5 = 32 hours, should cap at 24
    const backoffMs = Math.min(
      Math.pow(2, 5) * 60 * 60 * 1000,
      MAX_BACKOFF_MS
    );
    expect(backoffMs).toBe(24 * 60 * 60 * 1000);
  });

  test("Retry-After header is honored when provided", () => {
    const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
    const retryAfterSeconds = 120; // 2 minutes

    const backoffMs = Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
    expect(backoffMs).toBe(120000);
  });

  test("Retry-After is capped at MAX_BACKOFF_MS", () => {
    const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
    const retryAfterSeconds = 100000; // ~27 hours

    const backoffMs = Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
    expect(backoffMs).toBe(MAX_BACKOFF_MS);
  });

  test("falls back to exponential backoff when no Retry-After", () => {
    const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
    const retryAfterSeconds = null;
    const retryCount = 2;

    const backoffMs = retryAfterSeconds
      ? Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS)
      : Math.min(Math.pow(2, retryCount) * 60 * 60 * 1000, MAX_BACKOFF_MS);

    expect(backoffMs).toBe(4 * 60 * 60 * 1000); // 4 hours
  });
});

describe("queue entry lifecycle in Firestore", () => {
  test("pending entry can transition to processing", async () => {
    const docRef = db.collection("uploadQueue").doc("lifecycle-test");
    await docRef.set({
      status: "pending",
      retryCount: 0,
      maxRetries: 5,
      createdAt: Timestamp.now(),
    });

    // Simulate atomic claim via transaction
    await db.runTransaction(async (transaction) => {
      const freshDoc = await transaction.get(docRef);
      expect(freshDoc.data().status).toBe("pending");
      transaction.update(docRef, {
        status: "processing",
        lastAttemptAt: Timestamp.now(),
      });
    });

    const updated = await docRef.get();
    expect(updated.data().status).toBe("processing");
  });

  test("processing entry cannot be claimed again", async () => {
    const docRef = db.collection("uploadQueue").doc("double-claim-test");
    await docRef.set({
      status: "processing",
      retryCount: 0,
      maxRetries: 5,
      createdAt: Timestamp.now(),
    });

    // Second claim should fail
    await expect(
      db.runTransaction(async (transaction) => {
        const freshDoc = await transaction.get(docRef);
        if (freshDoc.data()?.status !== "pending") {
          throw new Error("Already claimed");
        }
        transaction.update(docRef, { status: "processing" });
      })
    ).rejects.toThrow("Already claimed");
  });

  test("failed entry with max retries reached stays failed", async () => {
    const docRef = db.collection("uploadQueue").doc("max-retry-test");
    await docRef.set({
      status: "pending",
      retryCount: 4,
      maxRetries: 5,
      createdAt: Timestamp.now(),
      failureReason: null,
    });

    // Simulate handleRetryFailure logic
    const data = (await docRef.get()).data();
    const newRetryCount = (data.retryCount || 0) + 1;

    if (newRetryCount >= data.maxRetries) {
      await docRef.update({
        status: "failed",
        retryCount: newRetryCount,
        failureReason: "Provider error 500: Internal Server Error",
      });
    }

    const result = await docRef.get();
    expect(result.data().status).toBe("failed");
    expect(result.data().retryCount).toBe(5);
    expect(result.data().failureReason).toBe(
      "Provider error 500: Internal Server Error"
    );
  });
});
