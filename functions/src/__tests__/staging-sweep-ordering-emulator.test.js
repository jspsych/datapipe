/**
 * @jest-environment node
 *
 * Proves the claim scheduled-sweep-core.ts's `runSweep` ordering comment
 * makes and queue-upload.ts's `attemptImmediately` exists to keep true: a
 * session recovered by THIS tick's staging sweep is actually due -- not just
 * "due sometime today" -- by the time THIS SAME tick's upload-retry pass
 * runs, and gets delivered without waiting for the next 5-minute tick.
 *
 * A dedicated file rather than an addition to staging-emulator.test.js or
 * upload-queue.test.js, because it needs BOTH of those suites' seams at once
 * -- staging-emulator.test.js's real session-start/stage/abandon HTTP flow
 * AND upload-queue.test.js's mocked-fetch direct import of the real retry
 * worker -- and staging-emulator.test.js's fixtures share one hardcoded
 * owner ("staging-testuser") with docs that live until its own afterAll, so
 * scoping a real retryPendingUploads(ownerScope) call into that file would
 * also sweep up every earlier test's leftover queue entries. A fresh,
 * randomly-generated owner per test here sidesteps that entirely (the same
 * `ownerScope` seam scheduled-upload-retry.ts already exists for).
 */

process.env.FIRESTORE_EMULATOR_HOST ||= "localhost:8080";
process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= "localhost:9000";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

import { randomUUID } from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getDatabaseWithUrl } from "firebase-admin/database";
import { fnUrl } from "./helpers/fn-url.js";

// Same stub as upload-queue.test.js / mail-retry-emulator.test.js: the
// compiled scheduled-upload-retry.js pulls in every provider adapter, each of
// which imports ESM-only "node-fetch" at module scope, which Jest's CJS
// transform cannot parse. This test drives the write to a single success
// response for the dataverse adapter -- the same shape
// upload-queue.test.js's base64 test uses.
const mockFetch = jest.fn();
jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

jest.setTimeout(30000);

// Deferred to beforeAll, AFTER the dynamic import below runs: that import is
// what triggers app.js's bare initializeApp() (see queue-upload.js /
// scheduled-staging-sweep.js), and getFirestore() needs a default app to
// already exist. Calling it here at module scope -- before anything has
// initialized one -- is exactly the ordering bug this comment is guarding
// against.
let db;
let rtdb;
let sweepAbandonedSessions;
let retryPendingUploads;

