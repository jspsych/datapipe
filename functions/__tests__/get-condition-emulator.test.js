/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

async function getCondition(body) {
  const response = await fetch(
    "http://localhost:5001/datapipe-test/us-central1/apiCondition",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body: JSON.stringify(body),
    }
  );
  const condition = await response.text();
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
    expect(condition).toBe("Missing parameter experimentID");
  });

  it("should return error message when the experimentID does not match an experiment", async () => {
    const condition = await getCondition({ experimentID: "doesnotexist" });
    expect(condition).toBe("Experiment does not exist");
  });

  it("should return error message when condition assignment is not active", async () => {
    const condition = await getCondition({ experimentID: "testexp" });
    expect(condition).toBe(
      "Condition assignment is not active for this experiment"
    );
  });

  it("should return sequential conditions when condition assignment is active", async () => {
    for(let i = 0; i < 8; i++) {
      const condition = await getCondition({ experimentID: "testexp-active" });
      expect(parseInt(condition)).toBe(i % 4);
    }
  });

});
