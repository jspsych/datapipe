// Re-drive mail that failed for a reason that has since stopped being true.
//
// ---------------------------------------------------------------------------
// THE GAP THIS CLOSES
// ---------------------------------------------------------------------------
//
// mail-delivery.ts's onDocumentCreated trigger does not re-fire when a document
// is UPDATED, so a `retryable` ERROR was, until this file existed, retried by
// nobody. It sat marked "still deliverable" forever and nothing ever delivered
// it.
//
// That is worse than it sounds, because of what happens upstream.
// upload-failure-notify.ts writes `uploadFailure.notifiedAt` in the SAME
// transaction that enqueues the mail, and `lastNotifiedAt` is a 24-hour floor
// ACROSS episodes. So a mail that dies on quota leaves an episode armed as "we
// told them": the researcher is never told their data stopped arriving, nothing
// re-notifies, and the experiment document positively asserts that they were
// informed. The only dissent is a mail document nobody reads.
//
// ---------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOES NOT SWEEP
// ---------------------------------------------------------------------------
//
// 1. INLINE MAIL (contact-email verification). Never. A verification code is
//    realtime -- it expires in 24 hours and its recipient is watching a form
//    right now -- so a code delivered an hour late is not a late success, it is
//    a confusing failure. Those are marked terminal at failure time
//    (mail-delivery.ts's isInline), so they should never match the query here;
//    the explicit skip below is belt and braces.
//
// 2. AMBIGUOUS ERRORS, past the idempotency window. mail-delivery.ts makes
//    timeouts retryable ONLY because Resend honours an Idempotency-Key, and it
//    honours it for 24 hours. A sweeper is by nature a late retry -- quota
//    resets daily -- so retrying a maybe-delivered send past that window is a
//    coin flip on a second copy of a notification whose whole value is arriving
//    once. REFUSED_ERRORS (the request was refused, or never reached Resend at
//    all) carry no such risk and are swept at any age; everything else is swept
//    only inside the window.
//
// 3. ANYTHING, while the breaker is shut. If mail-availability.ts says the
//    quota is exhausted, sweeping would fail every document AND burn one of its
//    three MAX_ATTEMPTS doing it -- so a day-long outage would exhaust the
//    retry budget of every queued mail and turn all of them terminal, which is
//    the precise opposite of this file's purpose. Checking the breaker first is
//    what makes the sweep free to run often.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./app.js";
import { MAIL_COLLECTION } from "./mail.js";
import {
  deliverMailDocument,
  isInline,
  REFUSED_ERRORS,
  MAIL_RETENTION_MS,
} from "./mail-delivery.js";
import { deliveryPaused, readMailStatus } from "./mail-availability.js";
import { UNRESOLVED_STATUSES } from "./upload-failure-notify.js";

// How long Resend honours an Idempotency-Key. The bound on retrying anything
// that is not provably un-sent. Raising this without checking Resend's docs
// would silently reintroduce double-sends.
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Past this, a notification has stopped being worth sending. Three days is
// chosen against what the mail SAYS: "your uploads are failing" is still true
// and still actionable a day or two later, but a researcher who has not noticed
// in three days is better served by the dashboard than by an email about a
// failure episode that has probably long since drained.
//
// Reaching it is TERMINAL, not a skip, and that matters for more than tidiness:
// a retryable ERROR is never given delivery.expireAt, so it sits outside the
// TTL policy's reach holding a researcher's address indefinitely. Ageing these
// out is what closes that hole (docs/deploy-contact-email.md §4).
export const MAX_SWEEP_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// One pass' budget. Small on purpose: the steady state is zero documents, the
// bad case is a quota outage that queued a few dozen, and a sweep that tried to
// drain hundreds would run into Resend's per-second rate limit and convert a
// recoverable backlog into a burned retry budget.
export const SWEEP_LIMIT = 25;

// How much longer a researcher's unuploaded data is kept while the
// notification about it is still undelivered.
//
// Seven days is not arbitrary: it is the SAME window the researcher would have
// had if the notification had worked. scheduled-upload-retry.ts's sweep counts
// from `createdAt` -- submission -- so by the time a notification fails, part
// of that window is already spent on a problem the researcher could not have
// known about. This gives it back, and keeps giving it back until they are
// actually told. The absolute ceiling lives in scheduled-upload-retry.ts's
// ABSOLUTE_MAX_RETENTION_MS, where the deletion happens, so there is exactly
// one place that can decide data is gone.
export const RETENTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// Unresolved entries touched per undelivered notification. An episode is
// usually a handful of files; the cap is there so one pathological experiment
// cannot make a sweep unbounded.
export const RETENTION_BATCH = 100;

