/**
 * @jest-environment node
 */

// The quota breaker and the retry sweeper, against the Firestore emulator.
//
// Harness conventions are mail-delivery-emulator.test.js's, for the same
// reasons: emulator env at module scope before any import that reaches app.js,
// a NAMED admin app, a dynamic import of the COMPILED module from
// functions/lib/, and scoped cleanup via a registrar of created refs rather
// than a collection-wide wipe.
//
// THREE SEAMS ARE INJECTED HERE, AND ONLY THE FIRST IS ABOUT CONVENIENCE.
//
//   _setMailSenderForTests     the transport, so nothing reaches api.resend.com.
//   _setMailStatusDocForTests  the breaker document.
//   _setMailCollectionForTests the mail collection.
//
// The last two are about the same hazard, which is SHARED SINGLETONS in an
// emulator that suites run against in parallel.
//
// The breaker lives at `systemStatus/mail`. Half the assertions below require
// it to be SHUT, and a shut breaker makes every other suite that sends mail
// fail -- including contact-email-verify-emulator.test.js, which drives the
// real deployed endpoint over HTTP and would start getting 503s.
//
// The `mail` COLLECTION is the other one, and it took a review to notice.
// sweepRetryableMail is a QUERY over the whole collection, so under
// `--maxWorkers=2` this suite would pick up mail-delivery-emulator.test.js's
// fixtures, deliver them through THIS suite's injected transport, and rewrite
// them mid-assertion -- while its own exact-count assertions (`retained` is 3,
// `agedOut` is 1, the sender was called once) failed for reasons that had
// nothing to do with the code under test. Both are suites failing in a
// different place each run, which is the worst kind of bug to chase.

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

// cleanupOldEntries deletes the payload before the queue entry, so the sweep
// has to have somewhere to send that delete. 404 from the emulator is fine --
// the delete is wrapped precisely because the object may already be gone.
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";

process.env.RESEND_API_KEY = "re_test_not_a_real_key";
process.env.MAIL_FROM = "DataPipe (test) <datapipe-notifications@jspsych.org>";

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

