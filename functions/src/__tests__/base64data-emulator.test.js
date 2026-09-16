/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";
import express from "express";
import MESSAGES from "../api-messages";

// Not imported from collision-cache.ts/lib -- see the matching comment in
// data-emulator.test.js. Must match collision-cache.ts's own export.
const CLAIM_NAMESPACE_VERSION = 2;

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
// Needed only by the RECOVERABLE / NOT_RECOVERABLE token-failure tests below,
// which check the pending-data cleanup and uploadQueue side effects of a
// queued submission -- mirrors early-persist-emulator.test.js.
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";

async function saveData(body) {
  const response = await fetch(
    "http://localhost:5001/datapipe-test/us-central1/apibase64",
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
  return message;
}

// Same request, but with the status code -- saveData() above only ever
// returns the parsed body, and the success path needs the 201 itself, not
// just what MESSAGES.SUCCESS says.
async function saveDataWithStatus(body) {
  const response = await fetch(
    "http://localhost:5001/datapipe-test/us-central1/apibase64",
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

// A minimal mock OSF "files" container, following the inline-server pattern
// in collision-integration-emulator.test.js (an OS-assigned port via
// listen(0), not mock-server.ts's shared fixed port). The one addition this
// suite needs beyond that pattern: express.raw() on the PUT route, so the
// exact bytes api-base64.ts's provider write sent -- not a JSON-parsed
// re-encoding of them -- are what the test can inspect. put-file-osf.ts sends
// the body with a (hardcoded, pre-existing) "Content-Type: application/json"
// header regardless of what the payload actually is, so express.raw() has to
// match on that content type to capture it at all; a decoded binary payload
// is not valid JSON, so express.json() would reject it before this test ever
// saw the bytes.
function createMockOSFServer() {
  const app = express();
  const receivedBytesByFilename = new Map();

  app.get("/files", (req, res) => {
    res.json({ data: [] });
  });

  app.put(
    "/files",
    express.raw({ type: "application/json", limit: "50mb" }),
    (req, res) => {
      const filename = String(req.query.name || "");
      receivedBytesByFilename.set(filename, Buffer.from(req.body));
      res.status(201).json({
        data: { attributes: { name: filename, kind: "file" }, id: "osfstorage/mock-upload" },
      });
    }
  );

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        server,
        port: server.address().port,
        getReceivedBytes: (filename) => receivedBytesByFilename.get(filename),
      });
    });
  });
}

const config = {
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
};

jest.setTimeout(30000);

async function waitForLog(db, docId, field, expectedValue, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const doc = await db.collection("logs").doc(docId).get();
    if (doc.exists && doc.data()?.[field] === expectedValue) {
      return doc;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // Return the last read for the assertion to produce a useful error
  return db.collection("logs").doc(docId).get();
}

let bucket;

async function listPendingFiles(experimentID) {
  const [files] = await bucket.getFiles({ prefix: `pending-data/${experimentID}/` });
  return files;
}

function uploadQueueDocId(experimentID, filename) {
  return `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
}

let mockOSF;

beforeAll(async () => {
  mockOSF = await createMockOSFServer();

  const app = initializeApp(config);
  const db = getFirestore();
  bucket = getStorage(app).bucket();
  await db.collection("experiments").doc("base64-testexp").set({ activeBase64: false });
  await db.collection("users").doc("testuser").set({
    osfTokenValid: false,
    usingPersonalToken: true,
  });
  await db.collection("experiments").doc("base64-testexp-active-no-owner").set({
    activeBase64: true,
  });
  await db.collection("experiments").doc("base64-testexp-active").set({
    activeBase64: true,
    owner: "testuser",
  });
  // api-base64.ts counts the attempt AFTER confirming the experiment exists
  // (see write-log.ts), so the experiment this test counts against has to be
  // seeded rather than left absent.
  await db.collection("experiments").doc("base64-testlog").set({
    activeBase64: false,
    owner: "testuser",
    storageProvider: "osf",
  });

  // The success-path fixture: a real owner with a valid token (legacy OSF
  // default -- no storageProvider field, same as every other experiment in
  // this file) pointed at the mock server above instead of the real OSF API.
  await db.collection("users").doc("base64-success-owner").set({
    osfTokenValid: true,
    osfToken: "valid",
    usingPersonalToken: true,
  });
  await db.collection("experiments").doc("base64-success-exp").set({
    activeBase64: true,
    owner: "base64-success-owner",
    osfFilesLink: `http://localhost:${mockOSF.port}/files`,
  });
});

afterAll(() => {
  mockOSF.server.close();
});

