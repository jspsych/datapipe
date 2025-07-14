/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

async function getCondition(body) {
  const response = await fetch(
    "http://localhost:5001/datapipe-test/us-central1/apicondition",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body: JSON.stringify(body),
    }
  );
  const condition = await response.json();
  return condition;
}

const config = {
  projectId: "datapipe-test",
};

jest.setTimeout(30000);

beforeAll(async () => {
  initializeApp(config);
  const db = getFirestore();
  await db
    .collection("experiments")
    .doc("testexp")
    .set({ activeConditionAssignment: false });
  await db
    .collection("experiments")
    .doc("testexp-active")
    .set({ activeConditionAssignment: true, nConditions: 4, currentCondition: 0 });
});

describe("getCondition", () => {
  it("should return error message when there is no experimentID in the body", async () => {
    const condition = await getCondition({});
    expect(condition).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("should return error message when the experimentID does not match an experiment", async () => {
    const condition = await getCondition({ experimentID: "doesnotexist" });
    expect(condition).toEqual(MESSAGES.EXPERIMENT_NOT_FOUND);
  });

  it("should return error message when condition assignment is not active", async () => {
    const condition = await getCondition({ experimentID: "testexp" });
    expect(condition).toEqual(MESSAGES.CONDITION_ASSIGNMENT_NOT_ACTIVE);
  });

  it("should increment the error log for an experiment when errors are caught", async () => {

    const db = getFirestore();
    await db.collection("logs").doc("testexp").delete();

    await getCondition({ experimentID: "testexp" });

    let doc = await db.collection("logs").doc("testexp").get();

    expect(doc.data().logError).toBe(1);

    await getCondition({ experimentID: "testexp" });

    doc = await db.collection("logs").doc("testexp").get();

    expect(doc.data().logError).toBe(2);


  });

  it("should return sequential conditions when condition assignment is active", async () => {
    for(let i = 0; i < 8; i++) {
      const condition = await getCondition({ experimentID: "testexp-active" });
      expect(condition.message).toBe('Success');
      expect(condition.condition).toBe(i % 4);
    }
  });

});
