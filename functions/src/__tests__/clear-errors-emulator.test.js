/**
 * @jest-environment node
 */

// End-to-end coverage for clearErrors (functions/src/clear-errors.ts, POST
// /api/clearerrors) -- the route behind ErrorPanel.js's "Clear this list"
// button. firestore.rules' logs/{id} match block grants clients `read` and
// `create` but never `update` (see the rules file), so this is the only way
// a researcher's dashboard can advance the errorsClearedAt/logErrorCleared
// watermark; write-log.ts stays the only writer of logError/errors/
// errorsByCode and this route must never touch any of those three.
//
// Auth/ownership shape mirrors ensure-derived-paths-emulator.test.js and
// api-finalize-emulator.test.js: real Auth-emulator idTokens via
// accounts:signUp, same 403-for-both convention for a missing/foreign
// experiment. No mock provider server is needed -- this route never talks to
// a storage provider.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { fnUrl } from "./helpers/fn-url.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
// clearErrors lives behind dashboardapi (functions/src/dashboard-api.ts) --
// fnUrl knows the difference.
const CLEAR_ERRORS_URL = fnUrl("/api/clearerrors");
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

async function signUpEmulatorUser() {
  const email = `clear-errors-${randomUUID()}@example.test`;
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

async function callEndpoint(experimentID, idToken, { method = "POST" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (idToken !== undefined) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  const res = await fetch(CLEAR_ERRORS_URL, {
    method,
    headers,
    body:
      method === "POST"
        ? experimentID === undefined
          ? JSON.stringify({})
          : JSON.stringify({ experimentID })
        : undefined,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { rawBody: text };
  }
  return { status: res.status, body };
}

let db;

beforeAll(() => {
  let app;
  try {
    app = getApp("clear-errors-test");
  } catch {
    app = initializeApp(config, "clear-errors-test");
  }
  db = getFirestore(app);
});

async function seedExperiment(uid, experimentID) {
  await db.collection("experiments").doc(experimentID).set({
    owner: uid,
    active: true,
    sessions: 0,
    storageProvider: "gdrive",
    providerContainer: { provider: "gdrive", folderId: "irrelevant-folder" },
  });
}

describe("clearErrors — request shape and auth", () => {
  it("returns 405 on GET", async () => {
    const { status } = await callEndpoint(undefined, undefined, { method: "GET" });
    expect(status).toBe(405);
  });

  it("returns 401 when there is no Authorization header", async () => {
    const { status } = await callEndpoint("whatever", undefined);
    expect(status).toBe(401);
  });

  it("returns 401 for a garbage bearer token", async () => {
    const { status } = await callEndpoint("whatever", "not-a-real-token");
    expect(status).toBe(401);
  });

  it("returns 400 when experimentID is missing from the body", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status } = await callEndpoint(undefined, idToken);
    expect(status).toBe(400);
  });

  it("returns 400 when experimentID is an empty string", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status } = await callEndpoint("", idToken);
    expect(status).toBe(400);
  });
});

describe("clearErrors — ownership", () => {
  it("returns 403 for an experiment that does not exist", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status } = await callEndpoint(`no-such-experiment-${randomUUID()}`, idToken);
    expect(status).toBe(403);
  });

  it("returns 403 when the caller does not own the experiment, and does not clear it", async () => {
    const owner = await signUpEmulatorUser();
    const intruder = await signUpEmulatorUser();
    const experimentID = `clear-errors-owned-${randomUUID()}`;
    await seedExperiment(owner.uid, experimentID);
    await db.collection("logs").doc(experimentID).set({
      owner: owner.uid,
      logError: 3,
      errors: [{ error: "UPLOAD_ERROR", message: "boom", time: Timestamp.now() }],
    });

    const { status } = await callEndpoint(experimentID, intruder.idToken);
    expect(status).toBe(403);

    const logSnap = await db.collection("logs").doc(experimentID).get();
    expect(logSnap.get("errorsClearedAt")).toBeUndefined();
    expect(logSnap.get("logErrorCleared")).toBeUndefined();
  });
});

describe("clearErrors — success", () => {
  it("sets errorsClearedAt and logErrorCleared, and leaves errors/logError/errorsByCode untouched", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = `clear-errors-success-${randomUUID()}`;
    await seedExperiment(uid, experimentID);
    const originalErrors = [
      { error: "UPLOAD_ERROR", message: "boom", time: Timestamp.now() },
      { error: "FILE_EXISTS", message: "dupe", time: Timestamp.now() },
    ];
    await db.collection("logs").doc(experimentID).set({
      owner: uid,
      logError: 2,
      errorsByCode: { UPLOAD_ERROR: 1, FILE_EXISTS: 1 },
      errors: originalErrors,
    });

    const { status, body } = await callEndpoint(experimentID, idToken);
    expect(status).toBe(200);
    expect(body).toEqual({ message: "Success" });

    const logSnap = await db.collection("logs").doc(experimentID).get();
    const data = logSnap.data();
    expect(data.errorsClearedAt).toBeInstanceOf(Timestamp);
    expect(data.logErrorCleared).toBe(2);

    // The lifetime record is untouched.
    expect(data.logError).toBe(2);
    expect(data.errorsByCode).toEqual({ UPLOAD_ERROR: 1, FILE_EXISTS: 1 });
    expect(data.errors).toHaveLength(2);
    expect(data.errors.map((e) => e.error)).toEqual(["UPLOAD_ERROR", "FILE_EXISTS"]);
  });

  it("moves the watermark on a second clear after logError has grown", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = `clear-errors-second-${randomUUID()}`;
    await seedExperiment(uid, experimentID);
    await db.collection("logs").doc(experimentID).set({
      owner: uid,
      logError: 1,
      errors: [{ error: "UPLOAD_ERROR", message: "boom", time: Timestamp.now() }],
    });

    const first = await callEndpoint(experimentID, idToken);
    expect(first.status).toBe(200);
    const afterFirst = await db.collection("logs").doc(experimentID).get();
    expect(afterFirst.get("logErrorCleared")).toBe(1);
    const firstClearedAt = afterFirst.get("errorsClearedAt");

    // A later rejection arrives, same shape as write-log.ts's transaction.
    await db
      .collection("logs")
      .doc(experimentID)
      .set(
        {
          logError: FieldValue.increment(1),
          errors: FieldValue.arrayUnion({ error: "FILE_EXISTS", message: "dupe", time: Timestamp.now() }),
        },
        { merge: true }
      );

    const second = await callEndpoint(experimentID, idToken);
    expect(second.status).toBe(200);
    const afterSecond = await db.collection("logs").doc(experimentID).get();
    expect(afterSecond.get("logErrorCleared")).toBe(2);
    expect(afterSecond.get("logError")).toBe(2);
    expect(afterSecond.get("errorsClearedAt").toMillis()).toBeGreaterThanOrEqual(
      firstClearedAt.toMillis()
    );
  });

  it("returns 200 and creates no logs document when one does not exist yet", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = `clear-errors-nolog-${randomUUID()}`;
    await seedExperiment(uid, experimentID);

    const { status } = await callEndpoint(experimentID, idToken);
    expect(status).toBe(200);

    const logSnap = await db.collection("logs").doc(experimentID).get();
    expect(logSnap.exists).toBe(false);
  });
});
