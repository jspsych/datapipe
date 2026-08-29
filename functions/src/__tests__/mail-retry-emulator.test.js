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
// TWO SEAMS ARE INJECTED HERE, AND THE SECOND ONE IS NOT OPTIONAL.
//
//   _setMailSenderForTests   the transport, so nothing reaches api.resend.com.
//   _setMailStatusDocForTests the breaker document.
//
// The breaker lives at `systemStatus/mail`, which is a SINGLETON shared by
// every suite. Half the assertions below require the breaker to be SHUT, and a
// shut breaker makes every other suite that sends mail fail -- including
// contact-email-verify-emulator.test.js, which drives the real deployed
// endpoint over HTTP and would start getting 503s. Under `--maxWorkers=2` that
// is a suite failing in a different place each run, which is the worst kind of
// bug to chase. Pointing this suite at its own status document is what prevents
// it, and it is why the seam exists in production code at all.

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

process.env.RESEND_API_KEY = "re_test_not_a_real_key";
process.env.MAIL_FROM = "DataPipe (test) <datapipe-notifications@jspsych.org>";

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

jest.setTimeout(30000);

let db;
let deliverMailDocument;
let _setMailSenderForTests;
let sweepRetryableMail;
let _setMailStatusDocForTests;
let MAX_SWEEP_AGE_MS;
let MAIL_RETENTION_MS;

// This suite's private breaker document.
const STATUS_DOC_ID = `mail-test-${randomUUID()}`;

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
  ({ sweepRetryableMail, MAX_SWEEP_AGE_MS } = await import(
    "../../lib/scheduled-mail-retry.js"
  ));
  ({ _setMailStatusDocForTests } = await import("../../lib/mail-availability.js"));

  _setMailStatusDocForTests(STATUS_DOC_ID);
});

afterAll(async () => {
  _setMailStatusDocForTests(null);
  await db.collection("systemStatus").doc(STATUS_DOC_ID).delete().catch(() => {});
});

const created = [];
const RECIPIENT = "researcher@example.edu";

async function seedMail({ delivery, inline = false, kind = "upload-failure" } = {}) {
  const ref = db.collection("mail").doc();
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

async function seedQueueEntry(experimentID, { status = "failed", ageMs = 8 * 24 * 60 * 60 * 1000 } = {}) {
  const ref = db.collection("uploadQueue").doc();
  created.push(ref);
  await ref.set({
    experimentID,
    owner: `mr-user-${randomUUID()}`,
    status,
    retryCount: 5,
    maxRetries: 5,
    storagePath: `pending-data/${experimentID}/subject-1.json`,
    createdAt: Timestamp.fromMillis(Date.now() - ageMs),
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

  test("never sweeps inline mail, even when it somehow looks retryable", async () => {
    // Belt and braces: inline failures are already marked terminal, so this
    // document should not exist. If one ever does -- a hand edit, an older
    // deploy's write -- the sweeper still must not resurrect a verification
    // code that expired hours ago.
    const send = sendingOk();
    _setMailSenderForTests(send);
    const { ref } = await seedMail({
      inline: true,
      kind: "contact-email-verification",
      delivery: failedDelivery("daily_quota_exceeded"),
    });

    const report = await sweepRetryableMail();

    expect(send).not.toHaveBeenCalled();
    expect(report.skipped).toBeGreaterThanOrEqual(1);
    expect((await deliveryOf(ref)).state).toBe("ERROR");
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