export interface SweepReport {
  scanned: number;
  delivered: number;
  failed: number;
  skipped: number;
  agedOut: number;
  paused: boolean;
  // Queue entries whose deletion was pushed back because the researcher has
  // not been told about them yet.
  retained: number;
}

function millisOrZero(value: unknown): number {
  if (!value || typeof (value as { toMillis?: unknown }).toMillis !== "function") {
    return 0;
  }
  return (value as { toMillis: () => number }).toMillis();
}

/**
 * May this document be retried right now?
 *
 * Pure, and exported for it -- this predicate is the entire safety argument of
 * the file, and it should be assertable as a table rather than provoked through
 * Firestore and a mail transport.
 */
export function sweepDecision(
  data: FirebaseFirestore.DocumentData,
  nowMs: number
): "deliver" | "age-out" | "skip" {
  if (isInline(data)) return "skip";

  const delivery = (data.delivery ?? {}) as Record<string, unknown>;
  if (delivery.state !== "ERROR" || delivery.retryable !== true) return "skip";

  // Age is measured from the last ATTEMPT, not from when the document was
  // queued: a mail that has been retried into this morning is young, however
  // long ago it was first written. startTime is the fallback for documents
  // written before lastAttemptAt existed.
  const lastAttempt =
    millisOrZero(delivery.lastAttemptAt) || millisOrZero(delivery.startTime);
  if (lastAttempt > 0 && nowMs - lastAttempt > MAX_SWEEP_AGE_MS) return "age-out";

  const name = (delivery.error as { name?: unknown } | undefined)?.name;
  if (typeof name !== "string") return "skip";

  // Provably un-sent: retry at any age.
  if (REFUSED_ERRORS.has(name)) return "deliver";

  // Everything else (a 5xx that may or may not have been accepted) only inside
  // the window where the Idempotency-Key still deduplicates it.
  if (lastAttempt > 0 && nowMs - lastAttempt <= IDEMPOTENCY_WINDOW_MS) return "deliver";

  return "skip";
}

/**
 * Hold back the data an undelivered notification is ABOUT.
 *
 * The notification is per EPISODE, and an episode belongs to an experiment, not
 * to one file -- `datapipe.queueDocId` merely records the entry that tripped
 * it. So the extension has to cover every unresolved entry for the experiment;
 * extending only the one that tripped it would leave the other nineteen failed
 * files in the same episode expiring on schedule, which is the original bug in
 * miniature.
 *
 * Returns how many entries were held back.
 */
async function extendRetentionFor(
  mailData: FirebaseFirestore.DocumentData,
  nowMs: number
): Promise<number> {
  const meta = (mailData.datapipe ?? {}) as Record<string, unknown>;
  // Verification codes have no data behind them to keep.
  if (meta.kind !== "upload-failure") return 0;
  const experimentID = typeof meta.experimentID === "string" ? meta.experimentID : null;
  if (!experimentID) return 0;

  // `experimentID ==` plus `status in` is served as a prefix by the existing
  // (experimentID, status, providerErrorCode) composite -- the same shape
  // upload-failure-notify.ts's drain query already runs.
  const entries = await db
    .collection("uploadQueue")
    .where("experimentID", "==", experimentID)
    .where("status", "in", UNRESOLVED_STATUSES)
    .limit(RETENTION_BATCH)
    .get();
  if (entries.empty) return 0;

  const retainUntil = Timestamp.fromMillis(nowMs + RETENTION_GRACE_MS);
  const batch = db.batch();
  for (const entry of entries.docs) {
    batch.update(entry.ref, { retainUntil });
  }
  await batch.commit();
  return entries.size;
}

/**
 * One sweep.
 *
 * Exported as the test seam this codebase already uses for scheduled work
 * (scheduled-upload-retry.ts's retryPendingUploads, scheduled-pending-
 * recovery.ts's recoverPendingUploads): tests drive it in-process rather than
 * trying to provoke a real scheduler tick out of the emulator.
 */