// Block 4 imports the compiled scheduled-upload-retry.js, which pulls in every
// provider adapter, each importing ESM-only "node-fetch" at module scope --
// which Jest's CJS transform cannot parse. Stubbed exactly as
// payload-encryption-emulator.test.js and upload-queue.test.js do. Nothing here
// reaches a provider; the deletion sweep only touches Firestore and Storage.
jest.mock("node-fetch", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.setTimeout(30000);

let db;
let deliverMailDocument;
let _setMailSenderForTests;
let sweepRetryableMail;
let _setMailStatusDocForTests;
let _setMailCollectionForTests;
let cleanupOldEntries;
let MAX_SWEEP_AGE_MS;
let MAIL_RETENTION_MS;
let IDEMPOTENCY_WINDOW_MS;
let SWEEP_ABANDONED_ERROR;
let RETENTION_GRACE_MS;

// This suite's private breaker document, and its private mail collection.
const STATUS_DOC_ID = `mail-test-${randomUUID()}`;
const MAIL_COLLECTION_ID = `mail-test-${randomUUID()}`;

beforeAll(async () => {
  let app;
  try {
    app = getApp("mail-retry-test");
  } catch {
    app = initializeApp({ projectId: "datapipe-test" }, "mail-retry-test");
  }
  db = getFirestore(app);

  ({ deliverMailDocument, _setMailSenderForTests, MAIL_RETENTION_MS } = await import(
    "../../lib/mail-delivery.js"
  ));
  ({
    sweepRetryableMail,
    MAX_SWEEP_AGE_MS,
    IDEMPOTENCY_WINDOW_MS,
    SWEEP_ABANDONED_ERROR,
  } = await import("../../lib/scheduled-mail-retry.js"));
  ({ _setMailStatusDocForTests } = await import("../../lib/mail-availability.js"));
  ({ _setMailCollectionForTests } = await import("../../lib/mail.js"));
  ({ cleanupOldEntries } = await import("../../lib/scheduled-upload-retry.js"));
  ({ RETENTION_GRACE_MS } = await import("../../lib/upload-retention.js"));

  _setMailStatusDocForTests(STATUS_DOC_ID);
  _setMailCollectionForTests(MAIL_COLLECTION_ID);
});

afterAll(async () => {
  _setMailStatusDocForTests(null);
  _setMailCollectionForTests(null);
  await db.collection("systemStatus").doc(STATUS_DOC_ID).delete().catch(() => {});
});

const created = [];
const RECIPIENT = "researcher@example.edu";

async function seedMail({ delivery, inline = false, kind = "upload-failure" } = {}) {
  const ref = db.collection(MAIL_COLLECTION_ID).doc();
  created.push(ref);
  await ref.set({
    to: [RECIPIENT],
    message: {
      subject: "DataPipe couldn't upload data for Working Memory Span",
      text: "The file is not lost.",
      html: "<p>The file is not lost.</p>",
    },
    datapipe: {
      kind,
      owner: `mr-user-${randomUUID()}`,
      experimentID: `mr-exp-${randomUUID()}`,
      queuedAt: Timestamp.now(),
      ...(inline ? { deliverInline: true } : {}),
    },
    ...(delivery ? { delivery } : {}),
  });
  return { ref, id: ref.id };
}

// One owner for every queue entry this suite creates. uploadQueue is shared
// with every other suite, and cleanupOldEntries below sweeps it BY AGE with no
// other filter -- so the deletion tests are scoped to this owner the same way
// retryPendingUploads' ownerScope seam scopes the retry tests.
const OWNER_ID = `mr-user-${randomUUID()}`;

async function seedQueueEntry(
  experimentID,
  { status = "failed", ageMs = 8 * 24 * 60 * 60 * 1000, ...rest } = {}
) {
  const ref = db.collection("uploadQueue").doc();
  created.push(ref);
  await ref.set({
    experimentID,
    owner: OWNER_ID,
    status,
    retryCount: 5,
    maxRetries: 5,
    storagePath: `pending-data/${experimentID}/subject-1.json`,
    createdAt: Timestamp.fromMillis(Date.now() - ageMs),
    ...rest,
  });
  return ref;
}

const statusRef = () => db.collection("systemStatus").doc(STATUS_DOC_ID);
const deliveryOf = async (ref) => (await ref.get()).data()?.delivery;

function sendingOk(id = "resend-ok", headers = {}) {
  return jest.fn().mockResolvedValue({ id, ...headers });
}

function sendingError(name, extra = {}) {
  return jest.fn().mockRejectedValue(
    Object.assign(new Error(`${name} happened`), { name }, extra)
  );
}

// A retryable failure already on the document, as finish() would have left it.
function failedDelivery(name, agoMs = 60_000, attempts = 1) {
  const at = Timestamp.fromMillis(Date.now() - agoMs);
  return {
    state: "ERROR",
    retryable: true,
    attempts,
    error: { name, message: `${name} happened` },
    startTime: at,
    lastAttemptAt: at,
    leaseExpiresAt: null,
    endTime: null,
  };
}

let errorSpy;
let warnSpy;
let logSpy;

beforeEach(() => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  _setMailSenderForTests(null);
  jest.restoreAllMocks();
  await statusRef().delete().catch(() => {});
  const batch = db.batch();
  while (created.length) batch.delete(created.pop());
  await batch.commit();
});

// ---------------------------------------------------------------------------
// 1. The breaker gets written by delivery
// ---------------------------------------------------------------------------

