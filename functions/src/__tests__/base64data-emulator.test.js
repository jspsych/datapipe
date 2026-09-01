/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
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

beforeAll(async () => {
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