describe("apiData", () => {
  it("should return error message when there is no experimentID in the body", async () => {
    const response = await saveData({});
    expect(response).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("should return error message when there is no data in the body", async () => {
    const response = await saveData({ experimentID: "test" });
    expect(response).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("should return error message when there is no filename in the body", async () => {
    const response = await saveData({ experimentID: "test", data: "test" });
    expect(response).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("should increment the write request log for the experiment when there is a complete request", async () => {
    const db = getFirestore();
    // Log doc ID must be unique to this suite: data-emulator.test.js runs in a
    // parallel jest worker and deletes its own log doc, so sharing "testlog"
    // let each suite wipe the other's counters mid-test.
    await db.collection("logs").doc("base64-testlog").delete();
    await saveData({
      experimentID: "base64-testlog",
      data: "test",
      filename: "test",
    });
    let doc = await waitForLog(db, "base64-testlog", "saveBase64Data", 1);
    expect(doc.data().saveBase64Data).toBe(1);
    expect(doc.data().owner).toBe("testuser");
    expect(doc.data().storageProvider).toBe("osf");

    await saveData({
      experimentID: "base64-testlog",
      data: "test",
      filename: "test",
    });
    doc = await waitForLog(db, "base64-testlog", "saveBase64Data", 2);
    expect(doc.data().saveBase64Data).toBe(2);
  });

  it("should increment the error log for an experiment when errors are caught", async () => {
    const db = getFirestore();

    await db.collection("logs").doc("base64-testexp-active-no-owner").delete();

    await saveData({
      experimentID: "base64-testexp-active-no-owner",
      data: "test",
      filename: "test",
    });

    let doc = await waitForLog(db, "base64-testexp-active-no-owner", "logError", 1);
    expect(doc.data().logError).toBe(1);

    await db.collection("experiments").doc("base64-testexp-active-no-owner").set({
      activeBase64: true,
    });

    await saveData({
      experimentID: "base64-testexp-active-no-owner",
      data: "{'test': 21}",
      filename: "test",
    });

    doc = await waitForLog(db, "base64-testexp-active-no-owner", "logError", 2);
    expect(doc.data().logError).toBe(2);
  });


  it("should reject the request when the data are not valid base64 data", async () => {
    const response = await saveData({
      experimentID: "base64-testexp-active",
      data: "{'test': 21}",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_BASE64_DATA);
  });

  it("should return error message when the experimentID does not match an experiment", async () => {
    const response = await saveData({
      experimentID: "doesnotexist",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.EXPERIMENT_NOT_FOUND);
  });

  it("should return error message when base64 data collection is not active", async () => {
    
    const response = await saveData({
      experimentID: "base64-testexp",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.BASE64DATA_COLLECTION_NOT_ACTIVE);
  });

  it("should reject a request when there is no corresponding user", async () => {
    const response = await saveData({
      experimentID: "base64-testexp-active-no-owner",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_OWNER);
  });

  // RECOVERABLE token failure (resolve-token.ts's classifyTokenFailure): a
  // connection exists (a personal OSF token, here) but the credential itself
  // is invalid. This used to reject the submission outright; it is now
  // queued for retry exactly like a provider outage would be -- see the
  // matching test in data-emulator.test.js.
  it("should queue (not reject) a submission when the owner's OSF token is invalid", async () => {
    const db = getFirestore();
    const filename = `token-failure-recoverable-${randomUUID()}`;

    // Isolate this test's errorsByCode tally from whatever earlier tests in
    // this file logged against the same shared "base64-testexp-active" fixture.
    await db.collection("logs").doc("base64-testexp-active").delete();

    const response = await saveDataWithStatus({
      experimentID: "base64-testexp-active",
      data: "test",
      filename,
    });

    // 202, OSF_UPLOAD_QUEUED — error: null, so the jsPsych plugin treats
    // this as success.
    expect(response.status).toBe(202);
    expect(response.body).toEqual(MESSAGES.OSF_UPLOAD_QUEUED);

    const docId = uploadQueueDocId("base64-testexp-active", filename);
    const queueDoc = await db.collection("uploadQueue").doc(docId).get();
    expect(queueDoc.exists).toBe(true);
    expect(queueDoc.data().failureReason).toBe("Token resolution failed: INVALID_OSF_TOKEN");
    // Base64 uploads are supplementary media, not a session -- same
    // convention as every other queue branch in api-base64.ts.
    expect(queueDoc.data().sessionIncremented).toBe(false);
    expect(queueDoc.data().providerErrorCode).toBe("AUTH_EXPIRED");
    expect(queueDoc.data().nextRetryAt.toMillis() - Date.now()).toBeLessThan(2 * 60 * 1000);
    expect(typeof queueDoc.data().claimToken).toBe("string");

    const pendingFiles = await listPendingFiles("base64-testexp-active");
    expect(pendingFiles.some((f) => f.name.includes(filename))).toBe(false);

    const logDoc = await waitForLog(db, "base64-testexp-active", "saveBase64DataQueued", 1);
    expect(logDoc.data().saveBase64DataQueued).toBe(1);
    expect(logDoc.data().errorsByCode.INVALID_OSF_TOKEN).toBe(1);
  });

  // Same RECOVERABLE token failure, but with a WARM collision cache -- see
  // the matching test in data-emulator.test.js. Uses its own experiment so
  // pre-warming its collisionCache can't affect any other test in this file.
  it("should reject a same-named repeat while queued, when the collision cache is warm", async () => {
    const db = getFirestore();
    const experimentID = `base64-testexp-collision-warm-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      activeBase64: true,
      owner: "testuser",
      collisionCache: {
        salt: randomUUID().replace(/-/g, ""),
        warmUntil: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
        namespaceVersion: CLAIM_NAMESPACE_VERSION,
      },
    });

    const filename = `token-failure-collision-${randomUUID()}`;
    const docId = uploadQueueDocId(experimentID, filename);

    const first = await saveDataWithStatus({ experimentID, data: "test", filename });
    expect(first.status).toBe(202);
    expect(first.body).toEqual(MESSAGES.OSF_UPLOAD_QUEUED);

    const firstClaimToken = (await db.collection("uploadQueue").doc(docId).get()).data()
      .claimToken;
    expect(typeof firstClaimToken).toBe("string");

    const second = await saveDataWithStatus({ experimentID, data: "test", filename });
    expect(second.status).toBe(400);
    expect(second.body).toEqual(MESSAGES.OSF_FILE_EXISTS);

    // The first submission's queued payload was not replaced by the rejected
    // repeat.
    const queueDocAfter = await db.collection("uploadQueue").doc(docId).get();
    expect(queueDocAfter.data().claimToken).toBe(firstClaimToken);
  });

  // NOT_RECOVERABLE token failure: no connection exists at all for this
  // owner/provider, so nothing a retry could ever succeed against -- this
  // must keep rejecting the submission outright, with no queue document.
  it("should reject (not queue) a submission when the owner has no connection for the experiment's provider", async () => {
    const db = getFirestore();
    const owner = `base64-notconnected-owner-${randomUUID()}`;
    const experimentID = `base64-testexp-notconnected-${randomUUID()}`;
    const filename = `token-failure-not-recoverable-${randomUUID()}`;

    // No connectedAccounts field at all -- gdrive.ts's resolveToken returns
    // PROVIDER_NOT_CONNECTED without ever making a network call.
    await db.collection("users").doc(owner).set({});
    await db.collection("experiments").doc(experimentID).set({
      activeBase64: true,
      owner,
      storageProvider: "gdrive",
    });

    const response = await saveDataWithStatus({ experimentID, data: "test", filename });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(MESSAGES.PROVIDER_NOT_CONNECTED);

    const docId = uploadQueueDocId(experimentID, filename);
    const queueDoc = await db.collection("uploadQueue").doc(docId).get();
    expect(queueDoc.exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The real success path -- every test above only reaches a validation gate.
// ---------------------------------------------------------------------------

describe("apiBase64 success path", () => {
  it("decodes a data-URL-prefixed base64 payload and uploads the raw bytes, not the base64 text", async () => {
    const filename = `success-${randomUUID()}.dat`;
    const originalBytes = Buffer.from(
      "the bytes a participant's browser actually captured, not text"
    );
    const payload = `data:application/octet-stream;base64,${originalBytes.toString("base64")}`;

    const response = await saveDataWithStatus({
      experimentID: "base64-success-exp",
      data: payload,
      filename,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(MESSAGES.SUCCESS);

    // The provider must have received the DECODED bytes -- the same buffer
    // api-base64.ts gets from decoding the part of the data URL after the
    // comma -- not the base64 (or data-URL-prefixed base64) text verbatim.
    const received = mockOSF.getReceivedBytes(filename);
    expect(received).toBeDefined();
    expect(Buffer.compare(received, originalBytes)).toBe(0);
    expect(Buffer.compare(received, Buffer.from(payload.split(",")[1], "base64"))).toBe(0);
    // What a regression to forwarding the literal text would have produced,
    // named explicitly so this test's intent doesn't depend on the reader
    // re-deriving it: the received bytes must NOT be the payload's own ASCII
    // text (data-URL prefix and all).
    expect(Buffer.compare(received, Buffer.from(payload))).not.toBe(0);
  });
});
