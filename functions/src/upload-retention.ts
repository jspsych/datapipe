// Whether a researcher's unuploaded data may be destroyed yet.
//
// Its own module, and a pure function, for two reasons. It decides the least
// reversible thing in this codebase -- deleting research data the researcher
// has not got back -- so it should be assertable as a table rather than
// provoked through a scheduler. And scheduled-upload-retry.ts, where the
// deletion actually happens, imports the whole provider stack; a test that
// wanted only this predicate would have to load all of it.
//
// ---------------------------------------------------------------------------
// WHY THE PLAIN AGE TEST WAS NOT ENOUGH
// ---------------------------------------------------------------------------
//
// The cleanup sweep used to delete on `createdAt <= now - 7d` alone -- no check
// on status, and no check on whether anyone had been told. Two ways that loses
// data nobody meant to lose:
//
//   1. A STORAGE PROVIDER OUTAGE. The entry is still `pending` with retries
//      left, so it would have uploaded fine on day eight. Deleting it on day
//      seven throws away data that was never actually lost.
//
//   2. A NOTIFICATION THAT NEVER ARRIVED. The seven days are counted from
//      SUBMISSION, so part of the window is already spent before anything goes
//      wrong -- and if the notification died (a Resend quota outage, say) the
//      researcher's window closes without them ever learning there was one.
//
// `retainUntil` is written at the bottom of this file, and
// scheduled-mail-retry.ts is what calls it: while an upload-failure
// notification for the experiment is undelivered -- including the pass that
// finally gives up on it, so that abandoning a notification does not also
// quietly shorten the window for the data it was about.
//
// NOTE WHAT DOES NOT WRITE IT. An experiment whose owner has no contact email
// never produces a mail document at all -- upload-failure-notify.ts records
// `suppressedReason: "no-contact-email"` and returns before enqueuing -- so it
// is never extended and keeps the plain seven days. That is the right answer
// when there is nobody to tell, and it falls out of the design rather than
// being special-cased.

import { Timestamp } from "firebase-admin/firestore";
import { db } from "./app.js";

// The ceiling on everything below. An entry is deleted once it reaches this
// age no matter what else is still true about it.
//
// The extensions exist so a researcher gets a fair chance to act on data that
// has not uploaded. This exists so that chance cannot become permanent storage
// of research payloads DataPipe was never able to deliver: an experiment whose
// provider is dead and whose owner never reads their mail would otherwise
// accumulate forever, silently, at DataPipe's cost. Fourteen days is the plain
// seven a researcher was always promised, plus another seven to absorb an
// outage or a missed notification.
export const ABSOLUTE_MAX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function millisOrZero(value: unknown): number {
  if (!value || typeof (value as { toMillis?: unknown }).toMillis !== "function") {
    return 0;
  }
  return (value as { toMillis: () => number }).toMillis();
}

/**
 * Is this aged-out queue entry safe to delete?
 *
 * Only ever asked about entries the sweep has already found by age, so
 * "delete" here means "the seven days are up AND none of the reasons to keep it
 * apply".
 */
export function retentionDecision(
  data: FirebaseFirestore.DocumentData,
  nowMs: number
): "delete" | "retain" {
  const createdAt = millisOrZero(data.createdAt);

  // The ceiling wins over every reason to keep it. Checked FIRST, and checked
  // even when createdAt is missing or unreadable -- an entry must not become
  // immortal by lacking a field.
  if (createdAt === 0 || nowMs - createdAt >= ABSOLUTE_MAX_RETENTION_MS) {
    return "delete";
  }

  // Still live work. The upload itself may yet succeed, which makes this data
  // not merely un-notified but not actually lost. "Pending" alone is not
  // enough: an entry that has spent its whole retry budget is not live work,
  // it is a corpse with a hopeful status.
  const retryCount = typeof data.retryCount === "number" ? data.retryCount : 0;
  const maxRetries = typeof data.maxRetries === "number" ? data.maxRetries : 0;
  if (data.status === "pending" && retryCount < maxRetries) {
    return "retain";
  }

  // The researcher has not been told yet, and still might be.
  if (millisOrZero(data.retainUntil) > nowMs) {
    return "retain";
  }

  return "delete";
}

