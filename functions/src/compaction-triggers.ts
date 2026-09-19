// Event-driven discovery for archive compaction (compaction.ts).
//
// THERE IS NO SCHEDULED SWEEP, and that is the design rather than an omission.
// DataPipe is the only writer to these containers in normal operation, so it
// already knows the moment one has grown and never has to ask on a timer. A
// cron would poll idle experiments forever and still react up to a full
// interval late to the one case that matters -- a burst, which can fill a
// record in under a minute.
//
// Every path that can fill a record terminates in a Firestore write we already
// make:
//
//   normal submission      -> `sessions` increments on experiments/{id}
//   retry backlog draining -> uploadQueue/{id} moves to completed
//   record already full    -> uploadQueue/{id} written with QUOTA_EXCEEDED
//
// The one thing that produces no event is a researcher uploading to the
// provider by hand mid-study. That is documented as unsupported (see the FAQ)
// rather than engineered around -- it also desynchronizes the collision cache,
// so a background sweep would not make it safe, only later-detected. Even
// then it is not silent: the next submission that finds the record full writes
// a QUOTA_EXCEEDED queue entry, which is the third row above.
//
// Firestore triggers are at-least-once with retries for up to 7 days, so
// delivery is durable. Duplicate delivery is harmless: compaction takes a
// lease and a second invocation returns "leased-elsewhere".
//
// This trigger itself no longer RUNS a pass -- it only decides whether one is
// worth starting, at 256MiB, and hands off to compaction-task.ts's
// compactionTask (a Cloud Task) the moment it decides yes. That hop is what
// lets the almost-always-early-return path stay cheap: the 1GiB/540s a pass
// actually needs is now paid only by the task, only when a pass is actually
// going to happen. At-least-once-plus-lease is unaffected by the hop --
// duplicate task dispatches are exactly as harmless as duplicate trigger
// deliveries were, for the same reason (the lease).

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { getProvider } from "./providers/index.js";
import { StorageProviderId } from "./providers/types.js";
import { WATERMARK_RATIO } from "./compaction.js";
import { enqueueCompaction } from "./compaction-task.js";

// Deliberately high. It is the per-submission file count the watermark
// estimate assumes, used only to decide whether examining the record is worth
// a listing, and over-estimating means looking too EARLY -- which costs one
// cheap listing. Under-estimating means looking too late, which is how a
// record fills. A metadataActive submission writes a raw file, a main CSV and
// one sidecar per extracted column, so there is no true upper bound to derive.
const ASSUMED_FILES_PER_SUBMISSION = 10;

/**
 * Whether an experiment could plausibly have crossed the compaction watermark,
 * judged without touching the provider.
 *
 * This exists to keep a burst from turning into one provider listing per
 * submission. It is deliberately pessimistic: it estimates the file count
 * high, so it errs toward looking when it need not, never toward skipping when
 * it should look.
 *
 * The estimate cannot be derived from `lastFileCount / sessionsAtLastCheck` --
 * that ratio collapses after a pass, when the file count has been reset to
 * near zero while `sessions` keeps climbing. Hence the flat assumption above.
 */
export function mayHaveCrossedWatermark(
  data: FirebaseFirestore.DocumentData,
  cap: number
): boolean {
  const lastFileCount = data.compaction?.lastFileCount as number | undefined;
  const sessionsAtLastCheck = data.compaction?.sessionsAtLastCheck as number | undefined;

  // Never examined: nothing is known, so look rather than infer health from an
  // absent record.
  if (lastFileCount === undefined || sessionsAtLastCheck === undefined) {
    return true;
  }

  const growth = Math.max(0, (data.sessions ?? 0) - sessionsAtLastCheck);
  const estimate = lastFileCount + growth * ASSUMED_FILES_PER_SUBMISSION;
  return estimate >= Math.floor(cap * WATERMARK_RATIO);
}

// The provider's cap, or null when this experiment is not eligible for
// compaction at all. Reads only the document already in the event payload --
// no Firestore reads -- so an ineligible experiment costs nothing.
//
// Exported for upload-queue-trigger.ts, which runs the identical eligibility
// check against a document it had to read explicitly (unlike this trigger, it
// has no experiment document already in hand).
export function capFor(data: FirebaseFirestore.DocumentData | undefined): number | null {
  const provider = data?.storageProvider as StorageProviderId | undefined;
  if (!provider) {
    return null;
  }
  try {
    return getProvider(provider).capabilities.maxFileCount;
  } catch {
    return null;
  }
}

// Exported for the same reason as capFor above.
export function leaseHeld(data: FirebaseFirestore.DocumentData | undefined): boolean {
  const until = data?.compaction?.compactingUntil as FirebaseFirestore.Timestamp | undefined;
  return !!until && until.toMillis() > Date.now();
}

/**
 * Fires on every experiment document update, which means every submission.
 *
 * Everything here is decided from the event payload alone, so a submission to
 * a non-capped provider -- the overwhelming majority -- costs one invocation
 * that returns without a single read and without renting the 1GiB instance
 * compaction-task.ts's compactionTask needs: this trigger runs at 256MiB, and
 * enqueueCompaction is a cheap Cloud Tasks call, not the pass itself.
 */
export const onExperimentGrew = onDocumentUpdated(
  { document: "experiments/{experimentID}", memory: "256MiB" },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) {
      return;
    }

    // Compaction writes compaction.* on the same document and never touches
    // `sessions`, so this is also what stops a pass from re-triggering itself.
    if ((before?.sessions ?? 0) === (after.sessions ?? 0)) {
      return;
    }

    const cap = capFor(after);
    if (cap === null) {
      return;
    }
    if (leaseHeld(after)) {
      return;
    }
    if (!mayHaveCrossedWatermark(after, cap)) {
      return;
    }

    await enqueueCompaction(event.params.experimentID);
  }
);