describe("recording quota state", () => {
  test("a successful send records the daily quota reading from the header", async () => {
    // The proactive signal. x-resend-daily-quota rides on SUCCESS responses, so
    // the breaker learns we are at 94/100 while sending still works.
    _setMailSenderForTests(sendingOk("resend-1", { dailyQuotaUsed: 94 }));
    const { id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("sent");

    const status = (await statusRef().get()).data();
    expect(status.dailyQuotaUsed).toBe(94);
    expect(status.dailyQuotaObservedAt.toMillis()).toBeGreaterThan(0);
    expect(status.unavailableUntil).toBeNull();
  });

  test("a quota failure shuts the breaker until the next UTC midnight", async () => {
    _setMailSenderForTests(sendingError("daily_quota_exceeded", { status: 429 }));
    const { id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("retryable-error");

    const status = (await statusRef().get()).data();
    expect(status.reason).toBe("daily_quota_exceeded");
    expect(status.unavailableUntil.toMillis()).toBeGreaterThan(Date.now());
    // Pinned at the limit: a stale lower reading from earlier in the day must
    // not keep claiming the verification reserve is untouched.
    expect(status.dailyQuotaUsed).toBe(100);
  });

  test("a MONTHLY cap shuts sending until the month turns, not until midnight", async () => {
    // The two free-plan caps reset on different clocks. Treated as a daily
    // one, a monthly exhaustion reopens the breaker at midnight, the sweeper
    // probes into a cap with days left to run, and each probe spends one of a
    // queued mail's three attempts -- three nights and every queued
    // notification is terminal.
    _setMailSenderForTests(sendingError("monthly_quota_exceeded", { status: 429 }));
    const { id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("retryable-error");

    const status = (await statusRef().get()).data();
    expect(status.reason).toBe("monthly_quota_exceeded");
    const nextMidnight = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() + 1
    );
    expect(status.unavailableUntil.toMillis()).toBeGreaterThanOrEqual(nextMidnight);
    // ...and the DAILY counter is left alone. A monthly cap says nothing about
    // today's sends, so pinning it at 100 would go on blocking verification on
    // the reserve rule after the daily counter had reset.
    expect(status.dailyQuotaUsed).toBeUndefined();
  });

  test("a revoked key shuts the breaker too, briefly -- quota is not the only way to be unable to send", async () => {
    // Without this the breaker only ever shut on quota, so a revoked key left
    // verificationAvailability answering "available" indefinitely: every click
    // minted a code, wrote a mail document and spent a real Resend request, and
    // nothing anywhere counted them.
    _setMailSenderForTests(sendingError("suspended_api_key", { status: 403 }));
    const { id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("terminal-error");

    const status = (await statusRef().get()).data();
    expect(status.reason).toBe("suspended_api_key");
    expect(status.unavailableUntil.toMillis()).toBeGreaterThan(Date.now());
    // Minutes, not "until the quota resets": nothing resets, so the pause is
    // only there to stop a loop of failing sends until a human sees the logs.
    expect(status.unavailableUntil.toMillis()).toBeLessThan(Date.now() + 60 * 60 * 1000);
  });

  test("a per-message failure does NOT shut sending for everybody", async () => {
    // validation_error is Resend's name both for an unverified sending domain
    // and for one malformed recipient address. One researcher's typo must not
    // switch verification off for every other researcher.
    _setMailSenderForTests(sendingError("validation_error", { status: 422 }));
    const { id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("terminal-error");
    expect((await statusRef().get()).exists).toBe(false);
  });

  test("a later success reopens the breaker -- this is the half-open close", async () => {
    _setMailSenderForTests(sendingError("daily_quota_exceeded", { status: 429 }));
    const first = await seedMail();
    await deliverMailDocument(first.id);
    expect((await statusRef().get()).data().unavailableUntil).not.toBeNull();

    _setMailSenderForTests(sendingOk("resend-2", { dailyQuotaUsed: 3 }));
    const second = await seedMail();
    expect(await deliverMailDocument(second.id)).toBe("sent");

    const status = (await statusRef().get()).data();
    expect(status.unavailableUntil).toBeNull();
    expect(status.dailyQuotaUsed).toBe(3);
  });

  test("a send with no quota header leaves no reading, rather than recording zero", async () => {
    // Resend omits the header on paid plans. Absent must read as "no daily cap
    // applies", not as "0 used" and certainly not as a stale 0 that survives.
    _setMailSenderForTests(sendingOk("resend-3"));
    const { id } = await seedMail();
    await deliverMailDocument(id);

    const status = (await statusRef().get()).data();
    expect(status.dailyQuotaUsed).toBeUndefined();
    expect(status.unavailableUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Inline mail is terminal, because nothing will ever retry it
// ---------------------------------------------------------------------------

describe("inline mail", () => {
  test("a retryable-class error is TERMINAL when the mail is delivered inline", async () => {
    // A verification code is realtime: its sender is holding an HTTP request
    // open and the sweeper skips it forever. Calling it "retryable" would be a
    // lie that also costs something -- a retryable error is never given
    // delivery.expireAt, so the document would sit outside the TTL's reach
    // holding an address indefinitely.
    _setMailSenderForTests(sendingError("daily_quota_exceeded", { status: 429 }));
    const { ref, id } = await seedMail({
      inline: true,
      kind: "contact-email-verification",
    });

    expect(await deliverMailDocument(id)).toBe("terminal-error");

    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("ERROR");
    expect(delivery.retryable).toBe(false);
    // Terminal means the TTL can reap it, which is the whole point.
    expect(delivery.endTime.toMillis()).toBeGreaterThan(0);
    expect(delivery.expireAt.toMillis()).toBeGreaterThan(Date.now());
  });

  test("the same error on QUEUED mail stays retryable", async () => {
    // The contrast that proves the branch is about inline-ness, not about the
    // error.
    _setMailSenderForTests(sendingError("daily_quota_exceeded", { status: 429 }));
    const { ref, id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("retryable-error");
    const delivery = await deliveryOf(ref);
    expect(delivery.retryable).toBe(true);
    expect(delivery.endTime).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. The sweep
// ---------------------------------------------------------------------------

describe("sweepRetryableMail", () => {
  test("SENDS nothing while the breaker is shut, and burns no attempts", async () => {
    // The most important send-side assertion in this file. Sweeping into an
    // exhausted quota fails every document and spends one of its three
    // MAX_ATTEMPTS doing it -- so a day-long outage would exhaust the retry
    // budget of every queued mail and turn all of them terminal, which is the
    // exact opposite of what the sweeper is for.
    const send = sendingOk();
    _setMailSenderForTests(send);
    const { ref } = await seedMail({ delivery: failedDelivery("daily_quota_exceeded") });
    await statusRef().set({
      unavailableUntil: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
      reason: "daily_quota_exceeded",
    });

    const report = await sweepRetryableMail();

    expect(report.paused).toBe(true);
    expect(send).not.toHaveBeenCalled();
    // Untouched: attempts did not creep up by being looked at.
    expect((await deliveryOf(ref)).attempts).toBe(1);
  });

  test("delivers a quota-failed mail once the breaker has expired", async () => {
    const send = sendingOk("resend-swept", { dailyQuotaUsed: 5 });
    _setMailSenderForTests(send);
    const { ref } = await seedMail({ delivery: failedDelivery("daily_quota_exceeded") });
    // Yesterday's breaker, already expired.
    await statusRef().set({
      unavailableUntil: Timestamp.fromMillis(Date.now() - 1000),
    });

    const report = await sweepRetryableMail();

    expect(report.paused).toBe(false);
    expect(report.delivered).toBeGreaterThanOrEqual(1);
    expect(send).toHaveBeenCalled();

    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("SUCCESS");
    expect(delivery.attempts).toBe(2);
    expect(delivery.info.transport).toBe("resend");
    // ...and the successful probe reopened the realtime path.
    expect((await statusRef().get()).data().unavailableUntil).toBeNull();
  });

  test("never SENDS inline mail -- it ends it, so the TTL can have the address", async () => {
    // Belt and braces: inline failures are already marked terminal, so this
    // document should not exist. If one ever does -- a hand edit, an older
    // deploy's write -- the sweeper still must not resurrect a verification
    // code that expired hours ago. Ending it rather than skipping it is what
    // stops it sitting in the query forever with no expireAt, holding a
    // researcher's address outside the TTL policy's reach.
    const send = sendingOk();
    _setMailSenderForTests(send);
    const { ref } = await seedMail({
      inline: true,
      kind: "contact-email-verification",
      delivery: failedDelivery("daily_quota_exceeded"),
    });

    const report = await sweepRetryableMail();

    expect(send).not.toHaveBeenCalled();
    expect(report.agedOut).toBe(1);
    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("ERROR");
    expect(delivery.retryable).toBe(false);
    expect(delivery.expireAt.toMillis()).toBeGreaterThan(Date.now());
  });

  test("recovers a claim that was abandoned mid-send", async () => {
    // THE HOLE THIS CLOSES. The claim transaction rewrites the document to
    // PROCESSING with `retryable: null` BEFORE the send, so an instance
    // preempted (or rolled by a deploy) inside the send left a document that
    // the retryable-ERROR query could not see and the TTL could not reap --
    // holding a researcher's address indefinitely, which is the exact failure
    // the sweeper exists to prevent.
    const send = sendingOk("resend-recovered", { dailyQuotaUsed: 7 });
    _setMailSenderForTests(send);
    const at = Timestamp.fromMillis(Date.now() - 30 * 60 * 1000);
    const { ref } = await seedMail({
      delivery: {
        state: "PROCESSING",
        attempts: 1,
        retryable: null,
        startTime: at,
        // Expired: LEASE_MS is five minutes, so its claimant is provably dead.
        leaseExpiresAt: Timestamp.fromMillis(Date.now() - 60_000),
        endTime: null,
      },
    });

    const report = await sweepRetryableMail();

    expect(report.delivered).toBe(1);
    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("SUCCESS");
    expect(delivery.attempts).toBe(2);
  });

  test("leaves a claim alone while its lease is still live", async () => {
    // The other half: an invocation may be inside the send right now, and two
    // senders on one document is the double-send the whole claim machinery
    // exists to prevent.
    const send = sendingOk();
    _setMailSenderForTests(send);
    const { ref } = await seedMail({
      delivery: {
        state: "PROCESSING",
        attempts: 1,
        startTime: Timestamp.now(),
        leaseExpiresAt: Timestamp.fromMillis(Date.now() + 4 * 60 * 1000),
      },
    });

    const report = await sweepRetryableMail();

    expect(send).not.toHaveBeenCalled();
    expect(report.agedOut).toBe(0);
    expect((await deliveryOf(ref)).state).toBe("PROCESSING");
  });

  test("ends an abandoned claim once the idempotency key has expired", async () => {
    // Nothing knows whether the send went out, and the key that would have made
    // a retry safe is gone -- so this is the coin flip the sweeper declines.
    // Terminal, and recorded as such, rather than left as a PROCESSING document
    // that the next pass would look at and leave again.
    const send = sendingOk();
    _setMailSenderForTests(send);
    const old = Timestamp.fromMillis(Date.now() - IDEMPOTENCY_WINDOW_MS - 60_000);
    const { ref } = await seedMail({
      delivery: {
        state: "PROCESSING",
        attempts: 1,
        startTime: old,
        leaseExpiresAt: old,
      },
    });

    const report = await sweepRetryableMail();

    expect(send).not.toHaveBeenCalled();
    expect(report.agedOut).toBe(1);
    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("ERROR");
    expect(delivery.retryable).toBe(false);
    expect(delivery.error.name).toBe(SWEEP_ABANDONED_ERROR);
    expect(delivery.expireAt.toMillis()).toBeGreaterThan(Date.now());
  });

  test("ages out a mail nobody delivered in time, and lets the TTL have it", async () => {
    // Terminal rather than skipped, deliberately: a retryable ERROR never gets
    // delivery.expireAt, so skipping would leave this document holding a
    // researcher's address outside the TTL policy's reach forever.
    const send = sendingOk();
    _setMailSenderForTests(send);
    const { ref } = await seedMail({
      delivery: failedDelivery("daily_quota_exceeded", MAX_SWEEP_AGE_MS + 60_000),
    });

    const report = await sweepRetryableMail();

    expect(report.agedOut).toBe(1);
    expect(send).not.toHaveBeenCalled();

    const delivery = await deliveryOf(ref);
    expect(delivery.retryable).toBe(false);
    expect(delivery.endTime.toMillis()).toBeGreaterThan(0);
    expect(delivery.expireAt.toMillis()).toBeCloseTo(
      delivery.endTime.toMillis() + MAIL_RETENTION_MS,
      -4
    );
  });

  test("stops the pass when a send trips the breaker mid-sweep", async () => {
    // Without this the remaining documents each fail and each spend an attempt,
    // converting one quota outage into an exhausted retry budget.
    const send = sendingError("daily_quota_exceeded", { status: 429 });
    _setMailSenderForTests(send);
    await seedMail({ delivery: failedDelivery("daily_quota_exceeded") });
    await seedMail({ delivery: failedDelivery("daily_quota_exceeded") });
    await seedMail({ delivery: failedDelivery("daily_quota_exceeded") });

    const report = await sweepRetryableMail();

    expect(report.paused).toBe(true);
    // One attempt discovers the quota; the rest of the pass stands down.
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("holds the data back EVEN WHILE PAUSED -- the case that needs it most", async () => {
    // Retention is a Firestore write, not a send: it costs no quota, so an
    // exhausted quota is no reason to skip it. The opposite, in fact. A quota
    // outage is exactly when a researcher's unuploaded data is ageing towards
    // deletion behind a notification that never arrived, so putting this after
    // the breaker check would switch the protection off in the only situation
    // that needs it.
    const send = sendingOk();
    _setMailSenderForTests(send);
    const experimentID = `mr-exp-${randomUUID()}`;
    const entry = await seedQueueEntry(experimentID);
    const { ref } = await seedMail({ delivery: failedDelivery("daily_quota_exceeded") });
    await ref.update({ "datapipe.experimentID": experimentID });
    await statusRef().set({
      unavailableUntil: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
    });

    const report = await sweepRetryableMail();

    expect(report.paused).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(report.retained).toBe(1);
    const retainUntil = (await entry.get()).data().retainUntil;
    expect(retainUntil.toMillis()).toBeGreaterThan(Date.now());
  });

  test("holds back EVERY unresolved entry for the experiment, not just the one that tripped it", async () => {
    // A notification is per EPISODE, and an episode belongs to an experiment,
    // not to one file. datapipe.queueDocId records only the entry that tripped
    // it -- extending just that one would leave the rest of the episode's data
    // expiring on schedule, which is the original bug in miniature.
    _setMailSenderForTests(sendingOk());
    const experimentID = `mr-exp-${randomUUID()}`;
    const entries = [
      await seedQueueEntry(experimentID),
      await seedQueueEntry(experimentID),
      await seedQueueEntry(experimentID, { status: "pending" }),
    ];
    const { ref } = await seedMail({ delivery: failedDelivery("daily_quota_exceeded") });
    await ref.update({ "datapipe.experimentID": experimentID });

    const report = await sweepRetryableMail();

    expect(report.retained).toBe(3);
    for (const entry of entries) {
      expect((await entry.get()).data().retainUntil.toMillis()).toBeGreaterThan(
        Date.now()
      );
    }
  });

  test("holds the data back on the pass that GIVES UP on the notification", async () => {
    // The case that matters most, and the one this used to miss. Retention was
    // only extended for mail the sweeper was about to try again, so the moment
    // a notification became undeliverable the extensions stopped -- and the
    // data it was about went back on the original clock and was deleted, with
    // the researcher never having been told anything at all. Giving up on
    // telling them is not a reason to shorten their window; it is the reason
    // they need it.
    _setMailSenderForTests(sendingOk());
    const experimentID = `mr-exp-${randomUUID()}`;
    const entry = await seedQueueEntry(experimentID);
    const { ref } = await seedMail({
      delivery: failedDelivery("daily_quota_exceeded", MAX_SWEEP_AGE_MS + 60_000),
    });
    await ref.update({ "datapipe.experimentID": experimentID });

    const report = await sweepRetryableMail();

    expect(report.agedOut).toBe(1);
    expect(report.retained).toBe(1);
    expect((await entry.get()).data().retainUntil.toMillis()).toBeGreaterThan(
      Date.now()
    );
  });

  test("extends an experiment ONCE a pass, however many notifications name it", async () => {
    // Two failure episodes for one experiment are two mail documents. Running
    // the query and the batch twice would double the writes and count the same
    // entries twice in the report -- and the sweep runs every ten minutes for
    // as long as the outage lasts, so "twice" is really "tens of thousands of
    // redundant writes a day" against a 20,000/day free tier.
    _setMailSenderForTests(sendingOk());
    const experimentID = `mr-exp-${randomUUID()}`;
    const entry = await seedQueueEntry(experimentID);
    for (const _ of [1, 2]) {
      const { ref } = await seedMail({
        delivery: failedDelivery("daily_quota_exceeded"),
      });
      await ref.update({ "datapipe.experimentID": experimentID });
    }

    const report = await sweepRetryableMail();

    expect(report.scanned).toBe(2);
    expect(report.retained).toBe(1);
    expect((await entry.get()).data().retainUntil.toMillis()).toBeGreaterThan(
      Date.now()
    );
  });

  test("does not rewrite a retainUntil that is already most of the way out", async () => {
    // The same reasoning one level down: a pass every ten minutes must not
    // rewrite the same field to nearly the same value each time. The stored
    // value can never be closer than half the grace window to expiring, which
    // is days of slack on a ten-minute sweep.
    _setMailSenderForTests(sendingOk());
    const experimentID = `mr-exp-${randomUUID()}`;
    const alreadyExtended = Timestamp.fromMillis(
      Date.now() + RETENTION_GRACE_MS - 60_000
    );
    const entry = await seedQueueEntry(experimentID, {
      retainUntil: alreadyExtended,
    });
    const { ref } = await seedMail({
      delivery: failedDelivery("daily_quota_exceeded"),
    });
    await ref.update({ "datapipe.experimentID": experimentID });

    // Still reported as held back -- it IS held back; it just did not need a
    // write to stay that way.
    expect((await sweepRetryableMail()).retained).toBe(1);
    expect((await entry.get()).data().retainUntil.toMillis()).toBe(
      alreadyExtended.toMillis()
    );
  });

  test("holds nothing back for a verification code -- there is no data behind it", async () => {
    _setMailSenderForTests(sendingOk());
    const experimentID = `mr-exp-${randomUUID()}`;
    const entry = await seedQueueEntry(experimentID);
    const { ref } = await seedMail({
      kind: "contact-email-verification",
      delivery: failedDelivery("daily_quota_exceeded"),
    });
    await ref.update({ "datapipe.experimentID": experimentID });

    const report = await sweepRetryableMail();

    expect(report.retained).toBe(0);
    expect((await entry.get()).data().retainUntil).toBeUndefined();
  });

  test("an empty mail collection is a quiet no-op", async () => {
    const send = sendingOk();
    _setMailSenderForTests(send);

    const report = await sweepRetryableMail();

    expect(send).not.toHaveBeenCalled();
    expect(report.delivered).toBe(0);
    expect(report.agedOut).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. The other end of the story: the sweep that actually deletes
// ---------------------------------------------------------------------------

describe("cleanupOldEntries", () => {
  test("deletes past a queue whose head is all retained entries", async () => {
    // THE STARVATION THIS FIXES. The query finds entries by age, ascending,
    // and a retained entry is not removed from the result set by being looked
    // at -- so with a single limit(50) on the query, fifty retained entries at
    // the head of the queue meant a pass that deleted nothing, forever. One
    // experiment stuck behind a dead storage provider could stop every OTHER
    // experiment's payloads from ever being deleted, until the blockers finally
    // crossed the 14-day ceiling up to a week later.
    const blocked = `mr-exp-${randomUUID()}`;
    const deletable = `mr-exp-${randomUUID()}`;

    // 55 older entries that must be kept: still pending, with retries left.
    const batch = db.batch();
    for (let i = 0; i < 55; i += 1) {
      const ref = db.collection("uploadQueue").doc();
      created.push(ref);
      batch.set(ref, {
        experimentID: blocked,
        owner: OWNER_ID,
        status: "pending",
        retryCount: 0,
        maxRetries: 5,
        storagePath: `pending-data/${blocked}/subject-${i}.json`,
        createdAt: Timestamp.fromMillis(Date.now() - 10 * 24 * 60 * 60 * 1000),
      });
    }
    await batch.commit();

    // ...and behind them, younger but still aged out, five that may go.
    const doomed = [];
    for (let i = 0; i < 5; i += 1) {
      doomed.push(await seedQueueEntry(deletable));
    }

    await cleanupOldEntries(OWNER_ID);

    for (const entry of doomed) {
      expect((await entry.get()).exists).toBe(false);
    }
  });
});
