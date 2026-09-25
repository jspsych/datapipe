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
 * getExperiment() (experiment-id.ts) -- built on isValidDocumentId() -- now
 * gates every endpoint that looks an experiment up by a client-supplied id
 * before the Firestore call that would otherwise throw, so each endpoint
 * folds the reserved-id case into the not-found branch it already had. This
 * suite covers all of them:
 *   - the unauthenticated, participant-facing endpoints that answer 400
 *     EXPERIMENT_NOT_FOUND for both a reserved id and a nonexistent one:
 *     /api/data, /api/base64, /api/condition, /api/session.
 *   - the authenticated, researcher-facing dashboard endpoints that answer
 *     403 Access denied for a reserved id, a nonexistent id, and someone
 *     else's experiment alike (the same convention each of them already used
 *     for "doesn't exist" vs. "not yours"): /api/finalize, /api/clearerrors,
 *     /api/ensurederivedpaths, and /api/queuestatus's own experimentID
 *     parameter.
 *   - /api/queuestatus's separate `download` query parameter, which is
 *     checked with the same isValidDocumentId() gate but answers its own
 *     shape (404 "Queue entry not found") since a queue entry, not the
 *     experiment, is what a reserved or slash-containing id there would
 *     otherwise 500 trying to look up.
 */

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import MESSAGES from "../api-messages";
import { fnUrl } from "./helpers/fn-url.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

const config = { projectId: "datapipe-test" };
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

// Exactly the placeholder observed in production logs -- also exactly
// Firestore's reserved /^__.*__$/ shape.
const RESERVED_ID = "__DATAPIPE_STUDY1_ID__";
// A shorter reserved id, used for api-queue-status's `download` param below
// -- any /^__.*__$/ shape triggers the same Firestore throw, so this only
// needs to be reserved, not the exact production placeholder.
const RESERVED_DOWNLOAD_ID = "__x__";

jest.setTimeout(30000);

let db;

beforeAll(() => {
  let app;
  try {
    app = getApp("experiment-id-validation-test");
  } catch {
    app = initializeApp(config, "experiment-id-validation-test");
  }
  db = getFirestore(app);
});

async function signUpEmulatorUser() {
  const email = `experiment-id-validation-${randomUUID()}@example.test`;
  const res = await fetch(AUTH_EMULATOR_SIGNUP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!", returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Auth emulator signUp failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return { uid: body.localId, idToken: body.idToken };
}

async function postJSON(url, body, idToken) {
  const headers = { "Content-Type": "application/json", Accept: "*/*" };
  if (idToken !== undefined) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const message = await response.json();
  return { status: response.status, body: message };
}

async function getJSON(url, idToken) {
  const response = await fetch(url, {
    headers: idToken !== undefined ? { Authorization: `Bearer ${idToken}` } : {},
  });
  const message = await response.json();
  return { status: response.status, body: message };
}

describe("reserved/invalid experimentID does not 500 (unauthenticated participant endpoints)", () => {
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

  it("POST /api/session returns 400 EXPERIMENT_NOT_FOUND, not a 500", async () => {
    const { status, body } = await postJSON(fnUrl("/api/session"), {
      experimentID: RESERVED_ID,
    });

    expect(status).toBe(400);
    expect(body).toEqual(MESSAGES.EXPERIMENT_NOT_FOUND);
  });
});

describe("reserved/invalid experimentID does not 500 (authenticated dashboard endpoints)", () => {
  it("POST /api/finalize returns 403 Access denied, not a 500", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status, body } = await postJSON(
      fnUrl("/api/finalize"),
      { experimentID: RESERVED_ID },
      idToken
    );

    expect(status).toBe(403);
    expect(body).toEqual({ error: "Access denied" });
  });

  it("POST /api/clearerrors returns 403 Access denied, not a 500", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status, body } = await postJSON(
      fnUrl("/api/clearerrors"),
      { experimentID: RESERVED_ID },
      idToken
    );

    expect(status).toBe(403);
    expect(body).toEqual({ error: "Access denied" });
  });

  it("POST /api/ensurederivedpaths returns 403 Access denied, not a 500", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status, body } = await postJSON(
      fnUrl("/api/ensurederivedpaths"),
      { experimentID: RESERVED_ID },
      idToken
    );

    expect(status).toBe(403);
    expect(body).toEqual({ error: "Access denied" });
  });

  it("GET /api/queuestatus?experimentID=__X__ returns 403 Access denied, not a 500", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status, body } = await getJSON(
      `${fnUrl("/api/queuestatus")}?experimentID=${RESERVED_ID}`,
      idToken
    );

    expect(status).toBe(403);
    expect(body).toEqual({ error: "Access denied" });
  });
});

describe("api-queue-status: reserved/slash-containing `download` id does not 500", () => {
  const createdExperimentIds = [];

  afterEach(async () => {
    if (createdExperimentIds.length === 0) return;
    const batch = db.batch();
    for (const experimentID of createdExperimentIds) {
      batch.delete(db.collection("experiments").doc(experimentID));
    }
    await batch.commit();
    createdExperimentIds.length = 0;
  });

  async function seedOwnedExperiment(uid) {
    const experimentID = `queue-status-reserved-download-${randomUUID()}`;
    createdExperimentIds.push(experimentID);
    await db.collection("experiments").doc(experimentID).set({
      owner: uid,
      active: true,
      storageProvider: "gdrive",
    });
    return experimentID;
  }

  it("returns 404 Queue entry not found for a reserved __x__ download id, on an experiment the caller owns", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = await seedOwnedExperiment(uid);

    const { status, body } = await getJSON(
      `${fnUrl("/api/queuestatus")}?experimentID=${experimentID}&download=${RESERVED_DOWNLOAD_ID}`,
      idToken
    );

    expect(status).toBe(404);
    expect(body).toEqual({ error: "Queue entry not found" });
  });

  it("returns 404 Queue entry not found for a slash-containing download id (a%2Fb), on an experiment the caller owns", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = await seedOwnedExperiment(uid);

    const { status, body } = await getJSON(
      `${fnUrl("/api/queuestatus")}?experimentID=${experimentID}&download=${encodeURIComponent("a/b")}`,
      idToken
    );

    expect(status).toBe(404);
    expect(body).toEqual({ error: "Queue entry not found" });
  });
});
