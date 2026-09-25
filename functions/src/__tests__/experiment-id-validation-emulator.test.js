/**
 * @jest-environment node
 *
 * Regression coverage for the reserved/invalid-experimentID 500 bug.
 *
 * Production logs showed a participant site POSTing
 * experimentID: "__DATAPIPE_STUDY1_ID__" -- an unfilled template placeholder
 * -- to /api/data. db.collection("experiments").doc(experimentID).get()
 * throws "3 INVALID_ARGUMENT: Resource id ... is invalid because it is
 * reserved" for that shape, and the throw escaped as an unhandled 500 instead
 * of the ordinary 400 EXPERIMENT_NOT_FOUND a nonexistent-but-valid id already
 * gets.
 *
 * isValidExperimentId() (experiment-id.ts) now gates every public,
 * unauthenticated endpoint that looks an experiment up by a client-supplied
 * id before the Firestore call that would otherwise throw. This suite proves
 * the three data-submission endpoints that dispatch straight from a request
 * body (api/data, api/base64, api/condition) answer with the normal
 * not-found response instead of a 500.
 */

import MESSAGES from "../api-messages";
import { fnUrl } from "./helpers/fn-url.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

// Exactly the placeholder observed in production logs -- also exactly
// Firestore's reserved /^__.*__$/ shape.
const RESERVED_ID = "__DATAPIPE_STUDY1_ID__";

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body),
  });
  const message = await response.json();
  return { status: response.status, body: message };
}

jest.setTimeout(30000);

describe("reserved/invalid experimentID does not 500", () => {
  it("POST /api/data returns 400 EXPERIMENT_NOT_FOUND, not a 500", async () => {
    const { status, body } = await postJSON(fnUrl("/api/data"), {
      experimentID: RESERVED_ID,
      filename: "data.csv",
      data: "trial_type\nhtml-keyboard-response\n",
    });

    expect(status).toBe(400);
    expect(body).toEqual(MESSAGES.EXPERIMENT_NOT_FOUND);
  });

  it("POST /api/base64 returns 400 EXPERIMENT_NOT_FOUND, not a 500", async () => {
    const { status, body } = await postJSON(fnUrl("/api/base64"), {
      experimentID: RESERVED_ID,
      filename: "image.png",
      data: "data:image/png;base64,aGVsbG8=",
    });

    expect(status).toBe(400);
    expect(body).toEqual(MESSAGES.EXPERIMENT_NOT_FOUND);
  });

  it("POST /api/condition returns 400 EXPERIMENT_NOT_FOUND, not a 500", async () => {
    const { status, body } = await postJSON(fnUrl("/api/condition"), {
      experimentID: RESERVED_ID,
    });

    expect(status).toBe(400);
    expect(body).toEqual(MESSAGES.EXPERIMENT_NOT_FOUND);
  });
});
