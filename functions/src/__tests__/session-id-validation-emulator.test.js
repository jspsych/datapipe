/**
 * @jest-environment node
 *
 * Regression coverage for the sessionId path-injection bug in
 * discardStaging() (api-data.ts) / discardSession() (staging.ts).
 *
 * discardSession splices a client-supplied sessionId straight into two RTDB
 * paths: `staging/${sessionId}` and `openSessions/${sessionId}`. The Admin
 * SDK normalizes a path by dropping empty segments before it reaches the
 * wire, so a body of `{"sessionId": "/"}` resolved to "/staging" and
 * "/openSessions" THEMSELVES -- a multi-path update setting the root of both
 * tables to null, deleting every in-progress session for every experiment.
 * It was reachable unauthenticated: discardStaging() runs on the finalized /
 * inactive / session-cap / validation gates before any upload, so a closed or
 * inactive experiment id was all an attacker needed.
 *
 * isValidSessionId() (staging.ts) now gates both api-data.ts's call and
 * discardSession() itself. This suite proves the exploit no longer works and,
 * just as importantly, that a genuine matching session id is still discarded
 * exactly as before.
 *
 * Needs the firestore, functions and DATABASE emulators, same as
 * staging-emulator.test.js (read there for the full rationale of this setup).
 */

// Env BEFORE the module requires -- see staging-emulator.test.js for why.
process.env.FIRESTORE_EMULATOR_HOST ||= "localhost:8080";
process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= "localhost:9000";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