export async function sweepRetryableMail(nowMs = Date.now()): Promise<SweepReport> {
  const report: SweepReport = {
    scanned: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
    agedOut: 0,
    paused: false,
    retained: 0,
  };

  const snap = await db
    .collection(MAIL_COLLECTION)
    .where("delivery.state", "==", "ERROR")
    .where("delivery.retryable", "==", true)
    .limit(SWEEP_LIMIT)
    .get();

  report.scanned = snap.size;

  // Decided once, so the retention pass and the send pass cannot disagree
  // about which documents are still live.
  const decisions = snap.docs.map(
    (doc) => [doc, sweepDecision(doc.data(), nowMs)] as const
  );

  // -------------------------------------------------------------------------
  // RETENTION FIRST, AND DELIBERATELY BEFORE THE BREAKER.
  // -------------------------------------------------------------------------
  //
  // Holding a queue entry back is a Firestore write, not a send: it costs no
  // quota, so nothing about an exhausted quota is a reason to skip it. The
  // opposite, in fact -- a quota outage is precisely when a researcher's data
  // is quietly ageing towards deletion behind a notification that never
  // arrived. Putting this after the breaker check would switch the protection
  // off in the only situation that needs it.
  for (const [doc, decision] of decisions) {
    if (decision !== "deliver") continue;
    try {
      report.retained += await extendRetentionFor(doc.data(), nowMs);
    } catch (error) {
      // Never fatal. Failing to extend costs the researcher time, but throwing
      // here would cost them the sweep as well.
      console.error(
        `scheduled-mail-retry: could not extend retention for ${doc.id}:`,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  // The breaker. See the header: sweeping into an exhausted quota fails every
  // document and spends a MAX_ATTEMPTS on each failure.
  const status = await readMailStatus();
  if (deliveryPaused(status, nowMs)) {
    report.paused = true;
    console.log(
      "scheduled-mail-retry: delivery is paused (quota), sending nothing this pass"
    );
    return report;
  }

  for (const [doc, decision] of decisions) {
    if (decision === "skip") {
      report.skipped += 1;
      continue;
    }

    if (decision === "age-out") {
      // Terminal, so delivery.expireAt is written and the TTL can finally reap
      // the address this document has been holding.
      await doc.ref.update({
        "delivery.retryable": false,
        "delivery.endTime": Timestamp.fromMillis(nowMs),
        "delivery.expireAt": Timestamp.fromMillis(nowMs + MAIL_RETENTION_MS),
      });
      report.agedOut += 1;
      console.log(
        `scheduled-mail-retry: ${doc.id} aged out undelivered, marked terminal`
      );
      continue;
    }

    const outcome = await deliverMailDocument(doc.id);
    if (outcome === "sent") {
      report.delivered += 1;
    } else {
      report.failed += 1;
    }
    console.log(`scheduled-mail-retry: ${doc.id} -> ${outcome}`);

    // A quota failure mid-sweep means the rest of this pass would fail too, and
    // each failure costs a retry attempt. deliverMailDocument has already
    // tripped the breaker; honour it immediately rather than after 24 more
    // wasted attempts.
    if (outcome === "retryable-error" || outcome === "terminal-error") {
      const fresh = await readMailStatus();
      if (deliveryPaused(fresh, nowMs)) {
        report.paused = true;
        console.log(
          "scheduled-mail-retry: quota tripped mid-sweep, stopping this pass"
        );
        break;
      }
    }
  }

  // A delivery during this pass already cleared the breaker via
  // recordSendOutcome. Nothing to do here -- stated so nobody adds a redundant
  // clear that would reopen the realtime path on a pass that sent nothing.
  return report;
}

// Every 10 minutes. Cheap by construction: the steady state is one indexed
// query returning nothing, and a shut breaker makes it one document read.
//
// No `retry` config. A failed sweep is a logged line and the next pass tries
// again ten minutes later, which is what a sweeper is for -- replaying a failed
// sweep would stack passes on top of each other for no benefit.
export const scheduledMailRetry = onSchedule(
  { schedule: "*/10 * * * *", memory: "256MiB" },
  async () => {
    const report = await sweepRetryableMail();
    if (report.scanned > 0 || report.paused) {
      console.log(`scheduled-mail-retry: ${JSON.stringify(report)}`);
    }
  }
);
