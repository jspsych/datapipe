/**
 * @jest-environment node
 */

// Pure coverage for the two predicates that decide whether DataPipe sends.
//
//   verificationAvailability()  may the REALTIME path send right now?
//   sweepDecision()             may this failed mail be retried right now?
//
// Both are functions of their arguments, and both are the entire safety
// argument of the feature they belong to -- so they are asserted as tables
// here rather than provoked through Firestore, a scheduler and a mail
// transport. The end-to-end behaviour lives in mail-retry-emulator.test.js.
//
// Imports the COMPILED modules (functions/lib/), so `npm --prefix functions run
// build` must run first. Same convention as mail-delivery.test.js, including
// the emulator bootstrap -- these modules reach app.js transitively for `db`,
// and app.js calls initializeApp() with no arguments. Nothing here talks to
// Firestore.

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

let verificationAvailability;
let deliveryPaused;
let nextUtcMidnight;
let isQuotaReadingStale;
let VERIFICATION_CEILING;
let FREE_PLAN_DAILY_LIMIT;

let sweepDecision;
let MAX_SWEEP_AGE_MS;
let IDEMPOTENCY_WINDOW_MS;

beforeAll(async () => {
  ({
    verificationAvailability,
    deliveryPaused,
    nextUtcMidnight,
    isQuotaReadingStale,
    VERIFICATION_CEILING,
    FREE_PLAN_DAILY_LIMIT,
  } = await import("../../lib/mail-availability.js"));

  ({ sweepDecision, MAX_SWEEP_AGE_MS, IDEMPOTENCY_WINDOW_MS } = await import(
    "../../lib/scheduled-mail-retry.js"
  ));
});

// Stored Timestamps, as the Admin SDK hands them back.
const ts = (ms) => ({ toMillis: () => ms });

// A fixed instant well inside a UTC day, so "next midnight" arithmetic is not
// accidentally satisfied by being near a boundary.
const NOON = Date.UTC(2026, 7, 29, 12, 0, 0); // 2026-08-29T12:00:00Z
const MIDNIGHT_AFTER = Date.UTC(2026, 7, 30, 0, 0, 0);

// ---------------------------------------------------------------------------
// 1. The daily-reset guess, isolated
// ---------------------------------------------------------------------------

describe("nextUtcMidnight", () => {
  test("is the next UTC day boundary, not 24 hours out", () => {
    expect(nextUtcMidnight(NOON)).toBe(MIDNIGHT_AFTER);
    // One second before midnight -> that midnight is already past, so the next
    // one is the following day. The off-by-one that would break the breaker.
    expect(nextUtcMidnight(MIDNIGHT_AFTER - 1000)).toBe(MIDNIGHT_AFTER);
    expect(nextUtcMidnight(MIDNIGHT_AFTER)).toBe(
      Date.UTC(2026, 7, 31, 0, 0, 0)
    );
  });

  test("rolls over month and year boundaries", () => {
    expect(nextUtcMidnight(Date.UTC(2026, 7, 31, 23, 0, 0))).toBe(
      Date.UTC(2026, 8, 1, 0, 0, 0)
    );
    expect(nextUtcMidnight(Date.UTC(2026, 11, 31, 23, 0, 0))).toBe(
      Date.UTC(2027, 0, 1, 0, 0, 0)
    );
  });
});

