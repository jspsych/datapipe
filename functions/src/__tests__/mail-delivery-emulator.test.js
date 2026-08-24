/**
 * @jest-environment node
 */

// SES mail delivery against the Firestore emulator.
//
// Harness conventions are the established ones (upload-failure-notify-
// emulator.test.js:1-108, upload-queue.test.js:1-90): emulator env vars set at
// module scope BEFORE any import that reaches app.js, a NAMED admin app so the
// compiled module's bare initializeApp() does not collide with it, a dynamic
// import of the COMPILED module from functions/lib/ (so
// `npm --prefix functions run build` must run first), and scoped cleanup via a
// registrar of created refs rather than a collection-wide wipe -- the shared
// emulator is used by suites running in parallel.
//
// Everything drives the exported deliverMailDocument(docId) seam directly,
// in-process -- the same seam handleQueueWrite(before, after, docId) and
// retryPendingUploads(ownerScope) exist for.
//
// THE TRANSPORT IS MOCKED AT A FUNCTION SEAM, NOT AT THE SDK. mail-delivery.ts
// exposes _setSesClientForTests(sender), where `sender` is a plain
// (input, {timeoutMs}) => Promise<{MessageId}> function. That shape is
// deliberate and it is why this file needs no jest.mock and no ESM wrestling:
// the real transport lazily `await import`s @aws-sdk/client-sesv2 inside that
// same seam, so with a sender injected the AWS package is never loaded at all.
// (The dynamic import also keeps the SDK off apidata's cold-start path -- see
// getSender in mail-delivery.ts.)
//
// ---------------------------------------------------------------------------
// CI RUNS THIS SUITE WITH THE REAL TRIGGER LIVE. READ BEFORE CHANGING.
// ---------------------------------------------------------------------------
//
// Locally these tests run against a bare Firestore emulator. In CI
// (node.js.yml) the whole run is wrapped in `firebase emulators:exec`, which
// loads the FUNCTIONS emulator too -- so the deployed `onmailcreated` fires on
// every mail document this file creates, concurrently with the direct calls
// below. That is the same hazard upload-failure-notify-emulator.test.js
// documents at length, and here it would be considerably worse: the emulator's
// functions process has no SES credentials and no AWS anything, so a live
// instance that won the race would stamp a TERMINAL MailConfigMissingError on
// a fixture whose test is about to assert SUCCESS. Every happy-path assertion
// in this file would become CI-only flaky, in a way that never reproduces
// locally.
//
// It is not solved by loosening assertions, and it is not solved by ordering
// the fixtures. It is solved in the production code, once: onMailCreated
// checks FUNCTIONS_EMULATOR and returns BEFORE the claim transaction, so the
// emulator-hosted instance performs no read, no write and no send. It cannot
// race anything, because it does nothing. (That gate is also just correct --
// a test run must not be able to mail a real person, and the extension this
// replaces never ran against the emulator either; see
// docs/deploy-contact-email.md §2.)
//
// The gate lives on the TRIGGER WRAPPER only, never on deliverMailDocument.
// This file calls the seam underneath it, so its coverage is unaffected by the
// gate regardless of whether FUNCTIONS_EMULATOR happens to be set in this
// jest process. Do not move that check down into deliverMailDocument, and do
// not set process.env.FUNCTIONS_EMULATOR here -- neither would change what
// this file exercises today, and both would quietly disarm the protection.
//
// If a happy-path test in this file ever fails in CI with
// state="ERROR"/name="MailConfigMissingError", that gate is what regressed.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
// payload/token crypto: any 64-hex key works in tests. Not used by
// mail-delivery.js, set for the same reason its neighbours do -- app.js is
// reached transitively and the bootstrap is a unit.
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

