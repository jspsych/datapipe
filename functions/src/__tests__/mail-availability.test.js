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
let nextUtcMonthStart;
let pauseUntil;
let usableQuotaReading;
let isQuotaReadingStale;
let VERIFICATION_CEILING;
let FREE_PLAN_DAILY_LIMIT;
let SYSTEMIC_PAUSE_MS;

let sweepDecision;
let pauseKindFor;
let MAX_SWEEP_AGE_MS;
let IDEMPOTENCY_WINDOW_MS;
let MAX_ATTEMPTS;

let retentionDecision;

beforeAll(async () => {
  ({
    verificationAvailability,
    deliveryPaused,
    nextUtcMidnight,
    nextUtcMonthStart,
    pauseUntil,
    usableQuotaReading,
    isQuotaReadingStale,
    VERIFICATION_CEILING,
    FREE_PLAN_DAILY_LIMIT,
    SYSTEMIC_PAUSE_MS,
  } = await import("../../lib/mail-availability.js"));

  ({ sweepDecision, MAX_SWEEP_AGE_MS, IDEMPOTENCY_WINDOW_MS } = await import(
    "../../lib/scheduled-mail-retry.js"
  ));

  ({ pauseKindFor, MAX_ATTEMPTS } = await import("../../lib/mail-delivery.js"));

  ({ retentionDecision } = await import("../../lib/upload-retention.js"));
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

describe("nextUtcMonthStart", () => {
  test("is the start of the next UTC month, not thirty days out", () => {
    expect(nextUtcMonthStart(NOON)).toBe(Date.UTC(2026, 8, 1));
    // The 20th of the month is the motivating case: the monthly cap is hit
    // with eleven days still to run, and a daily reset would reopen the
    // breaker that night.
    expect(nextUtcMonthStart(Date.UTC(2026, 7, 20, 3, 0, 0))).toBe(
      Date.UTC(2026, 8, 1)
    );
    // December rolls the year.
    expect(nextUtcMonthStart(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe(
      Date.UTC(2027, 0, 1)
    );
  });
});

describe("pauseUntil", () => {
  test("a daily cap holds until midnight; a MONTHLY cap holds until the month turns", () => {
    // The distinction the breaker used to lack. Treating a monthly exhaustion
    // as a daily one reopened sending every midnight into a cap with days left
    // to run -- and each probe spent one of a queued mail's three attempts, so
    // three nights turned every queued notification terminal.
    expect(pauseUntil("daily-quota", NOON)).toBe(MIDNIGHT_AFTER);
    expect(pauseUntil("monthly-quota", NOON)).toBe(Date.UTC(2026, 8, 1));
    expect(pauseUntil("monthly-quota", NOON)).toBeGreaterThan(
      pauseUntil("daily-quota", NOON)
    );
  });

  test("a systemic failure is a short cooldown, not a wait for a reset", () => {
    // Nothing resets: a revoked key or an unverified domain needs a human. The
    // pause is only there to stop a loop of failing sends, so it is minutes.
    expect(pauseUntil("systemic", NOON)).toBe(NOON + SYSTEMIC_PAUSE_MS);
    expect(pauseUntil("systemic", NOON)).toBeLessThan(MIDNIGHT_AFTER);
  });
});

describe("pauseKindFor", () => {
  test("tells the two quota caps apart, and names the systemic failures", () => {
    expect(pauseKindFor("daily_quota_exceeded")).toBe("daily-quota");
    expect(pauseKindFor("monthly_quota_exceeded")).toBe("monthly-quota");
    for (const name of [
      "suspended_api_key",
      "missing_api_key",
      "restricted_api_key",
      "invalid_permission",
      "MailConfigMissingError",
    ]) {
      expect(pauseKindFor(name)).toBe("systemic");
    }
  });

  test("does NOT shut the breaker for a per-message failure", () => {
    // validation_error is Resend's name both for an unverified sending domain
    // and for one malformed recipient address. One researcher's typo must not
    // switch verification off for everybody, so the ambiguous name is left out
    // and the unambiguous ones carry the rule.
    expect(pauseKindFor("validation_error")).toBeNull();
    expect(pauseKindFor("rate_limit_exceeded")).toBeNull();
    expect(pauseKindFor("application_error")).toBeNull();
    expect(pauseKindFor("ECONNRESET")).toBeNull();
  });
});

describe("usableQuotaReading", () => {
  test("refuses a reading that cannot be a count of today's sends", () => {
    // The bound exists because the header's MEANING is assumed, not documented.
    // If x-resend-daily-quota turns out to be the monthly counter or a plan
    // limit, an unbounded reading would sit above the reserve ceiling forever
    // and hold verification shut with nothing in the logs saying why.
    expect(usableQuotaReading(0)).toBe(0);
    expect(usableQuotaReading(94)).toBe(94);
    expect(usableQuotaReading(FREE_PLAN_DAILY_LIMIT)).toBe(FREE_PLAN_DAILY_LIMIT);
    expect(usableQuotaReading(FREE_PLAN_DAILY_LIMIT + 1)).toBeNull();
    expect(usableQuotaReading(2900)).toBeNull();
    expect(usableQuotaReading(-1)).toBeNull();
    expect(usableQuotaReading("94")).toBeNull();
    expect(usableQuotaReading(Number.NaN)).toBeNull();
    expect(usableQuotaReading(undefined)).toBeNull();
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

describe("verificationAvailability, on an implausible reading", () => {
  test("an out-of-range reading does not hold verification shut", () => {
    // A stored 2,900 is not "today's sends on a free plan" whatever else it
    // is -- the monthly counter, say. Acting on it would refuse every
    // researcher a code indefinitely, and because each send rewrites
    // dailyQuotaObservedAt, the staleness escape hatch would never fire.
    expect(
      verificationAvailability(
        { dailyQuotaUsed: 2900, dailyQuotaObservedAt: ts(NOON - 60_000) },
        NOON
      )
    ).toEqual({ available: true });
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
    // flip on a second copy, so we give up rather than gamble.
    const inside = doc({
      error: { name: "application_error", message: "boom" },
      startTime: ts(NOON - 60 * 60 * 1000),
      lastAttemptAt: ts(NOON - 60 * 60 * 1000),
    });
    expect(sweepDecision(inside, NOON)).toBe("deliver");

    const outside = doc({
      error: { name: "application_error", message: "boom" },
      startTime: ts(NOON - IDEMPOTENCY_WINDOW_MS - 60_000),
      lastAttemptAt: ts(NOON - IDEMPOTENCY_WINDOW_MS - 60_000),
    });
    // Terminal, not skipped: it can never become deliverable again -- the key
    // has expired and only gets older -- so leaving it "retryable" would keep
    // expireAt off the document and hold the address forever, while occupying
    // a slot in every future pass.
    expect(sweepDecision(outside, NOON)).toBe("age-out");
  });

  test("measures the idempotency window from startTime, NOT from the last attempt", () => {
    // THE BUG THIS PINS. The Idempotency-Key is the document id, and Resend
    // expires it 24 hours after its FIRST use. Measuring the window from
    // lastAttemptAt slides it forward with every retry: a mail first attempted
    // at T0 and retried at T0+20h is "20 hours old" at T0+40h and would be
    // sent again on a key that expired at T0+24h -- which Resend treats as a
    // new message, and the researcher gets a second copy.
    const retriedTwice = doc({
      error: { name: "application_error", message: "boom" },
      startTime: ts(NOON - 40 * 60 * 60 * 1000),
      lastAttemptAt: ts(NOON - 20 * 60 * 60 * 1000),
    });
    expect(sweepDecision(retriedTwice, NOON)).toBe("age-out");

    // ...and the same document while the key is genuinely still live.
    const stillInside = doc({
      error: { name: "application_error", message: "boom" },
      startTime: ts(NOON - 20 * 60 * 60 * 1000),
      lastAttemptAt: ts(NOON - 60 * 60 * 1000),
    });
    expect(sweepDecision(stillInside, NOON)).toBe("deliver");
  });

  test("NEVER sends inline mail, whatever the error says -- it ends it instead", () => {
    // A verification code is realtime. Delivering one an hour late is not a
    // late success -- it may already have expired, and the researcher has long
    // since given up or requested another. Terminal rather than skipped: a
    // skipped document keeps `retryable: true`, never gets expireAt, and holds
    // its recipient's address outside the TTL's reach for good.
    expect(
      sweepDecision(
        doc(
          {
            error: { name: "daily_quota_exceeded", message: "quota" },
            startTime: ts(NOON - 60_000),
            lastAttemptAt: ts(NOON - 60_000),
          },
          { datapipe: { kind: "contact-email-verification", deliverInline: true } }
        ),
        NOON
      )
    ).toBe("age-out");
  });

  test("recovers a claim that was abandoned mid-send", () => {
    // deliverMailDocument's claim writes PROCESSING with `retryable: null`
    // BEFORE the send, so an instance killed inside the send leaves a document
    // that the retryable-ERROR query cannot see and the TTL cannot reap. An
    // expired lease is the proof the claimant is dead.
    const stranded = {
      to: ["researcher@example.edu"],
      datapipe: { kind: "upload-failure", owner: "uid-1" },
      delivery: {
        state: "PROCESSING",
        retryable: null,
        attempts: 1,
        startTime: ts(NOON - 30 * 60 * 1000),
        leaseExpiresAt: ts(NOON - 60_000),
      },
    };
    expect(sweepDecision(stranded, NOON)).toBe("deliver");

    // A LIVE lease is the one case that is genuinely somebody else's: another
    // invocation may be inside the send right now.
    expect(
      sweepDecision(
        {
          ...stranded,
          delivery: { ...stranded.delivery, leaseExpiresAt: ts(NOON + 60_000) },
        },
        NOON
      )
    ).toBe("skip");
  });

  test("ends a stranded claim rather than resending it once the key has expired", () => {
    // Same document, a day and a half later. Nothing knows whether the send
    // went out, and the Idempotency-Key that would have made a retry safe is
    // gone -- so this is exactly the coin flip the sweeper declines.
    expect(
      sweepDecision(
        {
          to: ["researcher@example.edu"],
          datapipe: { kind: "upload-failure", owner: "uid-1" },
          delivery: {
            state: "PROCESSING",
            attempts: 1,
            startTime: ts(NOON - IDEMPOTENCY_WINDOW_MS - 60_000),
            leaseExpiresAt: ts(NOON - IDEMPOTENCY_WINDOW_MS),
          },
        },
        NOON
      )
    ).toBe("age-out");
  });

  test("ends a document that has spent its whole attempt budget", () => {
    // Otherwise deliverMailDocument answers "skipped-attempts-exhausted" on
    // every pass forever, and the document sits in the query eating the budget
    // a deliverable notification needed.
    expect(
      sweepDecision(
        doc({
          error: { name: "daily_quota_exceeded", message: "quota" },
          attempts: MAX_ATTEMPTS,
          startTime: ts(NOON - 60_000),
          lastAttemptAt: ts(NOON - 60_000),
        }),
        NOON
      )
    ).toBe("age-out");
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

  test("a document with NO usable clock ages out rather than living forever", () => {
    // An older deploy's write, a hand edit during an incident, a partially
    // applied update. With neither timestamp there is no age at which it would
    // ever cross the age bound, so a "skip" here is permanent: no expireAt is
    // ever written, the TTL never reaps it, and it holds a researcher's address
    // for good -- the precise hole ageing out exists to close.
    expect(
      sweepDecision(
        doc({ error: { name: "application_error", message: "boom" } }),
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

  test("treats an error with no usable name as ambiguous, not as unswept work", () => {
    // Not knowing what happened is the definition of ambiguous, and ambiguity
    // is what the Idempotency-Key resolves: inside the window a retry is a
    // no-op at Resend, so it is safe; outside it, this becomes terminal like
    // every other ambiguity. What it must never be is a permanent skip -- that
    // is a document nothing ever writes again, in a query nothing ever
    // finishes.
    expect(
      sweepDecision(
        doc({ error: {}, startTime: ts(NOON - 1000), lastAttemptAt: ts(NOON - 1000) }),
        NOON
      )
    ).toBe("deliver");
    expect(
      sweepDecision(
        doc({
          error: {},
          startTime: ts(NOON - IDEMPOTENCY_WINDOW_MS - 1000),
          lastAttemptAt: ts(NOON - IDEMPOTENCY_WINDOW_MS - 1000),
        }),
        NOON
      )
    ).toBe("age-out");
  });
});

// ---------------------------------------------------------------------------
// 4. May this researcher's unuploaded data be destroyed?
// ---------------------------------------------------------------------------

describe("retentionDecision", () => {
  const DAY = 24 * 60 * 60 * 1000;
  // The sweep only ever asks about entries already older than seven days.
  const entry = (over = {}) => ({
    status: "failed",
    retryCount: 5,
    maxRetries: 5,
    createdAt: ts(NOON - 8 * DAY),
    ...over,
  });

  test("deletes an ordinary aged-out entry, exactly as before", () => {
    // The unchanged default. Nothing below should make the common case keep
    // data longer than it used to.
    expect(retentionDecision(entry(), NOON)).toBe("delete");
  });

  test("retains an entry whose upload is still being retried", () => {
    // The storage-provider outage case: this would have uploaded fine on day
    // eight, so deleting it on day seven throws away data that was never
    // actually lost.
    expect(
      retentionDecision(entry({ status: "pending", retryCount: 3 }), NOON)
    ).toBe("retain");
  });

  test("deletes a pending entry whose retries are exhausted", () => {
    // "Pending" alone is not a reason to keep it -- an entry that has spent its
    // whole retry budget is not live work, it is a corpse with a hopeful status.
    expect(
      retentionDecision(entry({ status: "pending", retryCount: 5 }), NOON)
    ).toBe("delete");
  });

  test("retains an entry the researcher has not been told about", () => {
    expect(
      retentionDecision(entry({ retainUntil: ts(NOON + 2 * DAY) }), NOON)
    ).toBe("retain");
  });

  test("deletes once the extension itself has expired", () => {
    expect(
      retentionDecision(entry({ retainUntil: ts(NOON - 1000) }), NOON)
    ).toBe("delete");
  });

  test("the absolute ceiling beats every reason to keep it", () => {
    // Without this, an experiment whose provider is dead and whose owner never
    // reads their mail would hold research payloads in Cloud Storage forever,
    // silently, at DataPipe's cost. Both extension paths are tested against it
    // because either one alone would otherwise be unbounded.
    const ancient = { createdAt: ts(NOON - 15 * DAY) };
    expect(
      retentionDecision(
        entry({ ...ancient, status: "pending", retryCount: 0 }),
        NOON
      )
    ).toBe("delete");
    expect(
      retentionDecision(
        entry({ ...ancient, retainUntil: ts(NOON + 5 * DAY) }),
        NOON
      )
    ).toBe("delete");
  });

  test("a missing or unreadable createdAt does not disable the ceiling check", () => {
    // Defensive: a hand-written or partially-migrated entry must not become
    // immortal by lacking a field.
    expect(retentionDecision({ status: "failed" }, NOON)).toBe("delete");
  });
});
