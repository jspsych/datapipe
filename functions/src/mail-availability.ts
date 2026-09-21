// Is DataPipe able to send mail right now, and if not, until when?
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
//
// The two things DataPipe mails are not the same kind of thing, and the
// difference only shows up when quota runs out:
//
//   contact-email verification  REALTIME. A researcher clicked a button and is
//                               watching for a 6-digit code that expires in 24
//                               hours. A code delivered tomorrow is not a late
//                               success, it is a failure with extra steps.
//                               Never retried.
//   upload-failure notification DEFERRABLE. "Your data stopped arriving" is
//                               just as true an hour later. Retried by
//                               scheduled-mail-retry.ts.
//
// So the realtime path needs to know, BEFORE it does anything, whether a send
// can succeed -- otherwise it mints a code, arms its own resend cooldown, tells
// the researcher to check their inbox, and only then discovers that nothing can
// be sent. That is the state this module exists to prevent, and it is why the
// check has to happen ahead of the send rather than being inferred from it.
//
// ---------------------------------------------------------------------------
// WHERE THE NUMBER COMES FROM
// ---------------------------------------------------------------------------
//
// Resend returns `x-resend-daily-quota` -- the quota USED so far today -- on
// ordinary successful responses, not only on 429s. That is the whole reason
// this can be proactive: we learn we are at 94/100 while sending is still
// working, instead of finding out by failing.
//
// The rate-limit headers (`ratelimit-reset`, `retry-after`) are NOT useful
// here. They describe the per-second request limit (10/s per team), so
// `ratelimit-reset` counts down seconds to the next second. Resend documents no
// header or endpoint for when the DAILY quota rolls over, so nothing here may
// depend on knowing it -- see "the reset time is a guess" below.
//
// `x-resend-daily-quota` is documented as "only sent to free plan users". Its
// absence therefore means the daily cap does not apply, which is exactly right:
// on a paid plan this module quietly stops tripping instead of needing to be
// removed.
//
// THAT READING IS AN ASSUMPTION, AND IT IS LOAD-BEARING. Resend documents the
// header's existence, not its semantics, and "used today" and "remaining today"
// are the same shape. If it is really the plan LIMIT, every reading is 100, the
// reserve rule below is true forever, and verification is off for good -- and
// because each send rewrites dailyQuotaObservedAt, the staleness escape hatch
// never fires either. Three things bound that:
//
//   1. A reading outside [0, FREE_PLAN_DAILY_LIMIT] is refused at the write
//      (recordSendOutcome) and ignored at the read. That catches a header that
//      turns out to be the monthly counter, or a remaining-quota value on a
//      paid plan.
//   2. Refusing a verification on the reserve alone logs at ERROR with a stable
//      token, so the condition is alertable rather than silent
//      (docs/deploy-contact-email.md §6).
//   3. The runbook says how to capture a real response header and check the
//      number against the Resend dashboard (§5). Do that before trusting it.

import { Timestamp } from "firebase-admin/firestore";
import { db } from "./app.js";

export const STATUS_COLLECTION = "systemStatus";
export const MAIL_STATUS_DOC = "mail";

// Resend's free plan: 3,000/month with a 100/day ceiling. Only used to derive
// the reserve below -- nothing here fails closed if the real limit differs,
// because an actual `daily_quota_exceeded` sets the breaker regardless.
export const FREE_PLAN_DAILY_LIMIT = 100;

// Sends held back from the REALTIME path.
//
// Verification stops at the ceiling; upload-failure notifications keep going to
// the full limit. The asymmetry is deliberate and it is the important design
// decision in this file: a researcher waiting on a verification code can come
// back in an hour, but an upload-failure notification is the only signal that a
// researcher's data has stopped arriving. If anything gets the last ten sends
// of the day, it should be the one nobody can recover from missing.
export const VERIFICATION_RESERVE = 10;
export const VERIFICATION_CEILING = FREE_PLAN_DAILY_LIMIT - VERIFICATION_RESERVE;

export interface MailStatus {
  dailyQuotaUsed?: unknown;
  dailyQuotaObservedAt?: unknown;
  unavailableUntil?: unknown;
  reason?: unknown;
}

export type UnavailableReason = "quota-exhausted" | "quota-reserve";

export type Availability =
  | { available: true }
  | { available: false; reason: UnavailableReason; until: number | null };

function millisOrNull(value: unknown): number | null {
  if (!value || typeof (value as { toMillis?: unknown }).toMillis !== "function") {
    return null;
  }
  return (value as { toMillis: () => number }).toMillis();
}

