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

const { randomUUID, createHash } = require("crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { getDatabaseWithUrl } = require("firebase-admin/database");
const {
  sweepAbandonedSessions,
  ABANDON_GRACE_MS,
} = require("../../lib/scheduled-staging-sweep.js");
const { discardSession, generateSessionId, resetStagingHandleForTests } = require("../../lib/staging.js");

const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "localhost:5001";
const PROJECT_ID = "datapipe-test";

jest.setTimeout(30000);

const db = getFirestore();
// Assigned in beforeAll from the URL the session endpoint itself reports --
// see the comment there.
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

/**
 * What Firebase's servers do when the participant's socket drops: stamp the
 * current connection's disconnect slot. Written with the Admin SDK so the
 * fixture can be backdated, which the rules (rightly) refuse a client.
 */
async function markAbandoned(sessionId, ageMs = ABANDON_GRACE_MS + 60000, slot = 1) {
  const droppedAt = Date.now() - ageMs;
  // The last flush came before the drop, as it does in reality. Left at "now"
  // (where stageTrials put it) it would read as trials arriving AFTER the
  // stamp -- which disconnectedSince() rightly treats as the participant
  // being back -- and every abandonment fixture would look like a live session.
  await rtdb.ref(`staging/${sessionId}/meta`).update({
    [`disconnects/${slot}`]: droppedAt,
    lastFlushAt: droppedAt - 1000,
  });
}

const queueEntriesFor = async (experimentID) =>
  (await db.collection("uploadQueue").where("experimentID", "==", experimentID).get())
    .docs.map((d) => d.data());

/**
 * Seed `count` synthetic openSessions entries for `experimentID` -- fixtures
 * for reconcileOpenSessionCounts's ground truth, not sessions admitted
 * through tryAdmitSession.
 *
 * reconcileOpenSessionCounts (staging.ts) recomputes an experiment's counter
 * from the REAL entries under openSessions on every sweep run; that is
 * correct behaviour, not drift-tolerance gone wrong, since the counter has no
 * legitimate reason to differ from what is actually open. A test that sets
 * openSessionCounts/{id} directly without any matching openSessions entries
 * is therefore asking the sweep to preserve a value ground truth does not
 * support, and the sweep is right to overwrite it. Tests that seed the
 * counter directly and then run a sweep must seed matching entries here too.
 *
 * expiresAt is set far in the future (a year out, vs. a real session's ~24h)
 * on purpose: listOldestOpenSessions(CANDIDATES_PER_RUN) -- unlike
 * listOpenSessions(), which reconcileOpenSessionCounts uses and does not
 * care about ordering -- orders by expiresAt ascending and takes the
 * OLDEST 30. Hundreds of fixtures at a real session's ~24h expiry would
 * crowd a same-run real session out of that window and make the sweep skip
 * it entirely; parked a year out, they never compete for those slots.
 */
async function seedOpenSessions(experimentID, count) {
  const updates = {};
  for (let i = 0; i < count; i++) {
    updates[`openSessions/concurrency-fixture-${experimentID}-${i}`] = {
      experimentId: experimentID,
      startedAt: Date.now(),
      expiresAt: Date.now() + 365 * 86400000,
    };
  }
  await rtdb.ref().update(updates);
}

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
    const rows = await db.collection("liveSessions").where("experimentID", "==", id).get();
    rows.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(db.collection("experiments").doc(id));
  }
  await batch.commit();
  if (rtdb) await rtdb.goOffline();
});

