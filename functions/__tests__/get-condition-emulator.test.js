/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

async function getCondition(body) {
  const response = await fetch(
    "http://127.0.0.1:5001/datapipe-test/us-central1/apiCondition",
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
  const ref = await db
    .collection("experiments")
    .doc("testexp")
    .set({ activeConditionAssignment: false });
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
});
