/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

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

let mockOSF;

beforeAll(async () => {
  mockOSF = await createMockOSFServer();

  initializeApp(config);
  const db = getFirestore();
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

  it("should reject a request when there is no valid OSF token", async () => {
    const response = await saveData({
      experimentID: "base64-testexp-active",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_OSF_TOKEN);
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