describe("isQuotaReadingStale", () => {
  test("a reading from earlier today is fresh", () => {
    expect(isQuotaReadingStale(NOON - 60_000, NOON)).toBe(false);
  });

  test("a reading from before the last midnight is stale", () => {
    // Yesterday's 100/100 must not hold today's verification path shut.
    expect(isQuotaReadingStale(NOON - 24 * 60 * 60 * 1000, NOON)).toBe(true);
  });

  test("no reading at all is stale, not fresh", () => {
    expect(isQuotaReadingStale(null, NOON)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. May the realtime path send?
// ---------------------------------------------------------------------------

describe("verificationAvailability", () => {
  test("an absent status document means available", () => {
    // Fails OPEN. A missing or unreadable status document must never be the
    // reason a researcher cannot verify their address -- the worst case is one
    // send that discovers the real state and records it.
    expect(verificationAvailability(undefined, NOON).available).toBe(true);
    expect(verificationAvailability({}, NOON).available).toBe(true);
  });

  test("a live unavailableUntil closes it", () => {
    const result = verificationAvailability(
      { unavailableUntil: ts(MIDNIGHT_AFTER) },
      NOON
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe("quota-exhausted");
    expect(result.until).toBe(MIDNIGHT_AFTER);
  });

  test("an expired unavailableUntil reopens it without anyone clearing it", () => {
    // The breaker has to reopen on its own. If it only ever reopened on a
    // successful send, and the realtime path is the only sender, nothing would
    // ever send again.
    expect(
      verificationAvailability({ unavailableUntil: ts(NOON - 1) }, NOON).available
    ).toBe(true);
  });

  test("the reserve closes it before the quota is actually gone", () => {
    // The whole point of reading x-resend-daily-quota off SUCCESS responses:
    // stop the realtime path with headroom left, rather than discovering the
    // limit by failing.
    const atCeiling = verificationAvailability(
      { dailyQuotaUsed: VERIFICATION_CEILING, dailyQuotaObservedAt: ts(NOON - 1000) },
      NOON
    );
    expect(atCeiling.available).toBe(false);
    expect(atCeiling.reason).toBe("quota-reserve");

    // ...and one below it is still open.
    expect(
      verificationAvailability(
        {
          dailyQuotaUsed: VERIFICATION_CEILING - 1,
          dailyQuotaObservedAt: ts(NOON - 1000),
        },
        NOON
      ).available
    ).toBe(true);
  });

  test("the reserve leaves real headroom for upload-failure mail", () => {
    // The asymmetry is the design decision, so assert it rather than trusting
    // the constants to stay sane: verification must stop with sends to spare,
    // because an upload-failure notification is the one nobody can recover
    // from missing.
    expect(VERIFICATION_CEILING).toBeLessThan(FREE_PLAN_DAILY_LIMIT);
    expect(FREE_PLAN_DAILY_LIMIT - VERIFICATION_CEILING).toBeGreaterThanOrEqual(5);
  });

  test("yesterday's reading does not close today", () => {
    // Without the staleness check the breaker would latch permanently: a
    // reading of 100/100 taken yesterday would keep refusing forever, because
    // nothing rewrites it until a send succeeds and no send is attempted.
    expect(
      verificationAvailability(
        {
          dailyQuotaUsed: FREE_PLAN_DAILY_LIMIT,
          dailyQuotaObservedAt: ts(NOON - 24 * 60 * 60 * 1000),
        },
        NOON
      ).available
    ).toBe(true);
  });

  test("a missing quota reading is not treated as zero", () => {
    // On a paid plan Resend stops sending x-resend-daily-quota. Absent must
    // read as "no daily cap applies", which is what makes this module turn
    // itself off on upgrade instead of needing to be removed.
    expect(
      verificationAvailability({ dailyQuotaObservedAt: ts(NOON) }, NOON).available
    ).toBe(true);
    expect(
      verificationAvailability(
        { dailyQuotaUsed: "lots", dailyQuotaObservedAt: ts(NOON) },
        NOON
      ).available
    ).toBe(true);
  });
});

describe("deliveryPaused", () => {
  test("tracks unavailableUntil only, and ignores the verification reserve", () => {
    // The reserve exists to keep the realtime path off the last few sends. The
    // sweeper is the consumer those sends are being reserved FOR, so it must
    // not be stopped by them.
    expect(
      deliveryPaused(
        {
          dailyQuotaUsed: VERIFICATION_CEILING,
          dailyQuotaObservedAt: ts(NOON - 1000),
        },
        NOON
      )
    ).toBe(false);

    expect(deliveryPaused({ unavailableUntil: ts(MIDNIGHT_AFTER) }, NOON)).toBe(true);
    expect(deliveryPaused({ unavailableUntil: ts(NOON - 1) }, NOON)).toBe(false);
    expect(deliveryPaused(undefined, NOON)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. May this failed mail be swept?
// ---------------------------------------------------------------------------

describe("sweepDecision", () => {
  const doc = (delivery, extra = {}) => ({
    to: ["researcher@example.edu"],
    datapipe: { kind: "upload-failure", owner: "uid-1", ...(extra.datapipe ?? {}) },
    delivery: { state: "ERROR", retryable: true, ...delivery },
  });

  test("sweeps a refused error at any age inside the age bound", () => {
    // Quota is the case the sweeper exists for, and it is provably un-sent:
    // Resend refused the request, so there is no message to duplicate.
    expect(
      sweepDecision(
        doc({
          error: { name: "daily_quota_exceeded", message: "quota" },
          lastAttemptAt: ts(NOON - 2 * 60 * 60 * 1000),
        }),
        NOON
      )
    ).toBe("deliver");
  });

  test("sweeps a refused error even PAST the idempotency window", () => {
    // The distinction that makes the sweeper safe. A refusal means Resend
    // never accepted anything, so the 24-hour Idempotency-Key window is
    // irrelevant -- there is nothing for it to deduplicate.
    expect(
      sweepDecision(
        doc({
          error: { name: "ECONNREFUSED", message: "refused" },
          lastAttemptAt: ts(NOON - 2 * IDEMPOTENCY_WINDOW_MS),
        }),
        NOON
      )
    ).toBe("deliver");
  });

  test("sweeps a 5xx only INSIDE the idempotency window", () => {
    // A 500 may or may not have been accepted. Inside the window the
    // Idempotency-Key makes a retry a no-op; outside it, the retry is a coin
    // flip on a second copy, so we decline.
    const inside = doc({
      error: { name: "application_error", message: "boom" },
      lastAttemptAt: ts(NOON - 60 * 60 * 1000),
    });
    expect(sweepDecision(inside, NOON)).toBe("deliver");

    const outside = doc({
      error: { name: "application_error", message: "boom" },
      lastAttemptAt: ts(NOON - IDEMPOTENCY_WINDOW_MS - 60_000),
    });
    expect(sweepDecision(outside, NOON)).toBe("skip");
  });

  test("NEVER sweeps inline mail, whatever the error says", () => {
    // A verification code is realtime. Delivering one an hour late is not a
    // late success -- it may already have expired, and the researcher has long
    // since given up or requested another.
    expect(
      sweepDecision(
        doc(
          {
            error: { name: "daily_quota_exceeded", message: "quota" },
            lastAttemptAt: ts(NOON - 60_000),
          },
          { datapipe: { kind: "contact-email-verification", deliverInline: true } }
        ),
        NOON
      )
    ).toBe("skip");
  });

  test("ages out anything past the age bound, rather than skipping it", () => {
    // Terminal, not skip, and the difference matters: a retryable ERROR never
    // gets delivery.expireAt, so skipping would leave the document holding a
    // researcher's address outside the TTL policy's reach forever.
    expect(
      sweepDecision(
        doc({
          error: { name: "daily_quota_exceeded", message: "quota" },
          lastAttemptAt: ts(NOON - MAX_SWEEP_AGE_MS - 60_000),
        }),
        NOON
      )
    ).toBe("age-out");
  });

  test("falls back to startTime when lastAttemptAt is absent", () => {
    // Documents written before lastAttemptAt existed still have to age out.
    expect(
      sweepDecision(
        doc({
          error: { name: "daily_quota_exceeded", message: "quota" },
          startTime: ts(NOON - MAX_SWEEP_AGE_MS - 60_000),
        }),
        NOON
      )
    ).toBe("age-out");
  });

  test("ignores anything that is not a live retryable error", () => {
    expect(sweepDecision(doc({ state: "SUCCESS", retryable: false }), NOON)).toBe(
      "skip"
    );
    expect(sweepDecision(doc({ retryable: false }), NOON)).toBe("skip");
    expect(sweepDecision({ to: ["x@example.edu"] }, NOON)).toBe("skip");
  });

  test("skips an error with no usable name rather than guessing", () => {
    expect(
      sweepDecision(doc({ error: {}, lastAttemptAt: ts(NOON - 1000) }), NOON)
    ).toBe("skip");
    expect(sweepDecision(doc({ lastAttemptAt: ts(NOON - 1000) }), NOON)).toBe("skip");
  });
});
