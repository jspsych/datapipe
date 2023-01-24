/**
 * @jest-environment node
 */

import firebaseFunctionsTest from "firebase-functions-test";
import { getFirestore } from "firebase-admin/firestore";


const config = {
  projectId: "datapipe-test",
};

const test = firebaseFunctionsTest(config, "../../testServiceAccount.json");
//const db = getFirestore();

//const myFunctions = require('../index');

describe.skip("getCondition", () => {
  it("should return a condition", async () => {
    const req = { query: { experimentID: "testExperimentID" } };
    const res = {
      setHeader: (key, value) => {},
      getHeader: (value) => {},
      send: jest.fn(),
      status: jest.fn(() => res),
    };

    const condition = await myFunctions.apiCondition(req, res);
    //expect(res.send).toHaveBeenCalledWith("condition");
  });
});
