// First-failure upload notification: tell a researcher ONCE when their data
// stops arriving, and not again until the problem clears.
//
// The whole feature is an exercise in not crying wolf. One participant
// submission can produce a raw file, a main CSV and one sidecar per extracted
// column (metadata-derived-upload.ts), so "twenty files failed" is a routine
// event, not an exotic one -- and a naive implementation mails twenty times.
// Worse, several of the failures DataPipe records are not failures at all:
// compaction diverts writes into the queue on purpose (compaction-gate.ts),
// and CONTENTION/AUTH_EXPIRED blips heal themselves within a minute
// (queue-upload.ts's fast and probe tiers). A researcher who learns that these
// mails are usually noise stops reading the one that isn't.
//
// So: one mail per EPISODE, an episode opens only at a failure DataPipe has
// already tried and failed to fix, and it closes when the experiment's queue
// drains. A 24-hour floor backstops a queue that flaps.
//
// ---------------------------------------------------------------------------
// WHY A DEDICATED TRIGGER, AND NOT THE OTHER TWO OBVIOUS PLACES
// ---------------------------------------------------------------------------
//
// Not a hook inside queueUpload: scheduled-pending-recovery.ts writes
// uploadQueue documents by hand in its own transaction and never calls it, and
// the signal that actually matters -- handleRetryFailure in
// scheduled-upload-retry.ts -- is not in that path at all. A Firestore trigger
// sees every writer, including writers not yet written.
//
// Not folded into onUploadQueueChanged (compaction-triggers.ts), even though
// it watches the exact same collection path. That function's runtime and
// throw semantics belong to COMPACTION: it runs at 1GiB/540s because a pass
// holds a batch and an assembled zip in memory, and anything it throws is a
// compaction failure. Enqueuing mail there would mean a mail-write error
// re-runs a compaction pass, and a compaction error suppresses a
// notification -- two unrelated concerns sharing one retry envelope. Separate
// concerns, separate functions, 256MiB here because this one reads two
// documents and writes two.
//
// Firestore triggers are at-least-once, so the same event can arrive twice.
// That is harmless by construction: the second delivery finds notifiedAt
// already set and takes the count-only branch. It cannot produce a second
// mail.

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db } from "./app.js";
import { contactEmailRecipient, enqueueMail, newMailRef } from "./mail.js";
import type { MailMeta } from "./mail.js";
import { buildUploadFailureEmail } from "./email/upload-failure-copy.js";
import type { UploadFailureState } from "./interfaces.js";
import { unresolvedQueueEntriesQuery } from "./upload-retention.js";

// One mail per experiment per 24 hours, maximum, no matter how often the queue
// flaps clear->fail. A study that breaks every hour for a week produces seven
// mails, not 168. This is also the backstop for the one residual race the
// transactions below cannot close -- see clearIfDrained.
export const RATE_LIMIT_MS = 24 * 60 * 60 * 1000;

// The Admin SDK default is 5, which is not enough here. The motivating case is
// the ordinary one: a metadataActive submission produces a raw file, a main
// CSV and one sidecar per extracted column, so a single participant can put
// ~20 entries in the queue, and when the provider is down the retry worker
// fails all of them in one run -- firing ~20 trigger invocations that contend
// for the SAME experiments/{id} document at once. Each loser re-runs, and in
// the worst ordering a transaction needs about one attempt per contender. At
// the default it would give up and throw, which on a notification path means
// silently losing the mail. Attempts are cheap; the failure is not.
const TRANSACTION_ATTEMPTS = 25;

type QueueData = FirebaseFirestore.DocumentData | undefined;

// Wider than the sketch in the plan ("mailed" | "cleared" | "noop") on
// purpose: the suppressed branches are the ones most likely to break silently,
// and a test that can only see "not mailed" cannot tell a rate-limited
// suppression from a missing contact address from a predicate that never
// fired.
export type QueueWriteOutcome =
  | "mailed"
  | "counted"
  | "rate-limited"
  | "no-contact-email"
  | "cleared"
  | "noop";

