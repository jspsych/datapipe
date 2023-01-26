/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
  const message = await response.text();
  return message;
}

const config = {
  projectId: "datapipe-test",
};

jest.setTimeout(30000);

beforeAll(async () => {
  initializeApp(config);
  const db = getFirestore();
  await db.collection("experiments").doc("testexp").set({ activeBase64: false });
  await db.collection("users").doc("testuser").set({
    osfTokenValid: false,
  });
  await db.collection("experiments").doc("testexp-active-no-owner").set({
    activeBase64: true,
  });
  await db.collection("experiments").doc("testexp-active").set({
    activeBase64: true,
    owner: "testuser",
  });
});

describe("apiData", () => {
  it("should return error message when there is no experimentID in the body", async () => {
    const response = await saveData({});
    expect(response).toBe("Missing parameter experimentID");
  });

  it("should return error message when there is no data in the body", async () => {
    const response = await saveData({ experimentID: "test" });
    expect(response).toBe("Missing parameter data");
  });

  it("should return error message when there is no filename in the body", async () => {
    const response = await saveData({ experimentID: "test", data: "test" });
    expect(response).toBe("Missing parameter filename");
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
      experimentID: "testexp-active",
      data: "{'test': 21}",
      filename: "test",
    });
    expect(response).toBe("Invalid base64 data");
  });

  it("should return error message when the experimentID does not match an experiment", async () => {
    const response = await saveData({
      experimentID: "doesnotexist",
      data: "test",
      filename: "test",
    });
    expect(response).toBe("Experiment does not exist");
  });

  it("should return error message when condition assignment is not active", async () => {
    const response = await saveData({
      experimentID: "testexp",
      data: "test",
      filename: "test",
    });
    expect(response).toBe("Base64 data collection is not active for this experiment");
  });

  it("should reject a request when there is no corresponding user", async () => {
    const response = await saveData({
      experimentID: "testexp-active-no-owner",
      data: "test",
      filename: "test",
    });
    expect(response).toBe("This experiment has an invalid owner ID");
  });

  it("should reject a request when there is no valid OSF token", async () => {
    const response = await saveData({
      experimentID: "testexp-active",
      data: "test",
      filename: "test",
    });
    expect(response).toBe("This experiment does not have a valid OSF token");
  });
});
