/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

async function saveData(body) {
  const response = await fetch(
    "http://localhost:5001/datapipe-test/us-central1/apiBase64",
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

beforeAll(async () => {
  initializeApp(config);
  const db = getFirestore();
  await db.collection("experiments").doc("base64-testexp").set({ activeBase64: false });
  await db.collection("users").doc("testuser").set({
    osfTokenValid: false,
  });
  await db.collection("experiments").doc("base64-testexp-active-no-owner").set({
    activeBase64: true,
  });
  await db.collection("experiments").doc("base64-testexp-active").set({
    activeBase64: true,
    owner: "testuser",
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
    await db.collection("logs").doc("testlog").delete();
    let response = await saveData({
      experimentID: "testlog",
      data: "test",
      filename: "test",
    });
    let doc = await db.collection("logs").doc("testlog").get();
    expect(doc.data().saveBase64Data).toBe(1);

    response = await saveData({
      experimentID: "testlog",
      data: "test",
      filename: "test",
    });
    doc = await db.collection("logs").doc("testlog").get();
    expect(doc.data().saveBase64Data).toBe(2);
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

  it("should return error message when condition assignment is not active", async () => {
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
