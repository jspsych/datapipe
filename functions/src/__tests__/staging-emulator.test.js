/**
 * @jest-environment node
 *
 * The staging tier end to end, against the emulators: admission, clean
 * completion, and abandonment recovery.
 *
 * Needs the firestore, functions and DATABASE emulators. The hosts are read
 * from the environment (with the repo's usual defaults) rather than hardcoded,
 * so this suite can run when something else on the machine already holds 8080.
 *
 * Style follows data-emulator.test.js: HTTP against the functions emulator for
 * the endpoints, direct module calls for the sweep -- the same split
 * scheduled-pending-recovery-emulator.test.js uses.
 */

// Env BEFORE the module requires, and require() rather than ESM import,
// because ESM imports hoist above assignments -- the same ordering
// scheduled-pending-recovery-emulator.test.js depends on and documents.
// Hosts come from the environment (with this repo's defaults) so the suite can
// run when something else on the machine already holds 8080.
process.env.FIRESTORE_EMULATOR_HOST ||= "localhost:8080";
process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= "localhost:9000";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
// app.js (imported transitively below) calls initializeApp() with no args and
// reads the default bucket from FIREBASE_CONFIG. queueUpload writes the
// recovered payload to Cloud Storage, so without this the sweep fails with
// "Bucket name not specified".
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

