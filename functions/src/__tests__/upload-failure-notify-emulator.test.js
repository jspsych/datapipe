/**
 * @jest-environment node
 */

// The first-failure notification state machine, against the Firestore
// emulator.
//
// Harness conventions are the established ones (upload-queue.test.js:1-90,
// pending-recovery-provider-regression.test.js:1-81): emulator env vars set at
// module scope BEFORE any import that reaches app.js, a NAMED admin app so the
// compiled module's bare initializeApp() does not collide with it, a dynamic
// import of the COMPILED module from functions/lib/ (so
// `npm --prefix functions run build` must run first), and scoped cleanup via a
// registrar of created ids rather than a collection-wide wipe -- the shared
// emulator is used by suites running in parallel.
//
// No node-fetch stub is needed here, unlike the provider suites:
// upload-failure-notify.js imports app.js, mail.js and the pure copy module,
// and reaches no adapter and therefore no ESM-only dependency.
//
// Everything drives the exported handleQueueWrite(before, after, docId) seam
// directly, in-process -- the same seam retryPendingUploads(ownerScope) and
// recoverPendingUploads(prefix) exist for. Provoking real trigger deliveries
// out of the emulator would make every assertion a poll with a timeout, and
// would make the concurrency test below impossible to write at all.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

jest.setTimeout(30000);

let db;
let handleQueueWrite;
// Both read from the production modules rather than restated as literals here:
// a test that keeps its own copy of a constant stops testing anything the day
// the constant changes.
let RATE_LIMIT_MS;
let COMPACTION_HOLD_REASON;

beforeAll(async () => {
  let app;
  try {
    app = getApp("upload-failure-notify-test");
  } catch {
    app = initializeApp({ projectId: "datapipe-test" }, "upload-failure-notify-test");
  }
  db = getFirestore(app);

  ({ handleQueueWrite, RATE_LIMIT_MS } = await import("../../lib/upload-failure-notify.js"));
  ({ COMPACTION_HOLD_REASON } = await import("../../lib/compaction-gate.js"));
});

// ---------------------------------------------------------------------------
// Fixtures + scoped cleanup
// ---------------------------------------------------------------------------

const created = { experiments: [], users: [], queueDocs: [] };

async function seedExperiment(overrides = {}) {
  const experimentID = `ufn-exp-${randomUUID()}`;
  created.experiments.push(experimentID);
  await db.doc(`experiments/${experimentID}`).set({
    title: "Working Memory Span",
    active: true,
    sessions: 3,
    storageProvider: "gdrive",
    providerContainer: { provider: "gdrive", folderId: "folder-1" },
    ...overrides,
  });
  return experimentID;
}

async function seedOwner(fields = { contactEmail: "researcher@example.edu" }) {
  const uid = `ufn-user-${randomUUID()}`;
  created.users.push(uid);
  await db.doc(`users/${uid}`).set({ uid, email: "", experiments: [], ...fields });
  return uid;
}

// A queue entry as the retry worker would leave it. Written to Firestore
// because the DRAIN predicate queries the collection; the FAILURE path reads
// no queue documents at all, so tests that only fail entries may skip this.
async function seedQueueDoc(experimentID, owner, overrides = {}) {
  const filename = `${randomUUID()}.csv`;
  // Same id scheme queue-upload.ts uses, so the fixtures look like production.
  const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
  created.queueDocs.push(docId);
  const data = {
    experimentID,
    owner,
    filename,
    storagePath: `upload-queue/${docId}`,
    dataType: "data",
    status: "pending",
    errorCode: 0,
    retryCount: 0,
    maxRetries: 5,
    createdAt: Timestamp.now(),
    lastAttemptAt: null,
    nextRetryAt: Timestamp.now(),
    completedAt: null,
    failureReason: null,
    deduplicationKey: docId,
    sessionIncremented: true,
    storageProvider: "gdrive",
    ...overrides,
  };
  await db.doc(`uploadQueue/${docId}`).set(data);
  return { docId, data };
}

