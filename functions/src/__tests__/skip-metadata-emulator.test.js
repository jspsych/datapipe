/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

jest.setTimeout(30000);

const config = {
  projectId: "datapipe-test",
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
  return message;
}

const sampleData = `[{
  "trial_type": "html-keyboard-response",
  "trial_index": 1,
  "time_elapsed": 776
}]`;

beforeAll(async () => {
  initializeApp(config);
  const db = getFirestore();

  await db.collection("users").doc("skip-metadata-user").set({
    osfTokenValid: true,
    osfToken: "valid",
    usingPersonalToken: true,
  });

  // Experiment with metadata disabled
  await db.collection("experiments").doc("skip-metadata-exp").set({
    active: true,
    metadataActive: false,
    owner: "skip-metadata-user",
    osfFilesLink: "http://localhost:3000/endpoint",
  });

  // Experiment with metadata enabled (for comparison)
  await db.collection("experiments").doc("skip-metadata-exp-active").set({
    active: true,
    metadataActive: true,
    owner: "skip-metadata-user",
    osfFilesLink: "http://localhost:3000/endpoint",
  });
});

describe("skip metadata when inactive", () => {
  it("should not produce metadata when metadataActive is false", async () => {
    const response = await saveData({
      experimentID: "skip-metadata-exp",
      data: sampleData,
      filename: "test-skip-metadata.json",
    });

    // When metadata is skipped, metadataMessage should be empty
    // and the response should not contain metadata error info
    expect(response.metadataMessage).toBeFalsy();
  });

  it("should not create a metadata document in Firestore when metadataActive is false", async () => {
    const db = getFirestore();

    // Clear any existing metadata doc
    await db.collection("metadata").doc("skip-metadata-exp").delete();

    await saveData({
      experimentID: "skip-metadata-exp",
      data: sampleData,
      filename: "test-skip-metadata-2.json",
    });

    const metadataDoc = await db
      .collection("metadata")
      .doc("skip-metadata-exp")
      .get();

    // No metadata document should have been created
    expect(metadataDoc.exists).toBe(false);
  });

  it("should still attempt metadata processing when metadataActive is true", async () => {
    const response = await saveData({
      experimentID: "skip-metadata-exp-active",
      data: sampleData,
      filename: "test-with-metadata.json",
    });

    // When metadata is active, the function will attempt to process metadata.
    // The response should have the metadataMessage key present, confirming
    // the metadata code path was entered (unlike when metadataActive is false).
    expect(response).toHaveProperty("metadataMessage");
  });
});