// SES configuration. Read LAZILY, per invocation, by mail-delivery.ts (the
// crypto-utils.ts convention), so setting it here reaches the compiled module
// even though it is imported later. These are dummies: with a sender injected
// nothing signs a request, and no value below is ever sent anywhere.
const FROM = "DataPipe <datapipe-notifications@jspsych.org>";
const REPLY_TO = "contact@jspsych.org";
process.env.SES_REGION = "us-east-1";
process.env.SES_ACCESS_KEY_ID = "AKIATESTTESTTESTTEST";
process.env.SES_SECRET_ACCESS_KEY = "test-secret-not-a-real-key";
process.env.MAIL_FROM = FROM;
process.env.MAIL_REPLY_TO = REPLY_TO;

jest.setTimeout(30000);

let db;
let deliverMailDocument;
let _setSesClientForTests;
// Read from the production module rather than restated here.
let LEASE_MS;
let MAX_ATTEMPTS;
let CONFIG_MISSING_ERROR;

beforeAll(async () => {
  let app;
  try {
    app = getApp("mail-delivery-test");
  } catch {
    app = initializeApp({ projectId: "datapipe-test" }, "mail-delivery-test");
  }
  db = getFirestore(app);

  ({
    deliverMailDocument,
    _setSesClientForTests,
    LEASE_MS,
    MAX_ATTEMPTS,
    CONFIG_MISSING_ERROR,
  } = await import("../../lib/mail-delivery.js"));
});

// ---------------------------------------------------------------------------
// Fixtures, transport mock, scoped cleanup
// ---------------------------------------------------------------------------

const created = [];
const RECIPIENT = "researcher@example.edu";

// Exactly what mail.ts's mailDocument() writes. Built through the same shape
// rather than a minimal stub, because half of what this suite proves is that
// the real document maps onto a real SES request.
async function seedMail(overrides = {}) {
  const owner = `md-user-${randomUUID()}`;
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
      kind: "upload-failure",
      owner,
      experimentID: `md-exp-${randomUUID()}`,
      queuedAt: Timestamp.now(),
    },
    ...overrides,
  });
  return { ref, id: ref.id, owner };
}

async function deliveryOf(ref) {
  const snap = await ref.get();
  return snap.exists ? snap.data().delivery : undefined;
}

// A sender that resolves with a MessageId, or one that rejects with a named
// SES-shaped error. jest.fn so call COUNT is assertable -- "zero additional
// SES calls" is the single most important assertion in this file.
function sendingOk(messageId = "ses-message-id-1") {
  return jest.fn().mockResolvedValue({ MessageId: messageId });
}

function sendingError(name, extra = {}) {
  const error = Object.assign(new Error(`${name} happened`), { name }, extra);
  return jest.fn().mockRejectedValue(error);
}

let errorSpy;
let warnSpy;
let logSpy;

beforeEach(() => {
  // Silenced, and then asserted on. The failure paths log at error level by
  // design; letting them print would bury a real problem in expected noise.
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});

// Every console argument this suite produced, flattened -- used to prove what
// is NOT in the logs.
function loggedText() {
  return [errorSpy, warnSpy, logSpy]
    .flatMap((spy) => spy.mock.calls)
    .flat()
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg ?? null)))
    .join("\n");
}

afterEach(async () => {
  _setSesClientForTests(null);
  jest.restoreAllMocks();
  const batch = db.batch();
  while (created.length) batch.delete(created.pop());
  await batch.commit();
});

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