// An in-memory payload only -- the shape the trigger hands handleQueueWrite.
function queuePayload(experimentID, owner, overrides = {}) {
  return {
    experimentID,
    owner,
    status: "pending",
    retryCount: 0,
    storageProvider: "gdrive",
    ...overrides,
  };
}

async function uploadFailureState(experimentID) {
  const snap = await db.doc(`experiments/${experimentID}`).get();
  return snap.exists ? snap.data().uploadFailure : undefined;
}

async function mailFor(experimentID) {
  const snap = await db
    .collection("mail")
    .where("datapipe.experimentID", "==", experimentID)
    .get();
  return snap.docs.map((d) => d.data());
}

afterEach(async () => {
  const batch = db.batch();
  for (const experimentID of created.experiments) {
    // Mail documents get server-generated ids, so they are found by the
    // audit field mail.ts writes for exactly this purpose (and that
    // purge-user-data.ts will query on).
    const mail = await db
      .collection("mail")
      .where("datapipe.experimentID", "==", experimentID)
      .get();
    mail.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(db.doc(`experiments/${experimentID}`));
  }
  for (const uid of created.users) batch.delete(db.doc(`users/${uid}`));
  for (const docId of created.queueDocs) batch.delete(db.doc(`uploadQueue/${docId}`));
  await batch.commit();
  created.experiments.length = 0;
  created.users.length = 0;
  created.queueDocs.length = 0;
});

// ---------------------------------------------------------------------------
// 1-3. The send predicate fires on failures DataPipe has already tried to fix
// ---------------------------------------------------------------------------