/**
 * Has DataPipe already tried and failed on this file?
 *
 * Decided from the event payload alone, with zero Firestore reads, so the
 * overwhelming majority of queue writes cost nothing.
 *
 * THE QUEUE-TIME CASE IS EXCLUDED DELIBERATELY, and it is the point of the
 * whole predicate:
 *
 *  - Compaction would false-alarm on every pass. api-data.ts diverts
 *    submissions into the queue whenever isCompactionInFlight, and the retry
 *    worker then reschedules those entries WITHOUT incrementing retryCount
 *    (scheduled-upload-retry.ts's COMPACTION_HOLD_REASON branch). Keying on
 *    retryCount makes a write buffer invisible here -- the retry worker
 *    already draws exactly the line this needs.
 *
 *  - The fast and probe tiers exist because these failures self-heal.
 *    CONTENTION clears in seconds; an AUTH_EXPIRED on Zenodo is often a token
 *    a concurrent refresh rotated away moments ago. Mailing before the
 *    60-second probe has run tells researchers to go check on something that
 *    fixed itself before they opened the mail.
 *
 * The cost is a delay, and it is small against the alternative: fast/probe
 * tier means the mail lands ~5 minutes after the failure (the 60-second
 * nextRetryAt floor, plus the retry worker's five-minute cron cadence), slow
 * tier ~1 hour. The job is to get someone to check in, not to page them.
 */
export function isFailureEvent(before: QueueData, after: QueueData): boolean {
  // Fires on EVERY retry increment, not only the first. That is intended: the
  // notifiedAt flag, not this predicate, is what makes the mail singular, and
  // a later increment on an already-open episode is a genuine additional
  // failure worth counting.
  const attemptFailed =
    after?.status === "pending" && (after.retryCount ?? 0) > (before?.retryCount ?? 0);

  // The five paths that never take a retry: owner missing, experiment missing,
  // experiment finalized while queued, unreadable payload (all four write
  // `failed` directly with retryCount untouched), plus max-retries exhaustion.
  const wentTerminal = after?.status === "failed" && before?.status !== "failed";

  return attemptFailed || wentTerminal;
}

/**
 * Did an entry just leave the unresolved set?
 *
 * A completion, or a DELETE. The delete case is load-bearing and is the trap
 * this function exists to avoid: cleanupOldEntries removes queue documents
 * outright, so `after` is undefined, and compaction-triggers.ts's sibling
 * trigger returns early on exactly that condition. Here, a delete can be the
 * very event that drains the queue -- the last `failed` entry aging out at
 * seven days is the normal way a dead episode ends.
 */
export function isDrainCandidate(before: QueueData, after: QueueData): boolean {
  if (!after) {
    return !!before;
  }
  return after.status === "completed" && before?.status !== "completed";
}

// Is there an open episode at all? Cheap guard used twice: once outside the
// drain transaction to avoid opening one at all, and once inside it as the
// authoritative check.
function hasEpisodeToClear(state: UploadFailureState | undefined): boolean {
  if (!state) return false;
  return (
    state.notifiedAt != null ||
    state.firstFailureAt != null ||
    state.suppressedReason != null ||
    (state.failureCount ?? 0) > 0
  );
}

// Defensive read of a stored Timestamp, in the same spirit as
// compaction-gate.ts's typeof guard: a hand-edited or future-written value
// that is not a Timestamp must not throw inside a transaction and turn every
// subsequent failure on this experiment into an unhandled error.
function millisOrZero(value: FirebaseFirestore.Timestamp | null | undefined): number {
  if (!value || typeof (value as { toMillis?: unknown }).toMillis !== "function") {
    return 0;
  }
  return value.toMillis();
}

/**
 * FAILURE PATH. Opens an episode, or counts against an open one.
 *
 * Everything happens in ONE transaction on experiments/{id}: the read of the
 * experiment, the read of the owner, the flag write, and the tx.create of the
 * mail document. That is what makes twenty simultaneous failures produce
 * exactly one mail -- Firestore transactions are serializable, so nineteen of
 * them lose, re-run, re-read notifiedAt as non-null, and take the count-only
 * branch. Because the mail is created in the same commit as the flag, there is
 * no window in which a researcher is mailed but the "already told them" flag
 * is lost, which would mail them again on the very next file.
 */