const { randomUUID } = require("crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { getDatabaseWithUrl } = require("firebase-admin/database");
const {
  sweepAbandonedSessions,
  ABANDON_GRACE_MS,
} = require("../../lib/scheduled-staging-sweep.js");

const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "localhost:5001";
const PROJECT_ID = "datapipe-test";

jest.setTimeout(30000);

const db = getFirestore();
const rtdb = getDatabaseWithUrl(`https://${PROJECT_ID}-default-rtdb.firebaseio.com`);

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
  const id = `staging-${randomUUID()}`;
  await db.collection("experiments").doc(id).set({
    active: true,
    activeBase64: false,
    activeConditionAssignment: false,
    owner: "staging-testuser",
    title: "staging test",
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

/** Stage `count` trials the way the plugin's flush does. */
async function stageTrials(sessionId, count, from = 0) {
  const updates = {};
  for (let i = from; i < from + count; i++) {
    updates[`trials/${i}`] = JSON.stringify({ trial_index: i, rt: 100 + i });
  }
  updates["meta/lastFlushAt"] = Date.now();
  await rtdb.ref(`staging/${sessionId}`).update(updates);
}

/** What Firebase's servers do when the participant's socket drops. */
async function markAbandoned(sessionId, ageMs = ABANDON_GRACE_MS + 60000) {
  await rtdb.ref(`staging/${sessionId}/meta/abandonedAt`).set(Date.now() - ageMs);
}

const queueEntriesFor = async (experimentID) =>
  (await db.collection("uploadQueue").where("experimentID", "==", experimentID).get())
    .docs.map((d) => d.data());

// Only the docs THIS suite created -- a collection-wide wipe here would delete
// uploadQueue docs belonging to whatever suite is running in parallel, which is
// half of the long-standing cross-suite flake documented in
// scheduled-pending-recovery-emulator.test.js.
const createdExperiments = [];
afterAll(async () => {
  const batch = db.batch();
  for (const id of createdExperiments) {
    const entries = await db
      .collection("uploadQueue")
      .where("experimentID", "==", id)
      .get();
    entries.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(db.collection("experiments").doc(id));
  }
  await batch.commit();
  await rtdb.goOffline();
});

beforeAll(async () => {
  await db.collection("users").doc("staging-testuser").set({
    uid: "staging-testuser",
    email: "staging@example.com",
    experiments: [],
    connectedAccounts: { gdrive: { accessToken: "fake", refreshToken: "fake" } },
  });
});

describe("POST /api/session", () => {
  it("admits a session for an open experiment and records it", async () => {
    const experimentID = await makeExperiment();

    const { status, body } = await startSession({ experimentID, filename: "p01.csv" });

    expect(status).toBe(200);
    expect(body.sessionId).toEqual(expect.any(String));
    expect(body.sessionId.length).toBeGreaterThanOrEqual(20);
    // The plugin gets its configuration from the server, so one published
    // build can talk to both datapipe-test and production.
    expect(body.databaseURL).toEqual(expect.any(String));
    expect(body.maxTrialBytes).toBe(65536);
    expect(body.flushEveryNTrials).toBeGreaterThan(0);

    const record = (await rtdb.ref(`openSessions/${body.sessionId}`).get()).val();
    expect(record.experimentId).toBe(experimentID);
    expect(record.filename).toBe("p01.csv");
    expect(record.expiresAt).toBeGreaterThan(Date.now());
  });

  it("does not consume a session from the researcher's cap", async () => {
    // Counting at admission would charge abandoned participants against
    // maxSessions and double-count against the completion path.
    const experimentID = await makeExperiment();

    await startSession({ experimentID });

    const exp = await db.collection("experiments").doc(experimentID).get();
    expect(exp.data().sessions).toBe(0);
  });

  it("counts the attempt in the experiment log", async () => {
    const experimentID = await makeExperiment();

    await startSession({ experimentID });

    const log = await db.collection("logs").doc(experimentID).get();
    expect(log.data().startSession).toBe(1);
    expect(log.data().owner).toBe("staging-testuser");
  });

  // The four gates, with the same codes /api/data answers, so a participant
  // refused here gets the identical answer they would have got at the end.
  it.each([
    ["a missing experiment", null, "EXPERIMENT_NOT_FOUND"],
    ["a finalized experiment", { finalized: true }, "EXPERIMENT_FINALIZED"],
    ["an inactive experiment", { active: false }, "DATA_COLLECTION_NOT_ACTIVE"],
    [
      "an experiment at its session cap",
      { limitSessions: true, sessions: 5, maxSessions: 5 },
      "SESSION_LIMIT_REACHED",
    ],
  ])("refuses %s", async (_label, overrides, code) => {
    const experimentID = overrides
      ? await makeExperiment(overrides)
      : `staging-missing-${randomUUID()}`;

    const { status, body } = await startSession({ experimentID });

    expect(status).toBe(400);
    expect(body.error).toBe(code);
  });

  it("writes no openSessions entry when a gate refuses", async () => {
    // The gate has to be the thing that stops staging, not a later check.
    const experimentID = await makeExperiment({ finalized: true });
    const before = (await rtdb.ref("openSessions").get()).numChildren();

    await startSession({ experimentID });

    expect((await rtdb.ref("openSessions").get()).numChildren()).toBe(before);
  });

  it("requires an experiment id", async () => {
    const { status, body } = await startSession({});

    expect(status).toBe(400);
    expect(body.error).toBe("MISSING_PARAMETER");
  });

  it("refuses a GET", async () => {
    const response = await fetch(
      `http://${FUNCTIONS_HOST}/${PROJECT_ID}/us-central1/apisessionstart`
    );
    expect(response.status).toBe(405);
  });
});

describe("completion", () => {
  it("drops the staged copy once a gate refuses the submission", async () => {
    // Keeping it would let the sweep re-offer the session as a .partial.json,
    // producing a file the gate just refused -- and, for a finalized
    // experiment, one sitting outside the merged archive.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 3);

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

  it("keeps the staged copy when DataPipe itself fails", async () => {
    // The owner is missing, so the submission fails on DataPipe's side after
    // the gates passed. This is exactly what the staging tier is for: the
    // participant is gone and the staged copy is the last thing standing
    // between that and lost data.
    const experimentID = await makeExperiment({ owner: "no-such-user" });
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 3);

    const { status } = await saveData({
      experimentID,
      filename: "p01.csv",
      data: "trial_type\nhtml-keyboard-response\n",
      sessionId: body.sessionId,
    });

    expect(status).toBe(400);
    expect((await rtdb.ref(`staging/${body.sessionId}/trials`).get()).numChildren()).toBe(3);
    expect((await rtdb.ref(`openSessions/${body.sessionId}`).get()).exists()).toBe(true);
  });

  it("accepts a submission with no sessionId exactly as before", async () => {
    // Full backward compatibility: the non-streaming path must be untouched.
    const experimentID = await makeExperiment({ finalized: true });

    const { status, body } = await saveData({
      experimentID,
      filename: "p01.csv",
      data: "trial_type\nhtml-keyboard-response\n",
    });

    expect(status).toBe(400);
    expect(body.error).toBe("EXPERIMENT_FINALIZED");
  });
});

describe("the abandonment sweep", () => {
  it("recovers an abandoned session as an uncounted partial upload", async () => {
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID, filename: "p07.csv" });
    await stageTrials(body.sessionId, 4);
    await markAbandoned(body.sessionId);

    const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

    expect(stats.recovered).toBe(1);

    const entries = await queueEntriesFor(experimentID);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    // Marked in the name, so a researcher can tell a fragment from a session.
    expect(entry.filename).toBe("p07.partial.json");
    expect(entry.partial).toBe(true);
    expect(entry.status).toBe("pending");
    expect(entry.failureReason).toContain("4 trials");

    // Uncounted: an abandoned participant must not consume the cap.
    const exp = await db.collection("experiments").doc(experimentID).get();
    expect(exp.data().sessions).toBe(0);

    // And the staging node is gone, so it is not paid for or recovered twice.
    expect((await rtdb.ref(`staging/${body.sessionId}`).get()).exists()).toBe(false);
    expect((await rtdb.ref(`openSessions/${body.sessionId}`).get()).exists()).toBe(false);
  });

  it("leaves a live session alone", async () => {
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 2);

    const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

    expect(stats.skippedLive).toBe(1);
    expect(stats.recovered).toBe(0);
    expect((await rtdb.ref(`staging/${body.sessionId}/trials`).get()).numChildren()).toBe(2);
  });

  it("leaves a session alone inside the reconnect grace period", async () => {
    // onDisconnect fires on any socket drop. The grace period is the window in
    // which a reconnecting participant clears the stamp and carries on; acting
    // immediately would write a partial file for someone still doing trials.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 2);
    await markAbandoned(body.sessionId, ABANDON_GRACE_MS / 2);

    const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

    expect(stats.skippedLive).toBe(1);
    expect(await queueEntriesFor(experimentID)).toHaveLength(0);
  });

  it("recovers a session whose client died before onDisconnect ever armed", async () => {
    // The expiry backstop. Without it such a session sits in RTDB forever,
    // being paid for at the highest per-GB rate in the stack.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID, filename: "p09.csv" });
    await stageTrials(body.sessionId, 2);
    await rtdb.ref(`openSessions/${body.sessionId}/expiresAt`).set(Date.now() - 1000);

    const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

    expect(stats.recovered).toBe(1);
    expect((await queueEntriesFor(experimentID))[0].filename).toBe("p09.partial.json");
  });

  it("discards rather than uploads when the experiment was finalized meanwhile", async () => {
    // The second door. A file landing outside a merged archive is the
    // non-Psych-DS state docs/finalization-spec.md exists to prevent, and this
    // path runs minutes to hours after the gates first passed.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 4);
    await markAbandoned(body.sessionId);
    await db.collection("experiments").doc(experimentID).update({ finalized: true });

    const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

    expect(stats.discarded).toBe(1);
    expect(stats.recovered).toBe(0);
    expect(await queueEntriesFor(experimentID)).toHaveLength(0);
    expect((await rtdb.ref(`staging/${body.sessionId}`).get()).exists()).toBe(false);
  });

  it("discards when data collection has been switched off meanwhile", async () => {
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 4);
    await markAbandoned(body.sessionId);
    await db.collection("experiments").doc(experimentID).update({ active: false });

    const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

    expect(stats.discarded).toBe(1);
    expect(await queueEntriesFor(experimentID)).toHaveLength(0);
  });

  it("discards a session that staged nothing, without creating an empty file", async () => {
    // A participant who loaded the page and left. Common, uninteresting, and
    // an empty file would be noise in the researcher's dataset.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await markAbandoned(body.sessionId);

    const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

    expect(stats.discarded).toBe(1);
    expect(await queueEntriesFor(experimentID)).toHaveLength(0);
  });

  it("preserves trial order through recovery", async () => {
    // RTDB returns keys lexicographically, so a recovery without a numeric
    // sort is silently shuffled and the researcher cannot tell.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 12);
    await markAbandoned(body.sessionId);

    await sweepAbandonedSessions(new Set([body.sessionId]));

    // The queued payload is encrypted at rest, so assert through the sweep's
    // own summary rather than re-reading the object here -- ordering itself is
    // covered exhaustively in staging-assembly.test.js.
    const [entry] = await queueEntriesFor(experimentID);
    expect(entry.failureReason).toContain("12 trials");
    expect(entry.failureReason).not.toContain("missing");
  });

  it("records sweep health on every run, including one that did nothing", async () => {
    // A broken sweep is the expensive failure here: orphaned staging data
    // accumulates at ~190x Cloud Storage's per-GB rate while the scheduled
    // function still looks green. A stale lastRunAt is the alarm.
    await sweepAbandonedSessions(new Set());

    const status = await db.collection("systemStatus").doc("staging").get();
    expect(status.exists).toBe(true);
    expect(status.data().lastRunAt.toMillis()).toBeGreaterThan(Date.now() - 60000);
    expect(status.data().openSessionCount).toEqual(expect.any(Number));
    expect(status.data().lastError).toBeNull();
  });
});