// ---------------------------------------------------------------------------
// Holding data back while the researcher has not been told about it.
// ---------------------------------------------------------------------------
//
// The WRITE lives here, next to the predicate that reads it, rather than in
// scheduled-mail-retry.ts where it started. The rule "may this data be
// destroyed, and what holds it back" is one decision; splitting it across the
// mail sweeper, this module and the deletion sweep meant three files in two
// subsystems had to be read together to answer a single question, and the mail
// subsystem had to know the uploadQueue's schema to do it.
//
// The mail sweeper now says only the thing it actually knows -- "this
// experiment's researcher has not been told yet" -- and this module decides
// what that means for their data.
//
// WHAT WAS CONSIDERED AND NOT DONE: inverting the dependency completely, so
// that cleanupOldEntries asks "is a notification for this experiment still
// undelivered?" at the moment of deletion and nothing is written ahead of time.
// It is the tidier shape, but it makes the least reversible operation in the
// codebase depend on a query that can fail, and a failing query there deletes
// data. `retainUntil` fails the other way: a write that does not happen costs
// the researcher an extension, not their data.


// "Not resolved yet, from the researcher's point of view." Deliberately the
// predicate the dashboard already uses (pages/admin/[experiment_id].js:46-53
// and api-queue-status.ts:143-144), INCLUDING `failed`, and deliberately not
// finalization.ts's, which excludes `failed` so that a permanently dead file
// cannot block sealing forever.
//
// Including `failed` is what stops the upload-failure notification re-arming
// while a dead file is still sitting there: that file is an unresolved problem
// the researcher has not dealt with, and re-arming would mail them again about
// a queue that never actually got better. The episode closes when the last
// unresolved entry either completes or is swept away by cleanupOldEntries.
export const UNRESOLVED_STATUSES = ["pending", "processing", "failed"];

/**
 * Every uploadQueue entry for one experiment that the researcher would still
 * call unresolved.
 *
 * One builder rather than two, because both callers rest on the same index
 * argument: `experimentID ==` plus `status in` is served as a prefix by the
 * existing (experimentID, status, providerErrorCode) composite. The caller adds
 * its own limit -- upload-failure-notify.ts only asks whether anything is left,
 * this module has to touch all of them.
 */
export function unresolvedQueueEntriesQuery(
  experimentID: string
): FirebaseFirestore.Query {
  return db
    .collection("uploadQueue")
    .where("experimentID", "==", experimentID)
    .where("status", "in", UNRESOLVED_STATUSES);
}

// How much longer a researcher's unuploaded data is kept while the
// notification about it is still undelivered.
//
// Seven days is not arbitrary: it is the SAME window the researcher would have
// had if the notification had worked. scheduled-upload-retry.ts's sweep counts
// from `createdAt` -- submission -- so by the time a notification fails, part
// of that window is already spent on a problem the researcher could not have
// known about. This gives it back, and keeps giving it back until they are
// actually told. The absolute ceiling is ABSOLUTE_MAX_RETENTION_MS above, and
// the deletion itself is scheduled-upload-retry.ts's, so there is exactly one
// place that can decide data is gone.
export const RETENTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// Unresolved entries touched per undelivered notification. An episode is
// usually a handful of files; the cap is there so one pathological experiment
// cannot make a sweep unbounded.
export const RETENTION_BATCH = 100;

// Don't rewrite a `retainUntil` that is already most of the way out.
//
// The extension is driven by the mail sweeper, which runs every ten minutes for
// as long as a notification stays undelivered -- so without this, a day-long
// outage with a couple of dozen queued notifications rewrites the same field
// tens of thousands of times to the same effect. Firestore's free tier is
// 20,000 writes a day. Half the grace window is the threshold because the
// consequence of skipping a write is bounded by it: the stored value cannot be
// closer than RETENTION_GRACE_MS/2 to expiring, which is three and a half days
// of slack on a sweep that runs every ten minutes.
export const RETENTION_REWRITE_FLOOR_MS = RETENTION_GRACE_MS / 2;

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
 * Returns how many entries are being held back (whether or not this call was
 * the one that had to write them).
 */
export async function extendRetentionForExperiment(
  experimentID: string,
  nowMs: number
): Promise<number> {
  const entries = await unresolvedQueueEntriesQuery(experimentID)
    .limit(RETENTION_BATCH)
    .get();
  if (entries.empty) return 0;

  const floor = nowMs + RETENTION_REWRITE_FLOOR_MS;
  const stale = entries.docs.filter(
    (entry) => millisOrZero(entry.get("retainUntil")) < floor
  );
  if (stale.length > 0) {
    const retainUntil = Timestamp.fromMillis(nowMs + RETENTION_GRACE_MS);
    const batch = db.batch();
    for (const entry of stale) {
      batch.update(entry.ref, { retainUntil });
    }
    await batch.commit();
  }
  return entries.size;
}