async function notifyFailure(
  experimentID: string,
  queueData: FirebaseFirestore.DocumentData,
  docId: string
): Promise<QueueWriteOutcome> {
  const owner = typeof queueData.owner === "string" ? queueData.owner : undefined;
  const experimentRef = db.collection("experiments").doc(experimentID);
  const userRef = owner ? db.collection("users").doc(owner) : null;

  // Allocated BEFORE the transaction body: a transaction cannot allocate a
  // document id mid-flight (see newMailRef in mail.ts). Reusing the same ref
  // across transaction retries is safe precisely because a retried attempt
  // never committed, so the ref is still unwritten and tx.create still holds.
  const mailRef = newMailRef();

  return db.runTransaction<QueueWriteOutcome>(async (tx) => {
    // ---------------- ALL READS FIRST (Firestore transaction law) ----------
    const expSnap = await tx.get(experimentRef);
    const userSnap = userRef ? await tx.get(userRef) : null;
    // ---------------- NO READS BELOW THIS LINE -----------------------------

    // The experiment is gone -- which is one of the terminal failure paths
    // that got us here in the first place ("Experiment not found"). Writing
    // anything now would CREATE the document: a ghost experiment carrying
    // nothing but uploadFailure, visible to the dashboard's queries. Say
    // nothing instead; there is no experiment page to send anyone to.
    if (!expSnap.exists) {
      return "noop";
    }

    const expData = expSnap.data() ?? {};
    const state = (expData.uploadFailure ?? {}) as UploadFailureState;
    const now = Timestamp.now();

    // `any` rather than `unknown`: this object is handed to tx.update, whose
    // UpdateData<DocumentData> type resolves to an index signature of `any`,
    // and it holds a mix of Timestamps, nulls and a FieldValue transform.
    const updates: Record<string, any> = {
      // A field transform, so concurrent counters do not clobber each other
      // even across the retry boundary.
      "uploadFailure.failureCount": FieldValue.increment(1),
    };
    if (state.firstFailureAt == null) {
      updates["uploadFailure.firstFailureAt"] = now;
    }

    // ARMED already: the researcher has been told about this episode (or the
    // episode was armed to suppress a burst). Count and stop.
    if (state.notifiedAt != null) {
      tx.update(experimentRef, updates);
      return "counted";
    }

    // From here on the episode is opening, so notifiedAt is set on EVERY
    // branch below including the ones that send nothing. Suppressing the burst
    // matters as much as suppressing the duplicate mail: without the flag,
    // twenty derived-file failures each open a transaction and each re-decide.
    updates["uploadFailure.notifiedAt"] = now;

    // lastNotifiedAt survives the drain, so this is a floor across episodes,
    // not within one.
    if (now.toMillis() - millisOrZero(state.lastNotifiedAt) < RATE_LIMIT_MS) {
      updates["uploadFailure.suppressedReason"] = "rate-limited";
      tx.update(experimentRef, updates);
      return "rate-limited";
    }

    const recipient = contactEmailRecipient(
      userSnap && userSnap.exists ? userSnap.data() : undefined
    );
    if (!recipient || !owner) {
      // Feature 1's contact-email gate closes this population over time. Until
      // then the episode is armed and the reason recorded, so the owner can
      // see in Firestore why nothing was sent.
      updates["uploadFailure.suppressedReason"] = "no-contact-email";
      tx.update(experimentRef, updates);
      return "no-contact-email";
    }

    const email = buildUploadFailureEmail({
      experimentID,
      title: expData.title as string | undefined,
      // The queue entry's provider is the one that actually refused the write;
      // the experiment's is the fallback for legacy entries that carry none.
      storageProvider: queueData.storageProvider ?? expData.storageProvider,
      providerErrorCode: queueData.providerErrorCode,
      // The count this failure produces. Normally 1 -- this branch only runs
      // when the episode was closed -- so the copy renders the burst line only
      // when it is genuinely higher.
      failureCount: (state.failureCount ?? 0) + 1,
    });

    // Built key by key rather than as a literal: Firestore rejects undefined
    // field values, and mail.ts spreads this straight into the document.
    const meta: MailMeta = { kind: "upload-failure", owner, experimentID };
    meta.queueDocId = docId;
    if (queueData.providerErrorCode) {
      meta.providerErrorCode = queueData.providerErrorCode;
    }

    enqueueMail(tx, mailRef, {
      to: recipient,
      subject: email.subject,
      text: email.text,
      html: email.html,
      meta,
    });

    updates["uploadFailure.lastNotifiedAt"] = now;
    updates["uploadFailure.suppressedReason"] = null;
    tx.update(experimentRef, updates);
    return "mailed";
  }, { maxAttempts: TRANSACTION_ATTEMPTS });
}

/**
 * DRAIN PATH. Closes the episode once nothing is left unresolved.
 *
 * Re-arming is the other half of "mail once": without it, an experiment that
 * broke in March would stay silent through a genuinely new failure in April.
 *
 * lastNotifiedAt is deliberately NOT cleared here. It is the flap backstop,
 * and it is also what closes the one race these transactions cannot: a drain
 * whose query ran a moment before a new failure was written can clear a flag
 * that the failure had just armed. The failure's own mail was already sent, so
 * the only cost is that the NEXT failure sees a disarmed flag -- and the
 * 24-hour floor, read from a field the drain never touches, suppresses it.
 */
