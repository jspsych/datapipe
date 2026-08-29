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
// EVERY DOCUMENT THIS FINDS LEAVES BY A DOOR
// ---------------------------------------------------------------------------
//
// The sweep's queries are unordered `limit()`s, so any document the pass can
// look at without changing is a document it will look at again next pass, and
// forever -- occupying the budget that a deliverable notification needed. So
// the decision table has no permanent "skip" in it. Every outcome either sends
// (leaving SUCCESS or a fresh error), or writes a TERMINAL state that takes the
// document out of both queries. The only skips left are documents that another
// invocation is actively working on, which resolve themselves within LEASE_MS.
//
// Terminal matters for more than starvation. A retryable ERROR is never given
// `delivery.expireAt`, so it sits outside the TTL policy's reach holding a
// researcher's address indefinitely (docs/deploy-contact-email.md §4). Ageing
// one out is how that address finally gets deleted.
//
// ---------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOES NOT SEND
// ---------------------------------------------------------------------------
//
// 1. INLINE MAIL (contact-email verification). Never. A verification code is
//    realtime -- it expires in 24 hours and its recipient is watching a form
//    right now -- so a code delivered an hour late is not a late success, it is
//    a confusing failure. Those are marked terminal at failure time
//    (mail-delivery.ts's isInline), so they should never match the queries
//    here; one that somehow does is aged out rather than skipped, because a
//    skipped one would sit there holding an address forever.
//
// 2. AMBIGUOUS ERRORS, past the idempotency window. mail-delivery.ts makes
//    timeouts retryable ONLY because Resend honours an Idempotency-Key, and it
//    honours it for 24 hours FROM ITS FIRST USE. A sweeper is by nature a late
//    retry -- quota resets daily -- so retrying a maybe-delivered send past
//    that window is a coin flip on a second copy of a notification whose whole
//    value is arriving once. REFUSED_ERRORS (the request was refused, or never
//    reached Resend at all) carry no such risk and are swept at any age;
//    everything else is swept only inside the window.
//
// 3. ANYTHING, while the breaker is shut. If mail-availability.ts says sending
//    is paused, sending would fail every document AND burn one of its three
//    MAX_ATTEMPTS doing it -- so an outage would exhaust the retry budget of
//    every queued mail and turn all of them terminal, which is the precise
//    opposite of this file's purpose. Checking the breaker first is what makes
//    the sweep free to run often. The two passes that are only WRITES --
//    retention and ageing out -- run ahead of that check, because neither
//    spends any quota and both matter most during an outage.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { mailCollection } from "./mail.js";
import {
  deliverMailDocument,
  isInline,
  leaseIsExpired,
  REFUSED_ERRORS,
  MAIL_RETENTION_MS,
  MAX_ATTEMPTS,
} from "./mail-delivery.js";
import { deliveryPaused, readMailStatus } from "./mail-availability.js";
import { extendRetentionForExperiment } from "./upload-retention.js";

// How long Resend honours an Idempotency-Key, measured FROM ITS FIRST USE. The
// bound on retrying anything that is not provably un-sent. Raising this without
// checking Resend's docs would silently reintroduce double-sends.
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Past this, a notification has stopped being worth sending. Three days is
// chosen against what the mail SAYS: "your uploads are failing" is still true
// and still actionable a day or two later, but a researcher who has not noticed
// in three days is better served by the dashboard than by an email about a
// failure episode that has probably long since drained.
export const MAX_SWEEP_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// One pass' budget, per query. Small on purpose: the steady state is zero
// documents, the bad case is a quota outage that queued a few dozen, and a
// sweep that tried to drain hundreds would run into Resend's per-second rate
// limit and convert a recoverable backlog into a burned retry budget.
export const SWEEP_LIMIT = 25;

// What a document that was abandoned mid-send is recorded as. It has no error
// of its own -- the claim cleared the previous one -- and "we do not know what
// happened to this" is worth saying out loud in the audit trail rather than
// leaving a terminal document with an empty `error`.
export const SWEEP_ABANDONED_ERROR = "MailSweepAbandoned";

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
 *
 * "age-out" means TERMINAL: stop trying, and let the TTL have the address.
 * "skip" is reserved for documents that are somebody else's right now.
 */