async function postUrl(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const startSession = (body) => postUrl(fnUrl("/api/session"), body);

async function stageTrials(sessionId, count) {
  const updates = {};
  for (let i = 0; i < count; i++) {
    updates[`trials/${i}`] = JSON.stringify({ trial_index: i, rt: 100 + i });
  }
  updates["meta/lastFlushAt"] = Date.now();
  await rtdb.ref(`staging/${sessionId}`).update(updates);
}

// Mirrors staging-emulator.test.js's markAbandoned: stamp a disconnect slot
// old enough to clear ABANDON_GRACE_MS, with the last flush timestamped
// before it so disconnectedSince() doesn't read the fixture as "back online".
async function markAbandoned(sessionId, ageMs) {
  const droppedAt = Date.now() - ageMs;
  await rtdb.ref(`staging/${sessionId}/meta`).update({
    "disconnects/1": droppedAt,
    lastFlushAt: droppedAt - 1000,
  });
}

const createdExperiments = [];
const createdOwners = [];

afterAll(async () => {
  const batch = db.batch();
  for (const id of createdExperiments) {
    const entries = await db.collection("uploadQueue").where("experimentID", "==", id).get();
    entries.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(db.collection("experiments").doc(id));
  }
  for (const owner of createdOwners) {
    batch.delete(db.collection("users").doc(owner));
  }
  await batch.commit();
  if (rtdb) await rtdb.goOffline();
});

beforeAll(async () => {
  ({ sweepAbandonedSessions } = await import("../../lib/scheduled-staging-sweep.js"));
  ({ retryPendingUploads } = await import("../../lib/scheduled-upload-retry.js"));
  db = getFirestore();

  // Same database-namespace discovery as staging-emulator.test.js: ask the
  // real session endpoint for the databaseURL it hands the plugin, rather
  // than guessing at STAGING_DATABASE_URL ourselves.
  const owner = `sweep-order-probe-${randomUUID()}`;
  createdOwners.push(owner);
  await db.collection("experiments").doc("sweep-order-probe").set({
    active: true,
    owner,
    sessions: 0,
    nConditions: 1,
    currentCondition: 0,
    maxSessions: 100,
    limitSessions: false,
    storageProvider: "dataverse",
    providerContainer: { provider: "dataverse", datasetId: 1, persistentId: "doi:x/y", serverUrl: "https://example.test" },
  });
  createdExperiments.push("sweep-order-probe");
  const { status, body } = await startSession({ experimentID: "sweep-order-probe" });
  if (status !== 200 || !body.databaseURL) {
    throw new Error(`Session endpoint unavailable (HTTP ${status}); is the functions emulator warm?`);
  }
  process.env.STAGING_DATABASE_URL = body.databaseURL;
  rtdb = getDatabaseWithUrl(body.databaseURL);
});

beforeEach(() => {
  mockFetch.mockReset();
});

async function makeOwnerAndExperiment() {
  const owner = `sweep-order-owner-${randomUUID()}`;
  const experimentID = `sweep-order-exp-${randomUUID()}`;
  createdOwners.push(owner);
  createdExperiments.push(experimentID);

  await db.collection("users").doc(owner).set({
    email: `${owner}@example.test`,
    connectedAccounts: {
      dataverse: {
        authMethod: "static-token",
        encryptedToken: "plaintext-token",
        serverUrl: "https://example.test",
      },
    },
  });
  await db.collection("experiments").doc(experimentID).set({
    active: true,
    owner,
    sessions: 0,
    nConditions: 1,
    currentCondition: 0,
    maxSessions: 100,
    limitSessions: false,
    storageProvider: "dataverse",
    providerContainer: { provider: "dataverse", datasetId: 1, persistentId: "doi:x/y", serverUrl: "https://example.test" },
  });

  return { owner, experimentID };
}

describe("staging sweep -> upload retry, same tick", () => {
  it("delivers a recovered partial without waiting for a later tick", async () => {
    const { owner, experimentID } = await makeOwnerAndExperiment();

    const { body } = await startSession({ experimentID });
    await stageTrials(body.sessionId, 3);
    // Same margin staging-emulator.test.js uses: well past ABANDON_GRACE_MS
    // (10 minutes), comfortably inside the 24h TTL.
    await markAbandoned(body.sessionId, 15 * 60 * 1000);

    // Job 1 of the tick: the staging sweep. Scoped to this one session, per
    // sweepAbandonedSessions's own doc comment on why an unscoped run in a
    // shared emulator is a cross-suite hazard.
    const sweepStats = await sweepAbandonedSessions(new Set([body.sessionId]));
    expect(sweepStats.recovered).toBe(1);

    const queued = await db.collection("uploadQueue").where("experimentID", "==", experimentID).get();
    expect(queued.docs).toHaveLength(1);
    const queueDoc = queued.docs[0];
    // The premise of this whole test: due NOW, not an hour from now.
    expect(queueDoc.data().nextRetryAt.toMillis()).toBeLessThanOrEqual(Date.now());
    expect(queueDoc.data().status).toBe("pending");
    expect(queueDoc.data().partial).toBe(true);

    // Job 2 of the tick, run IMMEDIATELY after job 1 with no clock advance --
    // exactly scheduled-sweep-core.ts's runSweep, which calls uploadRetry
    // right after stagingSweep inside the same invocation.
    mockFetch.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      json: () =>
        Promise.resolve({
          status: "OK",
          data: { files: [{ label: queueDoc.data().filename, dataFile: { id: 1 } }] },
        }),
    });
    await retryPendingUploads(owner);

    const after = (await queueDoc.ref.get()).data();
    // Picked up and delivered on the very next pass -- the whole point of
    // attemptImmediately. Had the old 1-hour default still applied, this
    // entry's nextRetryAt would still be ~an hour out and
    // retryPendingUploads's `where("nextRetryAt", "<=", now)` query would
    // have skipped it entirely, leaving it "pending" with retryCount 0.
    expect(after.status).toBe("completed");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
