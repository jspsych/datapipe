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

import { onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { getProvider } from "./providers/index.js";
import { StorageProviderId } from "./providers/types.js";
import { compactExperiment, WATERMARK_RATIO } from "./compaction.js";

// Runtime shared by both triggers: a pass holds one batch in memory at once,
// bounded by compaction.ts's MAX_BATCH_BYTES plus the assembled zip.
const RUNTIME = { memory: "1GiB" as const, timeoutSeconds: 540 };

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
function capFor(data: FirebaseFirestore.DocumentData | undefined): number | null {
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

function leaseHeld(data: FirebaseFirestore.DocumentData | undefined): boolean {
  const until = data?.compaction?.compactingUntil as FirebaseFirestore.Timestamp | undefined;
  return !!until && until.toMillis() > Date.now();
}

/**
 * Fires on every experiment document update, which means every submission.
 *
 * Everything before the compactExperiment call is decided from the event
 * payload alone, so a submission to a non-capped provider -- the overwhelming
 * majority -- costs one invocation that returns without a single read.
 */
export const onExperimentGrew = onDocumentUpdated(
  { document: "experiments/{experimentID}", ...RUNTIME },
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

    const result = await compactExperiment(event.params.experimentID);
    logResult(result);
  }
);

/**
 * Fires on upload-queue writes, covering the two cases `sessions` cannot see.
 *
 * QUOTA_EXCEEDED means the provider has already refused a write for lack of
 * room — the most urgent signal there is, and the one that makes a researcher's
 * hand-uploaded files eventually visible to us despite producing no event of
 * their own.
 *
 * A completed entry means the retry worker just landed a file WITHOUT
 * `sessions` moving, because that submission incremented it when it first
 * arrived and failed. A draining backlog is otherwise invisible.
 */
export const onUploadQueueChanged = onDocumentWritten(
  { document: "uploadQueue/{docId}", ...RUNTIME },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) {
      return;
    }

    const blocked = after.status === "pending" && after.providerErrorCode === "QUOTA_EXCEEDED";
    const justLanded = after.status === "completed" && before?.status !== "completed";
    if (!blocked && !justLanded) {
      return;
    }

    const experimentID = after.experimentID as string | undefined;
    if (!experimentID) {
      return;
    }

    // Unlike the experiment trigger there is no document in hand to pre-filter
    // on, so eligibility is settled inside compactExperiment. A blocked entry
    // is worth the read regardless: it is proof the record is already full.
    const result = await compactExperiment(experimentID);
    logResult(result);
  }
);

function logResult(result: ReturnType<typeof compactExperiment> extends Promise<infer R> ? R : never) {
  if (result.status === "compacted") {
    console.log(
      `compaction: ${result.experimentID} sealed ${result.archived} file(s) into ${result.archiveName} ` +
        `(${result.fileCountBefore} -> ${result.fileCountAfter} files)`
    );
    if (result.recoveredFromSaturation) {
      // Not a failure -- the pass succeeded by staging the archive over one of
      // its own batch members. Worth seeing, because it means a burst outran
      // the watermark and the headroom constants may need revisiting.
      console.warn(
        `compaction: ${result.experimentID} was at the file cap and recovered via a staged archive`
      );
    }
    if (result.undeleted) {
      console.warn(
        `compaction: ${result.experimentID} left ${result.undeleted} original(s) undeleted; they will be skipped next pass`
      );
    }
  } else if (result.status === "failed") {
    console.error(`compaction: ${result.experimentID} failed: ${result.detail}`);
  }
}