export function sweepDecision(
  data: FirebaseFirestore.DocumentData,
  nowMs: number
): "deliver" | "age-out" | "skip" {
  const delivery = (data.delivery ?? {}) as Record<string, unknown>;

  if (delivery.state === "PROCESSING") {
    // Someone holds the claim and may be inside the send right now. Same rule
    // as claimDecision's, and deliberately the same function: see leaseIsExpired.
    if (!leaseIsExpired(delivery, nowMs)) return "skip";
    // Lease expired: the claimant is provably dead (mail-delivery.ts's
    // LEASE_MS). Nothing else would ever look at this document again -- the
    // claim rewrote it to PROCESSING with retryable null, which is outside the
    // retryable-ERROR query that used to be the only one here, and outside the
    // TTL too. That is how a preempted instance or a mid-deploy roll used to
    // strand a researcher's address permanently.
  } else if (delivery.state !== "ERROR" || delivery.retryable !== true) {
    return "skip";
  }

  // Inline mail is realtime and nothing may re-send it late (see the header).
  // Terminal rather than skipped: a verification code that failed is finished
  // work, and leaving it "retryable" keeps expireAt off the document.
  if (isInline(data)) return "age-out";

  // Out of attempts. mail-delivery.ts marks these terminal itself, so this is
  // for the document it never got to write -- and without it, deliverMailDocument
  // would answer "skipped-attempts-exhausted" on every pass forever.
  const attempts = delivery.attempts;
  if (typeof attempts === "number" && attempts >= MAX_ATTEMPTS) return "age-out";

  // TWO CLOCKS, AND THEY MEASURE DIFFERENT THINGS.
  //
  //   startTime    when delivery FIRST began, and therefore when this
  //                document's Idempotency-Key (its own id) was first used.
  //                Never moves. This is what the 24-hour window is measured
  //                from -- measuring it from the last attempt slides the
  //                window forward with every retry, so a document retried at
  //                +20h and again at +40h would be sent on a key that expired
  //                at +24h, and Resend would treat it as a new message.
  //   lastAttemptAt when anything last happened. Age-out is measured from
  //                this, so a mail that has been retried into this morning is
  //                young however long ago it was first written.
  const startedAt = millisOrZero(delivery.startTime);
  const lastAttempt = millisOrZero(delivery.lastAttemptAt);

  // A document with neither is undatable, and an undatable document must not
  // become immortal by lacking a field: with no clock to measure, there is no
  // age at which it would ever age out, and it would hold its address forever.
  if (startedAt === 0 && lastAttempt === 0) return "age-out";

  if (nowMs - Math.max(startedAt, lastAttempt) > MAX_SWEEP_AGE_MS) return "age-out";

  // Provably un-sent: retry at any age, because there is no message to
  // duplicate and so nothing for the Idempotency-Key to do.
  const name = (delivery.error as { name?: unknown } | undefined)?.name;
  if (typeof name === "string" && REFUSED_ERRORS.has(name)) return "deliver";

  // Everything else -- a 5xx that may or may not have been accepted, an error
  // this deploy has no name for, or a claim abandoned mid-send -- is ambiguous,
  // and ambiguity is exactly what the Idempotency-Key resolves. Inside the
  // window a retry is a no-op at Resend; outside it, the key has expired and a
  // retry is a coin flip on a second copy, so we stop rather than gamble.
  if (nowMs - (startedAt || lastAttempt) <= IDEMPOTENCY_WINDOW_MS) return "deliver";
  return "age-out";
}

/**
 * The experiment whose data this notification is about, if it is about any.
 *
 * Verification codes have no data behind them to keep.
 */
function retentionTargetOf(mailData: FirebaseFirestore.DocumentData): string | null {
  const meta = (mailData.datapipe ?? {}) as Record<string, unknown>;
  if (meta.kind !== "upload-failure") return null;
  return typeof meta.experimentID === "string" ? meta.experimentID : null;
}