describe("first failure", () => {
  test("a first retry failure mails the owner exactly once and arms the flag", async () => {
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });

    const before = queuePayload(experimentID, owner, { retryCount: 0 });
    const after = queuePayload(experimentID, owner, {
      retryCount: 1,
      providerErrorCode: "UNAVAILABLE",
    });

    const outcome = await handleQueueWrite(before, after, "doc-1");
    expect(outcome).toBe("mailed");

    const mail = await mailFor(experimentID);
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toEqual(["researcher@example.edu"]);
    expect(mail[0].message.subject).toContain("Working Memory Span");
    expect(mail[0].message.text).toContain("The file is not lost.");
    expect(mail[0].message.text).toContain(`/admin/${experimentID}`);
    expect(mail[0].datapipe.kind).toBe("upload-failure");
    expect(mail[0].datapipe.owner).toBe(owner);

    const state = await uploadFailureState(experimentID);
    expect(state.notifiedAt).not.toBeNull();
    expect(state.lastNotifiedAt).toBeDefined();
    expect(state.firstFailureAt).not.toBeNull();
    expect(state.failureCount).toBe(1);
    expect(state.suppressedReason).toBeNull();
  });

  test("a second file failing in the same episode is counted, not mailed", async () => {
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });

    await handleQueueWrite(
      queuePayload(experimentID, owner, { retryCount: 0 }),
      queuePayload(experimentID, owner, { retryCount: 1 }),
      "doc-a"
    );
    const outcome = await handleQueueWrite(
      queuePayload(experimentID, owner, { retryCount: 0 }),
      queuePayload(experimentID, owner, { retryCount: 1 }),
      "doc-b"
    );

    expect(outcome).toBe("counted");
    expect(await mailFor(experimentID)).toHaveLength(1);
    expect((await uploadFailureState(experimentID)).failureCount).toBe(2);
  });

  test("an immediate terminal failure mails even though retryCount never moved", async () => {
    // The finalized-while-queued path (scheduled-upload-retry.ts:162-171) and
    // its three siblings write `failed` directly, consuming no attempt. If the
    // predicate keyed only on retryCount these would never notify anyone.
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });

    const outcome = await handleQueueWrite(
      queuePayload(experimentID, owner, { status: "processing", retryCount: 0 }),
      queuePayload(experimentID, owner, {
        status: "failed",
        retryCount: 0,
        failureReason: "This experiment was finalized while the upload was queued.",
      }),
      "doc-terminal"
    );

    expect(outcome).toBe("mailed");
    expect(await mailFor(experimentID)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. The regression that justifies the whole predicate
// ---------------------------------------------------------------------------

describe("non-failures stay silent", () => {
  test("a compaction hold is not a failure: no mail, and no uploadFailure written at all", async () => {
    // compaction-gate.ts diverts writes into the queue on purpose, and the
    // retry worker reschedules those entries WITHOUT incrementing retryCount.
    // Firing here would false-alarm on every compaction pass.
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });

    const outcome = await handleQueueWrite(
      queuePayload(experimentID, owner, { status: "processing", retryCount: 2 }),
      queuePayload(experimentID, owner, {
        status: "pending",
        retryCount: 2,
        failureReason: COMPACTION_HOLD_REASON,
      }),
      "doc-hold"
    );

    expect(outcome).toBe("noop");
    expect(await mailFor(experimentID)).toHaveLength(0);
    // Not merely "no mail" -- the experiment document must be untouched, so a
    // compaction pass leaves no trace on the notification state.
    expect(await uploadFailureState(experimentID)).toBeUndefined();
  });

  test("queueing a brand-new entry is not a failure", async () => {
    // Queue-time is when the self-healing codes (CONTENTION, AUTH_EXPIRED) are
    // at their most likely to clear on their own within the minute.
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });

    const outcome = await handleQueueWrite(
      undefined,
      queuePayload(experimentID, owner, {
        status: "pending",
        retryCount: 0,
        providerErrorCode: "CONTENTION",
      }),
      "doc-new"
    );

    expect(outcome).toBe("noop");
    expect(await mailFor(experimentID)).toHaveLength(0);
    expect(await uploadFailureState(experimentID)).toBeUndefined();
  });

  test("a failure on a deleted experiment writes nothing and creates no ghost document", async () => {
    // "Experiment not found" is itself one of the terminal failure paths, so
    // this event really does arrive. tx.set here would CREATE an experiment
    // document carrying nothing but uploadFailure.
    const owner = await seedOwner();
    const experimentID = `ufn-exp-missing-${randomUUID()}`;
    // Registered for cleanup even though it is never created: if the code
    // under test regresses and DOES create it, the residue must not outlive
    // this test in the shared emulator.
    created.experiments.push(experimentID);

    const outcome = await handleQueueWrite(
      queuePayload(experimentID, owner, { status: "processing", retryCount: 0 }),
      queuePayload(experimentID, owner, { status: "failed", retryCount: 0 }),
      "doc-orphan"
    );

    expect(outcome).toBe("noop");
    expect((await db.doc(`experiments/${experimentID}`).get()).exists).toBe(false);
    expect(await mailFor(experimentID)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5-7. Draining re-arms the episode
// ---------------------------------------------------------------------------

describe("drain", () => {
  async function armEpisode(experimentID, owner) {
    await handleQueueWrite(
      queuePayload(experimentID, owner, { retryCount: 0 }),
      queuePayload(experimentID, owner, { retryCount: 1 }),
      "doc-arm"
    );
  }

  test("the last entry completing clears the flag but keeps lastNotifiedAt", async () => {
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });
    await armEpisode(experimentID, owner);
    const armed = await uploadFailureState(experimentID);

    // The entry that just landed, already `completed`, so the drain query
    // (pending/processing/failed) does not see it.
    await seedQueueDoc(experimentID, owner, { status: "completed" });

    const outcome = await handleQueueWrite(
      queuePayload(experimentID, owner, { status: "processing" }),
      queuePayload(experimentID, owner, { status: "completed" }),
      "doc-done"
    );

    expect(outcome).toBe("cleared");
    const state = await uploadFailureState(experimentID);
    expect(state.notifiedAt).toBeNull();
    expect(state.firstFailureAt).toBeNull();
    expect(state.failureCount).toBe(0);
    expect(state.suppressedReason).toBeNull();
    // The flap backstop. Cleared here, a queue that broke every hour would
    // mail every hour.
    expect(state.lastNotifiedAt.toMillis()).toBe(armed.lastNotifiedAt.toMillis());
  });

  test("a delete can be the drain -- the cleanupOldEntries case", async () => {
    // cleanupOldEntries DELETES queue documents at seven days, any status, so
    // `after` is undefined. compaction-triggers.ts's sibling trigger returns
    // early on exactly that condition; this one must not, because the last
    // `failed` entry ageing out is the normal way a dead episode ends.
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });
    await armEpisode(experimentID, owner);

    const { docId } = await seedQueueDoc(experimentID, owner, { status: "failed" });
    const before = (await db.doc(`uploadQueue/${docId}`).get()).data();
    await db.doc(`uploadQueue/${docId}`).delete();

    const outcome = await handleQueueWrite(before, undefined, docId);

    expect(outcome).toBe("cleared");
    expect((await uploadFailureState(experimentID)).notifiedAt).toBeNull();
  });

  test("a lingering failed entry keeps the queue non-empty", async () => {
    // `failed` is in the unresolved set on purpose: a permanently dead file is
    // a problem the researcher has not dealt with, and re-arming would mail
    // them again about a queue that never actually got better.
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });
    await armEpisode(experimentID, owner);

    await seedQueueDoc(experimentID, owner, { status: "completed" });
    await seedQueueDoc(experimentID, owner, { status: "failed" });

    const outcome = await handleQueueWrite(
      queuePayload(experimentID, owner, { status: "processing" }),
      queuePayload(experimentID, owner, { status: "completed" }),
      "doc-done"
    );

    expect(outcome).toBe("noop");
    expect((await uploadFailureState(experimentID)).notifiedAt).not.toBeNull();
  });

  test("a completion on an experiment with no episode costs no write", async () => {
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });

    const outcome = await handleQueueWrite(
      queuePayload(experimentID, owner, { status: "processing" }),
      queuePayload(experimentID, owner, { status: "completed" }),
      "doc-happy"
    );

    expect(outcome).toBe("noop");
    expect(await uploadFailureState(experimentID)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. The race. This is the package's whole reason for being Opus-built.
// ---------------------------------------------------------------------------

describe("concurrency", () => {
  test("twenty simultaneous failures produce exactly one mail", async () => {
    // The routine case, not an exotic one: a metadataActive submission writes
    // a raw file, a main CSV and one sidecar per extracted column, and the
    // retry worker can fail all of them in a single run -- firing that many
    // trigger invocations at once against the same experiment document.
    //
    // No uploadQueue documents are seeded: the FAILURE path reads the
    // experiment and the owner and nothing else, so writing twenty queue docs
    // would slow the test without changing what it exercises.
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        handleQueueWrite(
          queuePayload(experimentID, owner, { retryCount: 0 }),
          queuePayload(experimentID, owner, { retryCount: 1 }),
          `doc-race-${i}`
        )
      )
    );

    expect(await mailFor(experimentID)).toHaveLength(1);
    expect(outcomes.filter((o) => o === "mailed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "counted")).toHaveLength(19);
    // Every one of them landed: the mail and the flag are one commit, and the
    // count is a field transform, so nothing is lost to the retries.
    expect((await uploadFailureState(experimentID)).failureCount).toBe(20);
    // Longer than the suite default: nineteen of these transactions lose the
    // race and re-run, and the emulator backs off between attempts.
  }, 60000);
});

// ---------------------------------------------------------------------------
// 9. The flap backstop
// ---------------------------------------------------------------------------

describe("rate limit", () => {
  async function failOnce(experimentID, owner, docId) {
    return handleQueueWrite(
      queuePayload(experimentID, owner, { retryCount: 0 }),
      queuePayload(experimentID, owner, { retryCount: 1 }),
      docId
    );
  }

  async function drain(experimentID, owner, docId) {
    return handleQueueWrite(
      queuePayload(experimentID, owner, { status: "processing" }),
      queuePayload(experimentID, owner, { status: "completed" }),
      docId
    );
  }

  test("a queue that flaps clear->fail is silent until 24 hours have passed", async () => {
    const owner = await seedOwner();
    const experimentID = await seedExperiment({ owner });

    expect(await failOnce(experimentID, owner, "flap-1")).toBe("mailed");
    expect(await drain(experimentID, owner, "flap-1")).toBe("cleared");

    // Re-armed, so the predicate fires again -- and the 24-hour floor, read
    // from the lastNotifiedAt the drain deliberately left behind, is the only
    // thing standing between this study and 168 emails a week.
    expect(await failOnce(experimentID, owner, "flap-2")).toBe("rate-limited");
    expect(await mailFor(experimentID)).toHaveLength(1);

    const suppressed = await uploadFailureState(experimentID);
    expect(suppressed.suppressedReason).toBe("rate-limited");
    // Still armed, so the rest of the burst is quiet too.
    expect(suppressed.notifiedAt).not.toBeNull();

    // Advance past the floor. Timestamp.now() reads Date.now(), so this is the
    // same seam pending-recovery-provider-regression.test.js:112 uses to move
    // a cutoff without waiting for real time to pass.
    const realNow = Date.now();
    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValue(realNow + RATE_LIMIT_MS + 60 * 60 * 1000);
    try {
      expect(await drain(experimentID, owner, "flap-2")).toBe("cleared");
      expect(await failOnce(experimentID, owner, "flap-3")).toBe("mailed");
    } finally {
      nowSpy.mockRestore();
    }

    expect(await mailFor(experimentID)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 10. Nobody to write to
// ---------------------------------------------------------------------------

describe("no contact email", () => {
  test("arms the episode and records why, without sending anything", async () => {
    // The ORCID and OSF-era populations, until Feature 1's gate closes them
    // out. Arming still matters: without the flag, twenty derived-file
    // failures would each open a transaction and each re-decide.
    const owner = await seedOwner({});
    const experimentID = await seedExperiment({ owner });

    const outcome = await handleQueueWrite(
      queuePayload(experimentID, owner, { retryCount: 0 }),
      queuePayload(experimentID, owner, { retryCount: 1 }),
      "doc-nomail"
    );

    expect(outcome).toBe("no-contact-email");
    expect(await mailFor(experimentID)).toHaveLength(0);

    const state = await uploadFailureState(experimentID);
    expect(state.notifiedAt).not.toBeNull();
    expect(state.suppressedReason).toBe("no-contact-email");
    expect(state.failureCount).toBe(1);
    // Never sent, so the 24-hour floor was never started -- the moment an
    // address is added, the next episode can mail immediately.
    expect(state.lastNotifiedAt).toBeUndefined();
  });

  test("the synthetic OSF address is not a contact address", async () => {
    // oauth2-callback.ts seeds `user-{id}@osf.io` as a fallback and it is
    // undeliverable. contactEmailRecipient rejects it; a naive truthiness
    // check would mail it forever.
    const owner = await seedOwner({ contactEmail: "user-abc123@osf.io" });
    const experimentID = await seedExperiment({ owner });

    const outcome = await handleQueueWrite(
      queuePayload(experimentID, owner, { retryCount: 0 }),
      queuePayload(experimentID, owner, { retryCount: 1 }),
      "doc-synthetic"
    );

    expect(outcome).toBe("no-contact-email");
    expect(await mailFor(experimentID)).toHaveLength(0);
  });

  test("a missing owner document suppresses rather than throws", async () => {
    const experimentID = await seedExperiment({ owner: "ufn-ghost-owner" });

    const outcome = await handleQueueWrite(
      queuePayload(experimentID, "ufn-ghost-owner", { retryCount: 0 }),
      queuePayload(experimentID, "ufn-ghost-owner", { retryCount: 1 }),
      "doc-noowner"
    );

    expect(outcome).toBe("no-contact-email");
    expect(await mailFor(experimentID)).toHaveLength(0);
  });
});