beforeAll(async () => {
  await db.collection("users").doc("staging-testuser").set({
    uid: "staging-testuser",
    email: "staging@example.com",
    experiments: [],
    connectedAccounts: { gdrive: { accessToken: "fake", refreshToken: "fake" } },
  });

  // WHICH DATABASE NAMESPACE. Learned from the endpoint, not repeated here.
  //
  // The emulated functions take it from STAGING_DATABASE_URL in
  // functions/.env.local, which pins them to the namespace the emulator loads
  // database.rules.json into (see the comment there: left to FIREBASE_CONFIG,
  // an unprovisioned project gets functions and rules in DIFFERENT namespaces,
  // and the sweep's `.indexOn` query fails). This suite asks the endpoint
  // rather than copying that value, so the two cannot drift -- and whatever
  // the endpoint tells a real plugin to connect to is what this suite
  // connects to, which makes the returned databaseURL something exercised
  // here, not just a field whose type is checked. The in-process sweep is
  // pointed at the same place through the same override.
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
    expect(body.maxTrialBytes).toBe(16384);
    // The disconnect-slot cap the rules enforce, so the plugin stops arming at
    // it instead of having stamps refused.
    expect(body.maxDisconnects).toBe(20);
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

describe("the per-experiment concurrency cap", () => {
  // MAX_OPEN_SESSIONS_PER_EXPERIMENT (functions/src/staging-assembly.ts).
  // Seeded directly rather than opened by minting 500 real sessions: the
  // mechanism under test is tryAdmitSession's transaction reading and
  // bounding openSessionCounts/{experimentId}, not the accumulation of 500
  // HTTP round trips to get there.
  const CAP = 500;

  it("refuses the (cap+1)th session and leaves the counter untouched", async () => {
    const experimentID = await makeExperiment();
    await rtdb.ref(`openSessionCounts/${experimentID}`).set(CAP);

    const { status, body } = await startSession({ experimentID });

    expect(status).toBe(503);
    expect(body.error).toBe("SESSION_START_ERROR");
    // The transaction must abort without writing -- a refused admission must
    // not itself be what pushes a counter around.
    expect((await rtdb.ref(`openSessionCounts/${experimentID}`).get()).val()).toBe(CAP);
    // And no capability record was minted for the refused attempt.
    const record = (await rtdb.ref("openSessions").get()).val() || {};
    expect(Object.values(record).some((r) => r.experimentId === experimentID)).toBe(false);
  });

  it("admits the cap-th session and then refuses the next one", async () => {
    const experimentID = await makeExperiment();
    await rtdb.ref(`openSessionCounts/${experimentID}`).set(CAP - 1);

    const { status: admitted } = await startSession({ experimentID });
    expect(admitted).toBe(200);
    expect((await rtdb.ref(`openSessionCounts/${experimentID}`).get()).val()).toBe(CAP);

    const { status: refused, body } = await startSession({ experimentID });
    expect(refused).toBe(503);
    expect(body.error).toBe("SESSION_START_ERROR");
  });

  it("lets a new session in once a prior one is discarded, freeing its slot", async () => {
    const experimentID = await makeExperiment();
    await rtdb.ref(`openSessionCounts/${experimentID}`).set(CAP - 1);

    const { status: firstStatus, body: first } = await startSession({ experimentID });
    expect(firstStatus).toBe(200);

    const { status: refused } = await startSession({ experimentID });
    expect(refused).toBe(503);

    // discardSession() is what every terminal path funnels through --
    // completion, a gate refusal, the sweep -- and it is what must release
    // the slot admission reserved. Called directly, the same way the sweep
    // itself is exercised directly elsewhere in this file, rather than
    // through a full /api/data completion: that path also runs validation,
    // the provider write and the metadata pipeline, none of which this test
    // is about, and routing through it would make this test's pass/fail
    // depend on the mocked provider round trip instead of on the one thing
    // it exists to check -- the counter release.
    await discardSession(first.sessionId);
    expect((await rtdb.ref(`openSessionCounts/${experimentID}`).get()).val()).toBe(CAP - 1);

    const { status: secondStatus } = await startSession({ experimentID });
    expect(secondStatus).toBe(200);
  });

  it("lets a new session in once an abandoned one is swept, freeing its slot", async () => {
    const experimentID = await makeExperiment();
    // A REALISTIC fixture, unlike the two tests above: this one runs a real
    // sweep, and the sweep's reconcileOpenSessionCounts recomputes the
    // counter from the real entries under openSessions every time it runs.
    // A counter seeded without matching sessions behind it would just get
    // corrected back to the true (lower) count -- rightly, since the counter
    // has no legitimate reason to differ from what is actually open. Seeding
    // CAP-1 other open sessions makes CAP-1 the true count once `first` is
    // admitted and then swept away, so this test exercises "does completing
    // one session let another in" rather than "does the sweep preserve an
    // unsupported number".
    await seedOpenSessions(experimentID, CAP - 1);
    await rtdb.ref(`openSessionCounts/${experimentID}`).set(CAP - 1);

    const { body: first } = await startSession({ experimentID }); // CAP-1 seeded + first = CAP real, counter CAP
    expect((await rtdb.ref(`openSessionCounts/${experimentID}`).get()).val()).toBe(CAP);
    await markAbandoned(first.sessionId);

    const stats = await sweepAbandonedSessions(new Set([first.sessionId]));
    expect(stats.discarded).toBe(1); // nothing was staged, so it is discarded not recovered
    // True regardless of which mechanism produced it -- discardSession's own
    // release, or the same run's counter reconciliation catching a missed
    // one -- both are legitimate production paths to the same correct number.
    expect((await rtdb.ref(`openSessionCounts/${experimentID}`).get()).val()).toBe(CAP - 1);

    const { status } = await startSession({ experimentID });
    expect(status).toBe(200);

    // Fixtures only, never picked up by any candidate window (see
    // seedOpenSessions) and so never cleaned up by anything under test --
    // remove them rather than leaving 499 rows in the shared emulator.
    await rtdb
      .ref("openSessions")
      .update(
        Object.fromEntries(
          Array.from({ length: CAP - 1 }, (_, i) => [`concurrency-fixture-${experimentID}-${i}`, null])
        )
      );
  });
});

describe("the streaming kill switch", () => {
  // STREAMING_ENABLED=false is a pure predicate (streamingEnabled(), unit
  // tested in staging-assembly.test.js) precisely because the functions
  // emulator cannot be re-configured mid-suite to exercise the disabled
  // branch here. What this suite CAN pin is the other half: every deployment
  // today has STREAMING_ENABLED unset, and that must keep minting sessions
  // exactly as it always has.
  it("is enabled by default", async () => {
    const experimentID = await makeExperiment();

    const { status, body } = await startSession({ experimentID });

    expect(status).toBe(200);
    expect(body.sessionId).toEqual(expect.any(String));
  });
});

describe("completion", () => {
  it("releases the concurrency-cap slot on a genuine, non-refused completion", async () => {
    // THE GAP THIS CLOSES: an earlier version of "lets a new session in once
    // a prior one completes" (the per-experiment concurrency cap tests above)
    // routed through a real /api/data completion and read
    // openSessionCounts/<experimentID> as 500 instead of 499 afterwards. That
    // test was rewritten to call discardSession() directly, which proves
    // discardSession releases a slot but nothing end-to-end proved that a
    // real completion actually REACHES discardSession.
    //
    // ROOT CAUSE, FOUND HERE: "staging-testuser" (this file's shared owner
    // fixture, set up in the top-level beforeAll) has
    // connectedAccounts.gdrive = { accessToken, refreshToken }.
    // providers/gdrive.ts's resolveToken() reads
    // connectedAccounts.gdrive.encryptedToken and .tokenExpiresAt -- neither
    // of which that fixture sets -- so EVERY completion attempt against it
    // fails at token resolution, before ever reaching discardStaging. That is
    // the "DataPipe itself fails" branch ("keeps the staged copy when
    // DataPipe itself fails", below), which by design leaves the staged copy
    // AND its counter slot in place for the sweep to recover. The original
    // 500-instead-of-499 reading was that correct, intentional behaviour,
    // not a bug -- it just meant the test believed it was exercising a real
    // completion when it was actually exercising a token failure.
    //
    // This test uses its OWN owner, with a token shape resolveToken() can
    // actually resolve, so the request clears every gate and reaches the
    // provider. It still cannot get a literal 201: this file has no mock
    // Google Drive server listening on GDRIVE_API_BASE (gdrive-emulator.test.js
    // owns that fixed port, 127.0.0.1:3579, for the whole test run, and two
    // listeners on it would collide). The unreachable host makes
    // claimFilename's cold-cache rehydration throw, which api-data.ts treats
    // as a retryable provider failure -- queued (202), not refused -- and
    // that branch calls discardStaging on the way to responding, exactly as
    // a real 201 would. That is the property this test actually needs: a
    // genuine, accepted completion, not a specific status code.
    const ownerId = `staging-token-ok-${randomUUID()}`;
    await db.collection("users").doc(ownerId).set({
      uid: ownerId,
      email: "staging-token-ok@example.com",
      experiments: [],
      connectedAccounts: {
        gdrive: {
          // decrypt()'s plaintext fallback (crypto-utils.ts): any string
          // without the "v1:" version prefix round-trips unchanged, so this
          // does not need TOKEN_ENCRYPTION_KEY to agree between this process
          // and the functions emulator's.
          encryptedToken: "fake-access-token",
          tokenExpiresAt: Date.now() + 60 * 60 * 1000,
        },
      },
    });

    const experimentID = await makeExperiment({ owner: ownerId });
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 3);

    expect((await rtdb.ref(`openSessionCounts/${experimentID}`).get()).val()).toBe(1);

    const { status, body: response } = await saveData({
      experimentID,
      filename: "p01.csv",
      data: "trial_type\nhtml-keyboard-response\n",
      sessionId: body.sessionId,
    });

    // A genuine, accepted completion -- not a gate refusal (400) and not a
    // DataPipe-side failure (400) -- so discardStaging is reached exactly as
    // it would be for a real 201.
    expect(status).toBe(202);
    expect(response.error).toBeNull();
    expect((await rtdb.ref(`staging/${body.sessionId}`).get()).exists()).toBe(false);
    expect((await rtdb.ref(`openSessions/${body.sessionId}`).get()).exists()).toBe(false);

    // THE ASSERTION THE ORIGINAL REGRESSION NEEDED: the slot this session
    // reserved at admission is released once its completion -- discardStaging,
    // running inside apidata's real handler -- has actually happened. Absent
    // or 0 either way: releaseOpenSessionSlot always writes 0 rather than
    // deleting the node, but nothing here depends on which.
    const counter = (await rtdb.ref(`openSessionCounts/${experimentID}`).get()).val();
    expect(counter === null || counter === 0).toBe(true);

    await db.collection("users").doc(ownerId).delete();
  });

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

  it("leaves the staged copy in place when the submission itself is refused as invalid", async () => {
    // INVALID_DATA is a refusal about THIS SUBMISSION -- this string failed
    // validation -- not about whether the experiment accepts data at all. The
    // participant's staged trials are unaffected by that verdict, and
    // discarding them would destroy the one recoverable copy in exactly the
    // case the staging tier exists for: a browser that is never coming back
    // to retry with a better-formed payload. Contrast with the finalized-gate
    // test above, which still discards.
    const experimentID = await makeExperiment({
      useValidation: true,
      allowJSON: true,
      allowCSV: false,
      requiredFields: [],
    });
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 3);

    const { status, body: response } = await saveData({
      experimentID,
      filename: "p01.json",
      data: "this is not valid json",
      sessionId: body.sessionId,
    });

    expect(status).toBe(400);
    expect(response.error).toBe("INVALID_DATA");
    expect((await rtdb.ref(`staging/${body.sessionId}/trials`).get()).numChildren()).toBe(3);
    expect((await rtdb.ref(`openSessions/${body.sessionId}`).get()).exists()).toBe(true);
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
    // Marked in the name, so a researcher can tell a fragment from a session
    // -- and suffixed with a hash of the session id, so two sessions named
    // "p07.csv" cannot collide on the same recovered file.
    const suffix = createHash("sha256").update(body.sessionId).digest("hex").slice(0, 8);
    expect(entry.filename).toBe(`p07-${suffix}.partial.json`);
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

  it("leaves a session alone once its dropout has been answered", async () => {
    // The participant's wifi dropped long ago and they came back: slot 1 has
    // its reconnect mark. Recovering this would write a partial file for
    // someone still doing trials.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 2);
    await markAbandoned(body.sessionId);
    await rtdb.ref(`staging/${body.sessionId}/meta/reconnects/1`).set(Date.now());

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
    const suffix = createHash("sha256").update(body.sessionId).digest("hex").slice(0, 8);
    expect((await queueEntriesFor(experimentID))[0].filename).toBe(`p09-${suffix}.partial.json`);
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

  it("recovers a session with more trials than fit in one assembly page, in full", async () => {
    // assembleSession (staging.ts) reads the staging tree in pages of 200 --
    // this is the one thing the pure paging tests (staging-assembly.test.js)
    // cannot cover, because they fake the page fetcher rather than exercising
    // RTDB's own orderByKey().startAfter() pagination. 250 trials forces a
    // second page.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID, filename: "p20.csv" });
    await stageTrials(body.sessionId, 250);
    await markAbandoned(body.sessionId);

    const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

    expect(stats.recovered).toBe(1);
    const entries = await queueEntriesFor(experimentID);
    expect(entries).toHaveLength(1);
    expect(entries[0].failureReason).toContain("250 trials");
    expect(entries[0].failureReason).not.toContain("missing");
    expect(entries[0].failureReason).not.toContain("truncated");
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
    expect(status.data().pages).toEqual(expect.any(Number));
    expect(status.data().lastError).toBeNull();
  });

  it("pages past a wall of live sessions to recover an abandoned one behind them", async () => {
    // Regression for candidate starvation: sessions skipped as live used to
    // consume candidate slots with no cursor advancing, so a page's worth of
    // long-lived or zombie sessions at the head of the queue could block
    // recovery of everything behind them for up to 24 hours.
    const experimentID = await makeExperiment();
    // Far enough out that these fixtures sort ahead of every other open
    // session in the shared emulator (which default to ~24h out), but the
    // exact value doesn't matter -- only the ordering between these fixtures
    // does.
    const base = Date.now() + 5 * 60000;

    // More than one page (CANDIDATES_PER_PAGE = MAX_SESSIONS_PER_RUN * 3 = 30)
    // of live sessions, each with a smaller `expiresAt` than the target below
    // -- so they sort first and the target lands on a later page. Written
    // directly to RTDB (bypassing the session-start endpoint) so the fixture
    // stays fast: only the fields the sweep actually reads matter here.
    const wallSize = 35;
    for (let i = 0; i < wallSize; i++) {
      const sessionId = generateSessionId();
      await rtdb.ref(`openSessions/${sessionId}`).set({
        experimentId: experimentID,
        owner: "staging-testuser",
        startedAt: Date.now(),
        expiresAt: base + i,
      });
    }

    const { body } = await startSession({ experimentID, filename: "behind-the-wall.csv" });
    // Push this session's expiry behind the whole wall above.
    await rtdb.ref(`openSessions/${body.sessionId}/expiresAt`).set(base + wallSize + 1000);
    await stageTrials(body.sessionId, 3);
    await markAbandoned(body.sessionId);

    const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

    expect(stats.recovered).toBe(1);
    // The whole point: more than one page had to be fetched to reach it.
    expect(stats.pages).toBeGreaterThan(1);

    const suffix = createHash("sha256").update(body.sessionId).digest("hex").slice(0, 8);
    const entries = await queueEntriesFor(experimentID);
    expect(entries.map((e) => e.filename)).toContain(`behind-the-wall-${suffix}.partial.json`);
  });

  it("keeps two abandoned sessions that share a client-supplied filename as distinct queue entries", async () => {
    // Without a session-id suffix on the recovered filename, both sessions
    // would compute the SAME `experimentID:filename` deduplication key in
    // queue-upload.ts, and the second recovery would silently overwrite the
    // first session's payload in Cloud Storage before either one is
    // delivered.
    const experimentID = await makeExperiment();

    const first = await startSession({ experimentID, filename: "data.csv" });
    await stageTrials(first.body.sessionId, 2);
    await markAbandoned(first.body.sessionId);

    const second = await startSession({ experimentID, filename: "data.csv" });
    await stageTrials(second.body.sessionId, 5);
    await markAbandoned(second.body.sessionId);

    const stats = await sweepAbandonedSessions(
      new Set([first.body.sessionId, second.body.sessionId])
    );

    expect(stats.recovered).toBe(2);
    const entries = await queueEntriesFor(experimentID);
    expect(entries).toHaveLength(2);
    const filenames = entries.map((e) => e.filename);
    // Distinct docs, distinct filenames -- not one overwriting the other.
    expect(new Set(filenames).size).toBe(2);
    filenames.forEach((f) => expect(f).toMatch(/^data-[0-9a-f]{8}\.partial\.json$/));
  });

  it("does not report a session as recovered when its discard fails", async () => {
    // Regression: discardSession used to swallow its own RTDB error and the
    // sweep reported "recovered" regardless of whether the staging node was
    // actually removed. If the failure happens AFTER the queue entry is
    // written, the session is still sitting in openSessions afterwards and
    // the next run reassembles and re-queues it -- a duplicate delivery if
    // the first entry has already completed by then (covered separately
    // below).
    //
    // Faked here via the seam discardSession already has: an id that fails
    // isValidSessionId is refused before it ever touches RTDB, returning
    // false without throwing -- exactly the "discard failed, non-throwing"
    // contract being tested. openSession() never mints an id shaped like
    // this; writing one directly is what stands in for "the RTDB write
    // failed" here.
    const experimentID = await makeExperiment();
    const badId = "not-a-real-session-id";
    await rtdb.ref(`openSessions/${badId}`).set({
      experimentId: experimentID,
      owner: "staging-testuser",
      startedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      filename: "p01.csv",
    });
    await stageTrials(badId, 3);
    await markAbandoned(badId);

    try {
      const stats = await sweepAbandonedSessions(new Set([badId]));

      expect(stats.recovered).toBe(0);
      expect(stats.discarded).toBe(0);
      expect(stats.errors).toBeGreaterThanOrEqual(1);

      // The data WAS queued -- this is about the REPORT, not about queueing
      // having failed too.
      const entries = await queueEntriesFor(experimentID);
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe("pending");

      // And the staging node genuinely still exists, exactly as a false
      // discardOk promised -- next run will see it again.
      expect((await rtdb.ref(`staging/${badId}`).get()).exists()).toBe(true);
      expect((await rtdb.ref(`openSessions/${badId}`).get()).exists()).toBe(true);
    } finally {
      // discardSession refuses this id by design, so nothing else will clean
      // it up.
      await rtdb.ref(`staging/${badId}`).remove();
      await rtdb.ref(`openSessions/${badId}`).remove();
    }
  });

  it("does not re-queue a session whose recovery already completed before a discard failure", async () => {
    // The other half of the fix above: partialFilenameFor is a pure function
    // of the session, so a session that is STILL staged only because its
    // discard failed computes the identical deduplication key on the next
    // run. queueUpload's own dedup logic only special-cases "pending" and
    // "processing" -- a "completed" doc falls through and gets freshly
    // re-queued -- so without this check a second copy of an already-
    // delivered partial would reach the provider.
    const experimentID = await makeExperiment();
    const badId = "already-delivered-fixture"; // fails isValidSessionId, as above
    await rtdb.ref(`openSessions/${badId}`).set({
      experimentId: experimentID,
      owner: "staging-testuser",
      startedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      filename: "p02.csv",
    });
    await stageTrials(badId, 3);
    await markAbandoned(badId);

    const suffix = createHash("sha256").update(badId).digest("hex").slice(0, 8);
    const filename = `p02-${suffix}.partial.json`;
    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    await db.collection("uploadQueue").doc(docId).set({
      experimentID,
      owner: "staging-testuser",
      filename,
      storagePath: `upload-queue/${docId}`,
      dataType: "data",
      status: "completed",
      errorCode: 0,
      retryCount: 0,
      maxRetries: 5,
      createdAt: new Date(),
      completedAt: new Date(),
      deduplicationKey: `${experimentID}:${filename}`,
      sessionIncremented: false,
      partial: true,
    });

    try {
      await sweepAbandonedSessions(new Set([badId]));

      // The pre-existing completed doc must be untouched, not overwritten
      // back to "pending" by a fresh re-queue.
      const doc = await db.collection("uploadQueue").doc(docId).get();
      expect(doc.data().status).toBe("completed");
      const entries = await queueEntriesFor(experimentID);
      expect(entries).toHaveLength(1);
    } finally {
      await rtdb.ref(`staging/${badId}`).remove();
      await rtdb.ref(`openSessions/${badId}`).remove();
      await db.collection("uploadQueue").doc(docId).delete();
    }
  });

  it("records health and does not throw when the staging database is unreachable", async () => {
    // The design doc's requirement: a broken sweep must show up as a recorded
    // failure, never as an uncaught exception that takes the scheduled
    // function down without a trace. Port 1 refuses the connection
    // immediately, so this stays fast and needs no real network access.
    const originalUrl = process.env.STAGING_DATABASE_URL;
    process.env.STAGING_DATABASE_URL = "http://127.0.0.1:1/?ns=unreachable-staging-test";
    resetStagingHandleForTests();

    try {
      const stats = await sweepAbandonedSessions(new Set());
      expect(stats.errors).toBeGreaterThan(0);
    } finally {
      process.env.STAGING_DATABASE_URL = originalUrl;
      resetStagingHandleForTests();
    }
  });
});

// ---------------------------------------------------------------------------
// The live-sessions mirror (functions/src/live-sessions.ts)
// ---------------------------------------------------------------------------

/**
 * The mirror document id for a session, recomputed here rather than imported:
 * it is the only thing between a researcher's browser and a write capability,
 * so the suite checks the rule, not the module's opinion of it.
 */
const publicId = (sessionId) =>
  createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
const mirrorRef = (sessionId) => db.collection("liveSessions").doc(publicId(sessionId));

/** Poll until `check` returns truthy -- the trigger runs asynchronously. */
async function eventually(check, { timeoutMs = 15000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last;
}

describe("the live-sessions mirror", () => {
  it("writes a row the owner can see when a session starts, holding no session id", async () => {
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID, filename: "p01.csv" });

    const snap = await mirrorRef(body.sessionId).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toMatchObject({
      experimentID,
      owner: "staging-testuser",
      state: "active",
      disconnectedAt: null,
      recoverAfter: null,
    });
    expect(snap.data().startedAt.toMillis()).toBeGreaterThan(Date.now() - 60000);
    // The session id is a write capability; the filename was deliberately
    // left off the dashboard.
    const raw = JSON.stringify(snap.data());
    expect(raw).not.toContain(body.sessionId);
    expect(raw).not.toContain("p01");
  });

  it("removes the row when a gate refuses the submission", async () => {
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await db.collection("experiments").doc(experimentID).update({ finalized: true });

    await saveData({
      experimentID,
      filename: "p01.csv",
      data: "trial_type\nhtml-keyboard-response\n",
      sessionId: body.sessionId,
    });

    expect((await mirrorRef(body.sessionId).get()).exists).toBe(false);
  });

  it("keeps the row when DataPipe itself fails, since the session is still recoverable", async () => {
    const experimentID = await makeExperiment({ owner: "no-such-user" });
    const { body } = await startSession({ experimentID });

    await saveData({
      experimentID,
      filename: "p01.csv",
      data: "trial_type\nhtml-keyboard-response\n",
      sessionId: body.sessionId,
    });

    expect((await mirrorRef(body.sessionId).get()).exists).toBe(true);
  });

  it("removes the row when the sweep recovers the session", async () => {
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 2);
    await markAbandoned(body.sessionId);

    await sweepAbandonedSessions(new Set([body.sessionId]));

    expect((await mirrorRef(body.sessionId).get()).exists).toBe(false);
  });

  it("shows a dropout within seconds, and clears it when the participant returns", async () => {
    // Through the real trigger, running in the functions emulator.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 2);

    await markAbandoned(body.sessionId, 1000);
    const dropped = await eventually(async () => {
      const d = (await mirrorRef(body.sessionId).get()).data();
      return d?.state === "disconnected" ? d : null;
    });
    expect(dropped).toBeTruthy();
    // When "may resume" becomes "being recovered", so the dashboard never
    // needs its own copy of the grace period.
    expect(dropped.recoverAfter.toMillis() - dropped.disconnectedAt.toMillis()).toBe(
      ABANDON_GRACE_MS
    );

    await rtdb.ref(`staging/${body.sessionId}/meta/reconnects/1`).set(Date.now());
    const back = await eventually(async () => {
      const d = (await mirrorRef(body.sessionId).get()).data();
      return d?.state === "active" ? d : null;
    });
    expect(back).toMatchObject({ disconnectedAt: null, recoverAfter: null });
  });

  it("never brings back a finished session's row on a late dropout event", async () => {
    // The trigger uses update(), not set(), for exactly this: completion
    // deleted the row, and a disconnect event arriving afterwards must not
    // leave a ghost on the researcher's dashboard.
    const experimentID = await makeExperiment();
    const { body } = await startSession({ experimentID });
    await db.collection("experiments").doc(experimentID).update({ finalized: true });
    await saveData({
      experimentID,
      filename: "p01.csv",
      data: "trial_type\nhtml-keyboard-response\n",
      sessionId: body.sessionId,
    });
    expect((await mirrorRef(body.sessionId).get()).exists).toBe(false);

    // A stamp landing after the session is gone (written as admin: the rules
    // would refuse a client, which is the other half of the protection).
    await rtdb.ref(`staging/${body.sessionId}/meta/disconnects/1`).set(Date.now());
    // Waiting for an absence: give the trigger well over the ~100ms it takes.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect((await mirrorRef(body.sessionId).get()).exists).toBe(false);
    await rtdb.ref(`staging/${body.sessionId}`).remove();
  });

  describe("reconciliation, every sweep run", () => {
    it("rebuilds a row whose write at session start was lost", async () => {
      const experimentID = await makeExperiment();
      const { body } = await startSession({ experimentID });
      await mirrorRef(body.sessionId).delete();

      const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

      expect(stats.mirrorFixed).toBeGreaterThanOrEqual(1);
      expect((await mirrorRef(body.sessionId).get()).data()).toMatchObject({
        experimentID,
        owner: "staging-testuser",
        state: "active",
      });
    });

    it("corrects a row whose dropout event was lost", async () => {
      const experimentID = await makeExperiment();
      const { body } = await startSession({ experimentID });
      await mirrorRef(body.sessionId).update({ state: "disconnected" });

      const stats = await sweepAbandonedSessions(new Set([body.sessionId]));

      expect(stats.mirrorFixed).toBeGreaterThanOrEqual(1);
      expect((await mirrorRef(body.sessionId).get()).data().state).toBe("active");
    });

    it("removes a ghost row for a session that has ended", async () => {
      const experimentID = await makeExperiment();
      const ghost = `ghost-${randomUUID()}`;
      await mirrorRef(ghost).set({
        experimentID,
        owner: "staging-testuser",
        state: "active",
        startedAt: new Date(Date.now() - 10 * 60000),
      });

      const stats = await sweepAbandonedSessions(new Set([ghost]));

      expect(stats.mirrorFixed).toBe(1);
      expect((await mirrorRef(ghost).get()).exists).toBe(false);
    });

    it("leaves alone a row created after the sweep read the open sessions", async () => {
      // Otherwise a participant who started a second ago vanishes from the
      // dashboard until the next run.
      const experimentID = await makeExperiment();
      const fresh = `fresh-${randomUUID()}`;
      await mirrorRef(fresh).set({
        experimentID,
        owner: "staging-testuser",
        state: "active",
        startedAt: new Date(Date.now() + 5000),
      });

      await sweepAbandonedSessions(new Set([fresh]));

      expect((await mirrorRef(fresh).get()).exists).toBe(true);
      await mirrorRef(fresh).delete();
    });

    it("reports how many fixes it needed", async () => {
      await sweepAbandonedSessions(new Set());

      const status = await db.collection("systemStatus").doc("staging").get();
      expect(status.data().mirrorFixed).toBe(0);
      expect(status.data().mirror).toEqual({ created: 0, updated: 0, deleted: 0 });
    });
  });
});

