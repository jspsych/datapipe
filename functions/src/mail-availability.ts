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

  const used = status?.dailyQuotaUsed;
  const observedAt = millisOrNull(status?.dailyQuotaObservedAt);
  if (
    typeof used === "number" &&
    Number.isFinite(used) &&
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
  quotaExhausted?: boolean;
  errorName?: string;
}): Promise<void> {
  const now = Date.now();
  const updates: Record<string, unknown> = { updatedAt: Timestamp.fromMillis(now) };

  if (outcome.quotaExhausted) {
    updates.unavailableUntil = Timestamp.fromMillis(nextUtcMidnight(now));
    updates.reason = outcome.errorName ?? "quota-exhausted";
    // Pin the counter at the limit. Without this a stale, lower reading from
    // earlier in the day would keep saying the reserve is untouched.
    updates.dailyQuotaUsed = FREE_PLAN_DAILY_LIMIT;
    updates.dailyQuotaObservedAt = Timestamp.fromMillis(now);
  } else {
    // A send got through, so whatever the breaker believed is now out of date.
    // This is the half-open close: the sweeper probes, and its success is what
    // reopens the realtime path.
    updates.unavailableUntil = null;
    updates.reason = null;
    if (typeof outcome.dailyQuotaUsed === "number") {
      updates.dailyQuotaUsed = outcome.dailyQuotaUsed;
      updates.dailyQuotaObservedAt = Timestamp.fromMillis(now);
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