async function clearIfDrained(experimentID: string): Promise<QueueWriteOutcome> {
  const experimentRef = db.collection("experiments").doc(experimentID);

  // Pre-check outside any transaction. EVERY successful queued upload produces
  // a completed event, and almost none of those experiments have an episode
  // open, so transacting on each would spend a transaction and a query to
  // learn there was nothing to do. This can only skip work, never decide
  // wrongly: the transaction below re-reads the same field authoritatively,
  // and a read that misses an episode armed a moment later is a read for which
  // the queue is necessarily non-empty anyway (that failure's own entry is
  // unresolved), so clearing would have been wrong.
  const preSnap = await experimentRef.get();
  if (!preSnap.exists || !hasEpisodeToClear(preSnap.data()?.uploadFailure)) {
    return "noop";
  }

  // limit(1) rather than count(): a plain query inside a transaction is
  // universally supported by the Admin SDK and the emulator, costs one
  // document read, and answers the only question being asked -- "is anything
  // still unresolved?". The shape, and the composite index it rests on, are
  // upload-retention.ts's -- which owns what "unresolved" means.
  const stillUnresolved = unresolvedQueueEntriesQuery(experimentID).limit(1);

  return db.runTransaction<QueueWriteOutcome>(async (tx) => {
    // ---------------- ALL READS FIRST (Firestore transaction law) ----------
    // The experiment document is read FIRST, and it is read even though the
    // QUERY is what decides. The read is what puts experiments/{id} under this
    // transaction's lock for the rest of its life, which is what serializes a
    // drain against a concurrent failure on the same experiment -- otherwise a
    // transaction that only ever WROTE that document could interleave between
    // a failure's read and its write.
    const expSnap = await tx.get(experimentRef);
    const queued = await tx.get(stillUnresolved);
    // ---------------- NO READS BELOW THIS LINE -----------------------------

    if (!expSnap.exists) {
      return "noop";
    }
    if (!hasEpisodeToClear(expSnap.data()?.uploadFailure as UploadFailureState)) {
      return "noop";
    }
    if (!queued.empty) {
      // Something is still pending, processing, or permanently failed. Not
      // drained -- this is the lingering-dead-file case, and it is why the
      // predicate includes `failed`.
      return "noop";
    }

    tx.update(experimentRef, {
      "uploadFailure.notifiedAt": null,
      "uploadFailure.firstFailureAt": null,
      "uploadFailure.failureCount": 0,
      "uploadFailure.suppressedReason": null,
      // lastNotifiedAt: NEVER cleared. See the doc comment above.
    });
    return "cleared";
  }, { maxAttempts: TRANSACTION_ATTEMPTS });
}

/**
 * The whole state machine, as a plain function.
 *
 * Exported as the test seam this codebase already uses for scheduled work
 * (retryPendingUploads' ownerScope, recoverPendingUploads' prefix): tests drive
 * it in-process with synthesized before/after payloads instead of trying to
 * provoke real trigger deliveries out of the emulator.
 *
 * `before` and `after` are the raw document data from the event -- either may
 * be undefined (a create has no before, a DELETE has no after).
 */
export async function handleQueueWrite(
  before: QueueData,
  after: QueueData,
  docId: string
): Promise<QueueWriteOutcome> {
  // On a delete there is no `after`, so the experiment this entry belonged to
  // has to come from `before`.
  const data = after ?? before;
  const experimentID = typeof data?.experimentID === "string" ? data.experimentID : undefined;
  if (!experimentID) {
    return "noop";
  }

  // Mutually exclusive by construction: a failure event has an `after` whose
  // status is pending or failed, a drain candidate has no `after` at all or a
  // completed one.
  if (isFailureEvent(before, after)) {
    return notifyFailure(experimentID, after as FirebaseFirestore.DocumentData, docId);
  }
  if (isDrainCandidate(before, after)) {
    return clearIfDrained(experimentID);
  }
  return "noop";
}

// 256MiB: this reads two documents and one single-result query, and writes
// two documents. Nothing here holds a payload -- the queue entry's bytes live
// in Cloud Storage, and this function never touches them.
//
// No `retry: true`. An error here is logged and dropped rather than replayed
// for up to seven days, which is the right trade for a notification: the flag
// write and the mail create are one commit, so a failed attempt leaves the
// episode closed, and the NEXT failure on the same experiment re-decides from
// scratch. A replay storm on a notification path would be worse than a missed
// notification.
export const onUploadFailure = onDocumentWritten(
  { document: "uploadQueue/{docId}", memory: "256MiB" },
  async (event) => {
    const outcome = await handleQueueWrite(
      event.data?.before.data(),
      event.data?.after.data(),
      event.params.docId
    );
    if (outcome !== "noop") {
      console.log(`upload-failure-notify: ${event.params.docId} -> ${outcome}`);
    }
  }
);