const { randomUUID } = require("crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { getDatabaseWithUrl } = require("firebase-admin/database");
// Initializes the Admin SDK (app.ts's initializeApp()) as a side effect of the
// require, the same way staging-emulator.test.js gets it for free by
// requiring scheduled-staging-sweep.js before its own `getFirestore()` call.
// Without this, getFirestore() below throws "The default Firebase app does
// not exist" -- there is no other initializeApp() call anywhere in this file.
require("../../lib/staging.js");

const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "localhost:5001";
const PROJECT_ID = "datapipe-test";

jest.setTimeout(30000);

const db = getFirestore();
// Assigned in beforeAll from the URL the session endpoint itself reports --
// see staging-emulator.test.js's beforeAll for why this is asked of the
// endpoint rather than guessed.
let rtdb;

async function post(fn, body) {
  const response = await fetch(
    `http://${FUNCTIONS_HOST}/${PROJECT_ID}/us-central1/${fn}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "*/*" },
      body: JSON.stringify(body),
    }
  );
  return { status: response.status, body: await response.json() };
}

const startSession = (body) => post("apisessionstart", body);
const saveData = (body) => post("apidata", body);

/** A fresh, open, Drive-backed experiment. Every test gets its own. */
async function makeExperiment(overrides = {}) {
  const id = `session-id-validation-${randomUUID()}`;
  await db.collection("experiments").doc(id).set({
    active: true,
    activeBase64: false,
    activeConditionAssignment: false,
    owner: "session-id-validation-testuser",
    title: "session id validation test",
    sessions: 0,
    nConditions: 1,
    currentCondition: 0,
    useValidation: false,
    allowJSON: true,
    allowCSV: true,
    requiredFields: [],
    maxSessions: 100,
    limitSessions: false,
    storageProvider: "gdrive",
    providerContainer: { kind: "gdrive", folderId: "folder-1" },
    ...overrides,
  });
  createdExperiments.push(id);
  return id;
}

const createdExperiments = [];
afterAll(async () => {
  const batch = db.batch();
  for (const id of createdExperiments) {
    const entries = await db
      .collection("uploadQueue")
      .where("experimentID", "==", id)
      .get();
    entries.docs.forEach((d) => batch.delete(d.ref));
    const rows = await db.collection("liveSessions").where("experimentID", "==", id).get();
    rows.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(db.collection("experiments").doc(id));
  }
  await batch.commit();
  if (rtdb) await rtdb.goOffline();
});

beforeAll(async () => {
  // WHICH DATABASE NAMESPACE -- learned from the endpoint, not repeated here.
  // See staging-emulator.test.js's beforeAll for the full rationale.
  const probe = await makeExperiment();
  const { status, body } = await startSession({ experimentID: probe });
  if (status !== 200 || !body.databaseURL) {
    throw new Error(
      `Session endpoint unavailable (HTTP ${status}); is the functions emulator warm? ` +
        JSON.stringify(body)
    );
  }
  process.env.STAGING_DATABASE_URL = body.databaseURL;
  rtdb = getDatabaseWithUrl(body.databaseURL);
});

describe("sessionId path-injection guard on POST /api/data", () => {
  it("does not touch openSessions or staging when sessionId is a bare slash", async () => {
    // Two genuinely open sessions, belonging to two DIFFERENT experiments --
    // exactly the "every in-progress session for every experiment" blast
    // radius the bug had, not just the one on the attacked request.
    const victimExperimentA = await makeExperiment();
    const { body: victimA } = await startSession({
      experimentID: victimExperimentA,
      filename: "victim-a.csv",
    });
    const victimExperimentB = await makeExperiment();
    const { body: victimB } = await startSession({
      experimentID: victimExperimentB,
      filename: "victim-b.csv",
    });

    expect((await rtdb.ref(`openSessions/${victimA.sessionId}`).get()).exists()).toBe(true);
    expect((await rtdb.ref(`openSessions/${victimB.sessionId}`).get()).exists()).toBe(true);

    // The attacked request: any request that reaches discardStaging() before
    // uploading (finalized, here) is enough -- it does not even need a real
    // session of its own.
    const attackedExperiment = await makeExperiment({ finalized: true });

    const { status, body } = await saveData({
      experimentID: attackedExperiment,
      filename: "attack.csv",
      data: "trial_type\nhtml-keyboard-response\n",
      sessionId: "/",
    });

    expect(status).toBe(400);
    expect(body.error).toBe("EXPERIMENT_FINALIZED");

    // Both unrelated, still-open sessions must have survived.
    expect((await rtdb.ref(`openSessions/${victimA.sessionId}`).get()).exists()).toBe(true);
    expect((await rtdb.ref(`openSessions/${victimB.sessionId}`).get()).exists()).toBe(true);
  });

  it.each([
    ["a double slash", "//"],
    ["an embedded slash", "a/b"],
    ["a parent-directory segment", "../x"],
  ])("also refuses %s rather than treating it as a session id", async (_label, malicious) => {
    const victimExperiment = await makeExperiment();
    const { body: victim } = await startSession({
      experimentID: victimExperiment,
      filename: "victim.csv",
    });

    const attackedExperiment = await makeExperiment({ active: false });

    const { status, body } = await saveData({
      experimentID: attackedExperiment,
      filename: "attack.csv",
      data: "trial_type\nhtml-keyboard-response\n",
      sessionId: malicious,
    });

    expect(status).toBe(400);
    expect(body.error).toBe("DATA_COLLECTION_NOT_ACTIVE");
    expect((await rtdb.ref(`openSessions/${victim.sessionId}`).get()).exists()).toBe(true);
  });

  it("still discards a session when the id is valid and matches the request", async () => {
    // The guard must not break the normal, non-malicious path it sits in
    // front of.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID, filename: "p01.csv" });

    await db.collection("experiments").doc(experimentID).update({ finalized: true });

    const { status } = await saveData({
      experimentID,
      filename: "p01.csv",
      data: "trial_type\nhtml-keyboard-response\n",
      sessionId: body.sessionId,
    });

    expect(status).toBe(400);
    expect((await rtdb.ref(`staging/${body.sessionId}`).get()).exists()).toBe(false);
    expect((await rtdb.ref(`openSessions/${body.sessionId}`).get()).exists()).toBe(false);
  });
});