/** The terminal write. Takes the document out of both sweep queries. */
function ageOutUpdates(
  data: FirebaseFirestore.DocumentData,
  nowMs: number
): Record<string, unknown> {
  const delivery = (data.delivery ?? {}) as Record<string, unknown>;
  const at = Timestamp.fromMillis(nowMs);
  const updates: Record<string, unknown> = {
    // ERROR and not PROCESSING, so a document abandoned mid-send cannot be
    // matched by the stranded-claim query again next pass.
    "delivery.state": "ERROR",
    "delivery.retryable": false,
    "delivery.leaseExpiresAt": null,
    "delivery.endTime": at,
    // The field the TTL policy keys on. Writing it is the whole point of
    // ageing out rather than skipping.
    "delivery.expireAt": Timestamp.fromMillis(nowMs + MAIL_RETENTION_MS),
  };
  // Never overwrite a real failure with a generic one: the recorded error is
  // usually the only account of why this mail never arrived.
  if (!delivery.error || typeof delivery.error !== "object") {
    updates["delivery.error"] = {
      name: SWEEP_ABANDONED_ERROR,
      message: "Delivery was abandoned in flight and could not safely be retried.",
    };
  }
  return updates;
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

  // TWO QUERIES, BECAUSE THERE ARE TWO WAYS TO BE STUCK.
  //
  // The first is a failure nobody retried. The second is a claim nobody
  // finished: deliverMailDocument's claim transaction rewrites the document to
  // PROCESSING with `retryable: null` BEFORE the send, so an instance that dies
  // in the send leaves a document that the retryable-ERROR query cannot see and
  // the TTL cannot reap. claimDecision already knows how to recover an expired
  // lease; until now, nothing ever asked it to.
  const [failed, stranded] = await Promise.all([
    mailCollection()
      .where("delivery.state", "==", "ERROR")
      .where("delivery.retryable", "==", true)
      .limit(SWEEP_LIMIT)
      .get(),
    mailCollection()
      .where("delivery.state", "==", "PROCESSING")
      .where("delivery.leaseExpiresAt", "<=", Timestamp.fromMillis(nowMs))
      .limit(SWEEP_LIMIT)
      .get(),
  ]);

  const docs = [...failed.docs, ...stranded.docs];
  report.scanned = docs.length;

  // Decided once, so the retention pass, the age-out pass and the send pass
  // cannot disagree about which documents are still live.
  const decisions = docs.map((doc) => [doc, sweepDecision(doc.data(), nowMs)] as const);

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
  //
  // It covers the documents about to be AGED OUT as well as the ones about to
  // be sent, and that is the more important half: giving up on a notification
  // is the case where the researcher will never be told at all, and it must not
  // also be the moment their data quietly goes back on the original clock. The
  // 14-day ceiling in upload-retention.ts is what bounds this.
  //
  // Once per EXPERIMENT, not once per document: two failure episodes for the
  // same experiment produce two mail documents, and running the same query and
  // the same batch twice in one pass would double the writes and double-count
  // them in the report.
  //
  // Concurrently, because the experiments are disjoint: each call is its own
  // query and its own batch over a different experiment's entries, so awaiting
  // them one after another only adds round-trips to a scheduled pass.
  const extended = new Set<string>();
  for (const [doc, decision] of decisions) {
    if (decision === "skip") continue;
    const experimentID = retentionTargetOf(doc.data());
    if (experimentID) extended.add(experimentID);
  }
  await Promise.all(
    [...extended].map(async (experimentID) => {
      try {
        report.retained += await extendRetentionForExperiment(experimentID, nowMs);
      } catch (error) {
        // Never fatal, and per experiment: failing to extend one costs that
        // researcher time, but throwing would cost every other one the sweep.
        console.error(
          `scheduled-mail-retry: could not extend retention for ${experimentID}:`,
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    })
  );

  // -------------------------------------------------------------------------
  // AGE-OUT, ALSO BEFORE THE BREAKER, AND FOR THE SAME REASON.
  // -------------------------------------------------------------------------
  //
  // Giving up is a write, not a send. Leaving it behind the breaker would mean
  // a month-long monthly-quota outage held every abandoned document -- and the
  // researcher address in each one -- for the whole outage, which is the exact
  // retention hole this pass exists to close.
  //
  // Concurrently: these are independent single-document writes, and a backlog
  // that has just aged out can be the whole of both queries -- fifty serialized
  // round-trips for writes that have nothing to say to each other. Each keeps
  // its own error handling rather than becoming one batch, because a batch is
  // atomic and one vanished document would take the other forty-nine with it.
  await Promise.all(
    decisions
      .filter(([, decision]) => decision === "age-out")
      .map(async ([doc]) => {
        try {
          await doc.ref.update(ageOutUpdates(doc.data(), nowMs));
          report.agedOut += 1;
          console.log(
            `scheduled-mail-retry: ${doc.id} aged out undelivered, marked terminal`
          );
        } catch (error) {
          // Not fatal, and the likeliest cause is benign: purge-user-data.ts
          // deleting the researcher's mail out from under the pass, which is an
          // expected event rather than a fault. Throwing here would cost the
          // rest of the sweep -- including deliveries -- for a document that no
          // longer needs anything done to it.
          console.error(
            `scheduled-mail-retry: could not age out ${doc.id}:`,
            error instanceof Error ? error.message : "Unknown error"
          );
        }
      })
  );

  // The breaker. See the header: sending into a shut breaker fails every
  // document and spends a MAX_ATTEMPTS on each failure.
  const status = await readMailStatus();
  if (deliveryPaused(status, nowMs)) {
    report.paused = true;
    report.skipped += decisions.filter(([, d]) => d === "skip").length;
    console.log(
      "scheduled-mail-retry: delivery is paused, sending nothing this pass"
    );
    return report;
  }

  for (const [doc, decision] of decisions) {
    if (decision !== "deliver") {
      if (decision === "skip") report.skipped += 1;
      continue;
    }

    const outcome = await deliverMailDocument(doc.id);
    if (outcome === "sent") {
      report.delivered += 1;
    } else {
      report.failed += 1;
    }
    console.log(`scheduled-mail-retry: ${doc.id} -> ${outcome}`);

    // A failure mid-sweep may mean the rest of this pass would fail too, and
    // each failure costs a retry attempt. deliverMailDocument has already
    // tripped the breaker if the cause was one that shuts it; honour that
    // immediately rather than after 24 more wasted attempts.
    if (outcome === "retryable-error" || outcome === "terminal-error") {
      const fresh = await readMailStatus();
      if (deliveryPaused(fresh, nowMs)) {
        report.paused = true;
        console.log(
          "scheduled-mail-retry: sending was paused mid-sweep, stopping this pass"
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

// Every 10 minutes. Cheap by construction: the steady state is two indexed
// queries returning nothing, and a shut breaker still costs only those two plus
// one document read.
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
