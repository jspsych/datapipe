// The write-side half of archive compaction (compaction.ts).
//
// While a compaction pass is in flight, submissions are diverted into the
// upload queue instead of being written to the provider. DataPipe is the only
// writer to these containers, so holding writes for the duration of a pass
// means the file count CANNOT grow while the pass is running -- which is what
// guarantees there is room for the archive it is about to upload.
//
// This is deliberately a separate module from compaction.ts, which imports
// archiver and every provider adapter. api-data.ts is the hottest path in the
// codebase and pays that import cost on every cold start; this file has no
// dependencies beyond a type.
//
// The diverted submission is not delayed by much and is never at risk: the
// queue writes its payload to Cloud Storage first, the participant gets a 202
// immediately, and compaction releases the entries the moment its pass ends
// (see releaseHeldUploads). It is the same durable buffer that already absorbs
// provider outages.
//
// RESIDUAL RACE, stated rather than hidden: callers test the experiment
// document they already loaded for their own reasons, so a pass that starts
// between that read and the provider write is not seen. Re-reading would close
// it at the cost of a Firestore read on every submission, which is not worth
// it -- the window shrinks from "the whole pass" to "one request", and
// compaction can still recover if a record does fill (see the saturation
// handling in compaction.ts).

import type { ExperimentData } from "./interfaces.js";

/**
 * True while a compaction pass holds the lease on this experiment.
 *
 * Takes an already-loaded experiment document rather than an ID, precisely so
 * that gating a write costs nothing: every caller has one in hand.
 */
export function isCompactionInFlight(expData: Pick<ExperimentData, "compaction">): boolean {
  const until = expData.compaction?.compactingUntil;
  // The typeof guard is not defensive padding: this runs on the participant
  // submission path, and a `compactingUntil` that is anything other than a
  // Timestamp -- a malformed document, a hand-edit, a future writer that
  // stores a number -- would throw here and turn every submission to that
  // experiment into a 500. Treating an unreadable lease as "not held" fails
  // toward accepting data, which is the right direction: the worst case is a
  // write landing during a pass, which compaction already tolerates.
  if (!until || typeof (until as { toMillis?: unknown }).toMillis !== "function") {
    return false;
  }
  return until.toMillis() > Date.now();
}

// Reason recorded on entries held back by the gate, and the marker compaction
// looks for when releasing them afterwards.
export const COMPACTION_HOLD_REASON = "Compaction in progress";
