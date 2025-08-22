/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

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
  return message;
}

const config = {
  projectId: "datapipe-test",
};

jest.setTimeout(30000);

beforeAll(async () => {
  initializeApp(config);
  const db = getFirestore();
  await db.collection("experiments").doc("data-testexp").set({ active: false });
  await db.collection("experiments").doc("testlog").set({ 
    active: true, 
    owner: "testuser"
  });
  await db.collection("experiments").doc("data-test").set({ 
    active: true, 
    owner: "testuser"
  });
  await db.collection("users").doc("testuser").set({
    osfTokenValid: false,
  });
  await db.collection("experiments").doc("data-testexp-active-no-owner").set({
    active: true,
  });
  await db.collection("experiments").doc("data-testexp-active").set({
    active: true,
    owner: "testuser",
  });
});

describe("apiData", () => {
  it("should return error message when there is no experimentID in the body", async () => {
    const response = await saveData({});
    expect(response).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("should return error message when there is no data in the body", async () => {
    const response = await saveData({ experimentID: "data-test" });
    expect(response).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("should return error message when there is no filename in the body", async () => {
    const response = await saveData({ experimentID: "data-test", data: "test" });
    expect(response).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("should increment the write request log for the experiment when there is a complete request", async () => {
    const db = getFirestore();
    await db.collection("logs").doc("testlog").delete();
    await saveData({
      experimentID: "testlog",
      data: "test",
      filename: "test",
    });
    let doc = await db.collection("logs").doc("testlog").get();
    expect(doc.data().saveData).toBe(1);

    await saveData({
      experimentID: "testlog",
      data: "test",
      filename: "test",
    });
    doc = await db.collection("logs").doc("testlog").get();
    expect(doc.data().saveData).toBe(2);
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
      experimentID: "data-testexp",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
  });

  it("should return error message when the experiment has reached its session limit", async () => {
    const db = getFirestore();
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        limitSessions: true,
        sessions: 2,
        maxSessions: 2,
      },
      { merge: true }
    );
    const response = await saveData({
      experimentID: "data-testexp-active",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.SESSION_LIMIT_REACHED);
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        limitSessions: false,
      },
      { merge: true }
    );
  });

  it("should reject invalid JSON data when validation is on", async () => {
    const db = getFirestore();
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        useValidation: true,
        allowJSON: true,
        allowCSV: false,
      },
      { merge: true }
    );
    const response = await saveData({
      experimentID: "data-testexp-active",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_DATA);
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        useValidation: false,
      },
      { merge: true }
    );
  });

  it("should reject invalid CSV data when validation is on", async () => {
    const db = getFirestore();
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        useValidation: true,
        allowJSON: false,
        allowCSV: true,
      },
      { merge: true }
    );
    const response = await saveData({
      experimentID: "data-testexp-active",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_DATA);
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        useValidation: false,
      },
      { merge: true }
    );
  });

  it("should reject a request when there is no corresponding user", async () => {
    const response = await saveData({
      experimentID: "data-testexp-active-no-owner",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_OWNER);
  });

  it("should reject a request when there is no valid OSF token", async () => {
    const db = getFirestore();
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        useValidation: false,
      },
      { merge: true }
    );
    const response = await saveData({
      experimentID: "data-testexp-active",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_OSF_TOKEN);
  });
});