/**
 * Midnight UTC after the given instant.
 *
 * THE RESET TIME IS A GUESS, and this is where the guess lives. Resend does not
 * publish when a daily quota rolls over; UTC midnight is the conventional
 * answer and is almost certainly right, but nothing here is allowed to DEPEND
 * on it being right. It is used only as a ceiling on how long the breaker stays
 * shut. What actually reopens sending early is a successful send discovered by
 * scheduled-mail-retry.ts -- the deferrable path probes, the realtime path only
 * ever reads. If the real reset is an hour later than this, the sweeper's next
 * attempt fails and re-arms the breaker; if it is earlier, the sweeper finds
 * out and clears it. Either way the guess costs nothing.
 */
export function nextUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/**
 * Start of the UTC month after the given instant.
 *
 * The free plan has TWO caps -- 100/day and 3,000/month -- and they reset on
 * different clocks. Reusing the daily reset for a monthly exhaustion is not a
 * small error: hit the monthly cap on the 20th and the breaker reopens at
 * midnight, the sweeper probes into a cap that has eleven days left to run,
 * fails, and spends one of each queued document's MAX_ATTEMPTS doing it. Three
 * nights of that and every queued notification is terminal -- which is the
 * exact retry-budget exhaustion the breaker exists to prevent.
 *
 * Same guess-status as nextUtcMidnight, and the same escape hatch: an operator
 * who upgrades the plan mid-month clears `systemStatus/mail` by hand rather
 * than waiting this out (docs/deploy-contact-email.md §5).
 */
export function nextUtcMonthStart(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

// Why sending stopped, and therefore how long it stays stopped.
//
//   daily-quota    resets at the next UTC midnight.
//   monthly-quota  resets at the start of the next UTC month.
//   systemic       nothing about the account is exhausted; the deployment
//                  cannot send at all (a revoked key, an unverified domain,
//                  missing configuration). No reset time exists, so this is a
//                  short cooldown and nothing more -- see SYSTEMIC_PAUSE_MS.
export type PauseKind = "daily-quota" | "monthly-quota" | "systemic";

// How long a systemic failure holds sending shut.
//
// Short on purpose. A systemic failure needs a human, and this cannot wait for
// one -- but it must not let a loop of failing sends run either. Fifteen
// minutes bounds a revoked key to ~4 wasted Resend requests an hour no matter
// how many researchers press the button, and it is long enough that the
// sweeper (every 10 minutes) skips at most two passes if the diagnosis was
// wrong.
export const SYSTEMIC_PAUSE_MS = 15 * 60 * 1000;

/** When may sending be tried again, given why it stopped? */
export function pauseUntil(kind: PauseKind, nowMs: number): number {
  if (kind === "daily-quota") return nextUtcMidnight(nowMs);
  if (kind === "monthly-quota") return nextUtcMonthStart(nowMs);
  return nowMs + SYSTEMIC_PAUSE_MS;
}

/**
 * A stored daily-quota reading, or null if there isn't a usable one.
 *
 * The bound is the point. `dailyQuotaUsed` comes from a response header whose
 * semantics are assumed rather than documented (see the header), and a reading
 * that cannot be what we think it is must not be allowed to hold the
 * verification path shut forever. Anything outside [0, FREE_PLAN_DAILY_LIMIT]
 * is not a count of today's sends on a free plan, whatever else it is.
 */
export function usableQuotaReading(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > FREE_PLAN_DAILY_LIMIT) return null;
  return value;
}

/**
 * Has a quota reading aged out?
 *
 * A reading taken before the most recent UTC midnight describes yesterday's
 * usage and must not hold today's verification path shut. This is the same
 * guess as above, in the opposite direction, and it fails SAFE: treating a
 * still-valid reading as stale merely lets a send through, and that send
 * returns a fresh number.
 */
export function isQuotaReadingStale(observedAtMs: number | null, nowMs: number): boolean {
  if (observedAtMs === null) return true;
  return nextUtcMidnight(observedAtMs) <= nowMs;
}

/**
 * May the REALTIME path send right now?
 *
 * Pure, and exported for it: this is the predicate a researcher's account page
 * ultimately renders, and it needs no Firestore to assert.
 */
export function verificationAvailability(
  status: MailStatus | undefined,
  nowMs: number
): Availability {
  const until = millisOrNull(status?.unavailableUntil);
  if (until !== null && until > nowMs) {
    return { available: false, reason: "quota-exhausted", until };
  }

  const used = usableQuotaReading(status?.dailyQuotaUsed);
  const observedAt = millisOrNull(status?.dailyQuotaObservedAt);
  if (
    used !== null &&
    !isQuotaReadingStale(observedAt, nowMs) &&
    used >= VERIFICATION_CEILING
  ) {
    return {
      available: false,
      reason: "quota-reserve",
      until: observedAt === null ? null : nextUtcMidnight(observedAt),
    };
  }

  return { available: true };
}