describe("delivery", () => {
  test("sends the document and records SUCCESS, a messageId and an endTime", async () => {
    const send = sendingOk("ses-0102030405");
    _setSesClientForTests(send);
    const { ref, id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("sent");

    expect(send).toHaveBeenCalledTimes(1);
    const [input, options] = send.mock.calls[0];
    expect(input.FromEmailAddress).toBe(FROM);
    expect(input.ReplyToAddresses).toEqual([REPLY_TO]);
    expect(input.Destination.ToAddresses).toEqual([RECIPIENT]);
    expect(input.Content.Simple.Subject.Data).toContain("Working Memory Span");
    expect(input.Content.Simple.Body.Text.Data).toBe("The file is not lost.");
    expect(input.Content.Simple.Body.Html.Data).toContain("not lost");
    // A send with no ceiling is a claim held until the function itself is
    // killed -- see SES_TIMEOUT_MS / LEASE_MS.
    expect(options.timeoutMs).toBeGreaterThan(0);

    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("SUCCESS");
    expect(delivery.attempts).toBe(1);
    expect(delivery.info.messageId).toBe("ses-0102030405");
    expect(delivery.error).toBeNull();
    // endTime is what the Firestore TTL policy keys on (deploy runbook §4).
    // Unset here would mean this document never self-deletes.
    expect(delivery.endTime.toMillis()).toBeGreaterThan(0);
    expect(delivery.startTime.toMillis()).toBeLessThanOrEqual(
      delivery.endTime.toMillis()
    );
    // Released, so nothing is left looking in-flight forever.
    expect(delivery.leaseExpiresAt).toBeNull();
  });

  test("never writes a recipient address or a credential into the logs", async () => {
    // The neighbours log ids and uids, never addresses
    // (send-contact-email-verification.ts, upload-failure-notify.ts), and a
    // failure path is exactly where an address is most likely to be helpfully
    // appended to an error string.
    _setSesClientForTests(sendingError("MessageRejected"));
    const { id } = await seedMail();
    await deliverMailDocument(id);

    const text = loggedText();
    expect(text).toContain(id);
    expect(text).toContain("MessageRejected");
    expect(text).not.toContain(RECIPIENT);
    expect(text).not.toContain(process.env.SES_SECRET_ACCESS_KEY);
    expect(text).not.toContain(process.env.SES_ACCESS_KEY_ID);
  });

  test("mail with no html part is still sent, without an empty Html body", async () => {
    const send = sendingOk();
    _setSesClientForTests(send);
    const { id } = await seedMail({
      message: { subject: "Your DataPipe verification code", text: "123456" },
    });

    expect(await deliverMailDocument(id)).toBe("sent");
    expect(send.mock.calls[0][0].Content.Simple.Body).not.toHaveProperty("Html");
  });
});

// ---------------------------------------------------------------------------
// 2. At-least-once. The reason this file exists.
// ---------------------------------------------------------------------------

describe("duplicate invocation", () => {
  test("a second delivery of an already-sent document makes ZERO SES calls", async () => {
    // Firestore triggers are at-least-once, so this is the ordinary case, not
    // an exotic one -- and a duplicate "your uploads are failing" email is the
    // precise annoyance upload-failure-notify.ts spends its whole design
    // avoiding. Nothing downstream of this assertion is allowed to regress.
    const send = sendingOk("ses-once");
    _setSesClientForTests(send);
    const { ref, id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("sent");
    expect(await deliverMailDocument(id)).toBe("skipped-delivered");
    expect(await deliverMailDocument(id)).toBe("skipped-delivered");

    expect(send).toHaveBeenCalledTimes(1);
    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("SUCCESS");
    expect(delivery.attempts).toBe(1);
    expect(delivery.info.messageId).toBe("ses-once");
  });

  test("a document already claimed with a live lease is left alone", async () => {
    // The other half of at-least-once: a redelivery arriving WHILE the first
    // invocation is still inside send(). Taking it over would double-send.
    const send = sendingOk();
    _setSesClientForTests(send);
    const { ref, id } = await seedMail({
      delivery: {
        state: "PROCESSING",
        attempts: 1,
        leaseOwner: "some-other-invocation",
        leaseExpiresAt: Timestamp.fromMillis(Date.now() + LEASE_MS),
        startTime: Timestamp.now(),
        endTime: null,
      },
    });

    expect(await deliverMailDocument(id)).toBe("skipped-in-flight");
    expect(send).not.toHaveBeenCalled();
    // Untouched: the lease still belongs to the other invocation.
    expect((await deliveryOf(ref)).leaseOwner).toBe("some-other-invocation");
  });

  test("concurrent deliveries of the same document produce exactly one send", async () => {
    // The claim is a transaction, so this is the same serializability property
    // upload-failure-notify.ts's twenty-way race test relies on, one hop later.
    const send = sendingOk();
    _setSesClientForTests(send);
    const { ref, id } = await seedMail();

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => deliverMailDocument(id))
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
    // The other seven skipped -- in-flight if they raced the send, delivered
    // if they arrived after it. Both are correct; which one is timing.
    expect(
      outcomes.filter(
        (o) => o === "skipped-in-flight" || o === "skipped-delivered"
      )
    ).toHaveLength(7);
    expect((await deliveryOf(ref)).attempts).toBe(1);
  });

  test("a crashed claim is recoverable once its lease expires", async () => {
    // The lease's only job. It is several times the function timeout, so by
    // the time it expires the original owner is provably dead -- see LEASE_MS.
    const send = sendingOk("ses-after-crash");
    _setSesClientForTests(send);
    const { ref, id } = await seedMail({
      delivery: {
        state: "PROCESSING",
        attempts: 1,
        leaseOwner: "an-invocation-that-died",
        leaseExpiresAt: Timestamp.fromMillis(Date.now() - 1000),
        startTime: Timestamp.now(),
        endTime: null,
      },
    });

    expect(await deliverMailDocument(id)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);

    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("SUCCESS");
    // Continued from the dead claim rather than restarted.
    expect(delivery.attempts).toBe(2);
    expect(delivery.leaseOwner).not.toBe("an-invocation-that-died");
  });
});

// ---------------------------------------------------------------------------
// 3. Error taxonomy, end to end
// ---------------------------------------------------------------------------

describe("transient failure", () => {
  test("leaves a retryable ERROR with no endTime, and a rerun then succeeds", async () => {
    _setSesClientForTests(sendingError("ThrottlingException"));
    const { ref, id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("retryable-error");

    const failed = await deliveryOf(ref);
    expect(failed.state).toBe("ERROR");
    expect(failed.retryable).toBe(true);
    expect(failed.attempts).toBe(1);
    expect(failed.error.name).toBe("ThrottlingException");
    expect(failed.error.message).toContain("ThrottlingException");
    // Structured, and never a stack.
    expect(Object.keys(failed.error).sort()).toEqual(["message", "name"]);
    // NOT terminal, so the TTL policy must not become eligible to reap a
    // document that is still deliverable.
    expect(failed.endTime).toBeNull();
    // Lease released, so the retry does not have to wait five minutes.
    expect(failed.leaseExpiresAt).toBeNull();

    const send = sendingOk("ses-second-try");
    _setSesClientForTests(send);
    expect(await deliverMailDocument(id)).toBe("sent");

    const delivered = await deliveryOf(ref);
    expect(delivered.state).toBe("SUCCESS");
    expect(delivered.attempts).toBe(2);
    expect(delivered.info.messageId).toBe("ses-second-try");
    expect(delivered.endTime.toMillis()).toBeGreaterThan(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("a 5xx from SES is transient even under an unfamiliar name", async () => {
    _setSesClientForTests(
      sendingError("SomeFutureOutage", { $metadata: { httpStatusCode: 503 } })
    );
    const { ref, id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("retryable-error");
    expect((await deliveryOf(ref)).retryable).toBe(true);
  });
});

describe("permanent failure", () => {
  test("a rejected address is terminal immediately and is never retried", async () => {
    const send = sendingError("MessageRejected", {
      message: "Email address is not verified.",
    });
    _setSesClientForTests(send);
    const { ref, id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("terminal-error");

    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("ERROR");
    expect(delivery.retryable).toBe(false);
    expect(delivery.attempts).toBe(1);
    expect(delivery.error.name).toBe("MessageRejected");
    // Terminal, so the TTL policy can eventually reap the address in `to`.
    expect(delivery.endTime.toMillis()).toBeGreaterThan(0);

    // And a redelivery of the create event does not try again.
    expect(await deliverMailDocument(id)).toBe("skipped-terminal");
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("a document that cannot be turned into a request is terminal, not a crash", async () => {
    const send = sendingOk();
    _setSesClientForTests(send);
    const { ref, id } = await seedMail({ to: [] });

    expect(await deliverMailDocument(id)).toBe("terminal-error");
    expect(send).not.toHaveBeenCalled();

    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("ERROR");
    expect(delivery.retryable).toBe(false);
    expect(delivery.error.name).toBe("MailDocumentInvalidError");
  });

  test("an ambiguous send is terminal -- a maybe-delivered mail is not retried", async () => {
    // The request went out and no answer came back, and SESv2 SendEmail has no
    // idempotency token. Retrying is a coin flip on a SECOND copy of a
    // notification whose entire value is arriving once. See AMBIGUOUS_ERRORS.
    _setSesClientForTests(sendingError("TimeoutError"));
    const { ref, id } = await seedMail();

    expect(await deliverMailDocument(id)).toBe("terminal-error");
    const delivery = await deliveryOf(ref);
    expect(delivery.retryable).toBe(false);
    // Loudly, though -- it is visible on the document and in the log, so it is
    // re-drivable by hand. Never silent.
    expect(delivery.error.name).toBe("TimeoutError");
    expect(loggedText()).toContain("TimeoutError");
  });
});

describe("attempts cap", () => {
  test("a document already at the cap is not claimed at all", async () => {
    const send = sendingOk();
    _setSesClientForTests(send);
    const { ref, id } = await seedMail({
      delivery: {
        state: "ERROR",
        retryable: true,
        attempts: MAX_ATTEMPTS,
        error: { name: "ThrottlingException", message: "throttled" },
        leaseExpiresAt: null,
        endTime: null,
      },
    });

    expect(await deliverMailDocument(id)).toBe("skipped-attempts-exhausted");
    expect(send).not.toHaveBeenCalled();
    // Untouched -- attempts did not creep past the cap by being looked at.
    expect((await deliveryOf(ref)).attempts).toBe(MAX_ATTEMPTS);
  });

  test("the attempt that reaches the cap turns a transient error terminal", async () => {
    // "Retryable in principle" and "still willing to retry" are two different
    // facts; the cap is what closes the second one.
    _setSesClientForTests(sendingError("ThrottlingException"));
    const { ref, id } = await seedMail({
      delivery: {
        state: "ERROR",
        retryable: true,
        attempts: MAX_ATTEMPTS - 1,
        error: { name: "ThrottlingException", message: "throttled" },
        leaseExpiresAt: null,
        endTime: null,
        startTime: Timestamp.now(),
      },
    });

    expect(await deliverMailDocument(id)).toBe("terminal-error");

    const delivery = await deliveryOf(ref);
    expect(delivery.attempts).toBe(MAX_ATTEMPTS);
    expect(delivery.retryable).toBe(false);
    // The SES error name survives -- what changed is our willingness, not the
    // diagnosis.
    expect(delivery.error.name).toBe("ThrottlingException");
    expect(delivery.endTime.toMillis()).toBeGreaterThan(0);
    expect(await deliverMailDocument(id)).toBe("skipped-terminal");
  });
});

// ---------------------------------------------------------------------------
// 4. Missing configuration
// ---------------------------------------------------------------------------

describe("missing SES configuration", () => {
  test("is terminal, distinctly named, and loudly logged -- mail never vanishes", async () => {
    const send = sendingOk();
    _setSesClientForTests(send);
    const { ref, id } = await seedMail();

    const saved = process.env.SES_SECRET_ACCESS_KEY;
    delete process.env.SES_SECRET_ACCESS_KEY;
    let outcome;
    try {
      outcome = await deliverMailDocument(id);
    } finally {
      process.env.SES_SECRET_ACCESS_KEY = saved;
    }

    expect(outcome).toBe("terminal-error");
    expect(send).not.toHaveBeenCalled();

    const delivery = await deliveryOf(ref);
    expect(delivery.state).toBe("ERROR");
    expect(delivery.retryable).toBe(false);
    expect(delivery.error.name).toBe(CONFIG_MISSING_ERROR);
    // The document says WHICH key, by name. That is the whole difference
    // between a five-minute fix and an afternoon.
    expect(delivery.error.message).toContain("SES_SECRET_ACCESS_KEY");
    expect(delivery.endTime.toMillis()).toBeGreaterThan(0);

    // Loud: this line means every notification the deployment sends is being
    // dropped on the floor, so it is the one to alert on.
    expect(errorSpy).toHaveBeenCalled();
    const text = loggedText();
    expect(text).toContain(CONFIG_MISSING_ERROR);
    expect(text).toContain("SES_SECRET_ACCESS_KEY");
    // The NAME of the missing key, never a value of any key.
    expect(text).not.toContain(saved);
  });
});

// ---------------------------------------------------------------------------
// 5. The document moving underneath us
// ---------------------------------------------------------------------------

describe("races with account deletion", () => {
  test("a document deleted before delivery is not an error", async () => {
    // purge-user-data.ts deletes a researcher's queued mail on account
    // deletion. Racing that is expected, not a fault.
    const send = sendingOk();
    _setSesClientForTests(send);
    const { ref, id } = await seedMail();
    await ref.delete();

    expect(await deliverMailDocument(id)).toBe("gone");
    expect(send).not.toHaveBeenCalled();
  });

  test("a document deleted mid-send still resolves, and says so", async () => {
    const { ref, id } = await seedMail();
    _setSesClientForTests(
      jest.fn(async () => {
        await ref.delete();
        return { MessageId: "ses-sent-then-purged" };
      })
    );

    // The mail WAS sent; only the receipt has nowhere to go.
    expect(await deliverMailDocument(id)).toBe("sent");
    expect((await ref.get()).exists).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  test("a superseded claim does not stomp the newer attempt's result", async () => {
    // The lease guard on the terminal write. Simulated by rewriting leaseOwner
    // while this invocation is inside send() -- which is what a stale-lease
    // takeover looks like from here.
    const { ref, id } = await seedMail();
    _setSesClientForTests(
      jest.fn(async () => {
        await ref.update({
          "delivery.leaseOwner": "a-newer-invocation",
          "delivery.state": "SUCCESS",
          "delivery.info": { messageId: "written-by-the-newer-one" },
        });
        return { MessageId: "written-by-the-loser" };
      })
    );

    expect(await deliverMailDocument(id)).toBe("sent");

    const delivery = await deliveryOf(ref);
    expect(delivery.info.messageId).toBe("written-by-the-newer-one");
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Regression: purge-user-data.ts's query must keep working
// ---------------------------------------------------------------------------

describe("purge-user-data compatibility", () => {
  test("every delivery field lives under `delivery`, so datapipe.owner still finds the document", async () => {
    // purge-user-data.ts finds a researcher's mail with
    // `where("datapipe.owner", "==", uid)` and counts what it deleted
    // (PurgeCounts.mailDocuments, asserted exactly in
    // purge-user-data-emulator.test.js). A delivery that touched the top level
    // of the document, or `datapipe`, would change that count or that query.
    _setSesClientForTests(sendingOk());
    const { ref, id, owner } = await seedMail();

    const before = (await ref.get()).data();
    expect(await deliverMailDocument(id)).toBe("sent");
    const after = (await ref.get()).data();

    const found = await db
      .collection("mail")
      .where("datapipe.owner", "==", owner)
      .get();
    expect(found.docs).toHaveLength(1);
    expect(found.docs[0].id).toBe(id);

    // `delivery` is the ONLY key added, and nothing pre-existing moved.
    expect(Object.keys(after).sort()).toEqual(
      [...Object.keys(before), "delivery"].sort()
    );
    expect(after.to).toEqual(before.to);
    expect(after.message).toEqual(before.message);
    expect(after.datapipe.owner).toBe(owner);
    expect(after.datapipe.kind).toBe(before.datapipe.kind);
  });
});