/**
 * Is delivery paused outright? Used by scheduled-mail-retry.ts to decide
 * whether to sweep at all.
 *
 * Deliberately does NOT consider the verification reserve: the reserve exists
 * to keep the realtime path off the last few sends, and the sweeper is the
 * consumer those sends are being reserved FOR.
 */
export function deliveryPaused(status: MailStatus | undefined, nowMs: number): boolean {
  const until = millisOrNull(status?.unavailableUntil);
  return until !== null && until > nowMs;
}

let statusDocId = MAIL_STATUS_DOC;

/**
 * Test seam: point the breaker at a different document.
 *
 * `systemStatus/mail` is a SINGLETON, and the emulator is shared by suites
 * running in parallel. A test that trips the breaker on the real document would
 * make every concurrently-running suite that sends mail fail -- intermittently,
 * in a different place each run, which is the worst kind of failure to chase.
 * Pointing this suite at its own document is what keeps that from happening.
 * Pass null to restore.
 */
export function _setMailStatusDocForTests(docId: string | null): void {
  statusDocId = docId ?? MAIL_STATUS_DOC;
}

function statusRef(): FirebaseFirestore.DocumentReference {
  return db.collection(STATUS_COLLECTION).doc(statusDocId);
}

/**
 * Read the breaker. Never throws: a status read that fails must not be the
 * reason a researcher cannot verify their address, so an unreadable document is
 * treated as "no reason to believe anything is wrong".
 */
export async function readMailStatus(): Promise<MailStatus | undefined> {
  try {
    const snap = await statusRef().get();
    return snap.exists ? (snap.data() as MailStatus) : undefined;
  } catch (error) {
    console.error(
      "mail-availability: could not read mail status, assuming available:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return undefined;
  }
}

/**
 * Record the outcome of a send.
 *
 * Never throws, and never fails a delivery: this is bookkeeping alongside the
 * real work, and a mail that was actually sent must not be reported as failed
 * because a status write lost a race.
 */
export async function recordSendOutcome(outcome: {
  dailyQuotaUsed?: number;
  pause?: PauseKind;
  errorName?: string;
}): Promise<void> {
  const now = Date.now();
  const updates: Record<string, unknown> = { updatedAt: Timestamp.fromMillis(now) };

  if (outcome.pause) {
    updates.unavailableUntil = Timestamp.fromMillis(pauseUntil(outcome.pause, now));
    updates.reason = outcome.errorName ?? outcome.pause;
    if (outcome.pause === "daily-quota") {
      // Pin the counter at the limit. Without this a stale, lower reading from
      // earlier in the day would keep saying the reserve is untouched.
      //
      // ONLY for the daily cap. A monthly exhaustion says nothing about
      // today's counter, and pinning it there would block verification on the
      // reserve rule for a reason that has nothing to do with the reserve --
      // and would go on doing so after the daily counter resets. The monthly
      // pause above already holds everything shut for as long as it needs to.
      updates.dailyQuotaUsed = FREE_PLAN_DAILY_LIMIT;
      updates.dailyQuotaObservedAt = Timestamp.fromMillis(now);
    }
  } else {
    // A send got through, so whatever the breaker believed is now out of date.
    // This is the half-open close: the sweeper probes, and its success is what
    // reopens the realtime path.
    updates.unavailableUntil = null;
    updates.reason = null;
    if (outcome.dailyQuotaUsed !== undefined) {
      const used = usableQuotaReading(outcome.dailyQuotaUsed);
      if (used === null) {
        // Loud, because the alternative is silent: an implausible reading
        // stored here would hold the verification path shut on the reserve
        // rule with nothing in the logs saying why. See the header -- this is
        // what a wrong guess about the header's meaning looks like.
        console.error(
          `mail-availability: refusing an implausible x-resend-daily-quota reading (${outcome.dailyQuotaUsed}); expected 0..${FREE_PLAN_DAILY_LIMIT}. Check what the header actually means before trusting it.`
        );
      } else {
        updates.dailyQuotaUsed = used;
        updates.dailyQuotaObservedAt = Timestamp.fromMillis(now);
      }
    }
  }

  try {
    await statusRef().set(updates, { merge: true });
  } catch (error) {
    console.error(
      "mail-availability: could not record send outcome:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}
