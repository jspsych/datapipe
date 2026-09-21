// The Cloud Task that actually runs a compaction pass (compaction.ts).
//
// Phase 3 of the consolidation: compaction.ts's cost is not that it runs --
// it almost never does -- it is that EVERY trigger invocation that decides to
// look pays for a 1GiB/540s instance, because that is the runtime a pass
// needs if it finds work. compaction-triggers.ts and upload-queue-trigger.ts
// now do only the cheap, read-light eligibility decision at 256MiB and hand
// off here the moment they decide a pass is worth running. This function is
// the only place in the codebase that still pays for the big instance, and it
// pays for it only when a pass is actually going to happen.
//
// Same split as api-finalize.ts's apiFinalize/finalizeTask, and for the
// identical reason: a Cloud Task, not an inline call, is what lets the cheap
// decision and the expensive work carry different runtimes. There is no
// hosting-rewrite 60s ceiling here (nothing calls this over HTTP), so unlike
// finalizeTask this is not about a timeout budget -- it is purely about not
// renting 1GiB for a decision that returns "no" the overwhelming majority of
// the time.
//
// NO task id, NO dedupe, NO scheduleDelay/debounce. Considered and rejected:
// participant traffic is not bursty at a timescale that would make debouncing
// pay for itself, and the real deduping already exists for free --
// compactExperiment's lease (compaction.ts's acquireLease) makes a duplicate
// dispatch return "leased-elsewhere" rather than do redundant work, and the
// callers' own pre-checks (capFor, leaseHeld, mayHaveCrossedWatermark /
// isCompactionSignal) already suppress most of the redundant enqueues before
// a task is even created. Adding scheduling delay on top would only add
// latency to the one case this whole feature exists to serve -- a burst
// closing in on the cap.
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { functions } from "./app.js";
import { compactExperiment, CompactionResult } from "./compaction.js";

export async function enqueueCompaction(experimentID: string): Promise<void> {
  await functions.taskQueue<{ experimentID: string }>("compactiontask").enqueue({ experimentID });
}

// 1GiB/540s: exactly today's RUNTIME for a compaction pass (a batch up to
// MAX_BATCH_BYTES plus the assembled zip, held in memory at once) -- not a
// new number, just moved off the trigger that used to pay it on every
// invocation. retryConfig covers a genuine crash; a "failed" RESULT below is
// not one (see logResult).
export const compactionTask = onTaskDispatched<{ experimentID: string }>(
  {
    memory: "1GiB",
    timeoutSeconds: 540,
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 30 },
    rateLimits: { maxConcurrentDispatches: 10 },
  },
  async (request) => {
    const { experimentID } = request.data;
    if (!experimentID) {
      // Malformed payload -- nothing to retry into, and nothing to do. Same
      // stance as finalizeTask's identical guard.
      console.error("compactionTask: dispatched with no experimentID");
      return;
    }

    const result = await compactExperiment(experimentID);
    logResult(result);
  }
);

// Moved here unchanged from compaction-triggers.ts: this is the outcome of
// running a pass, and running a pass is now this module's job.
//
// A "failed" RESULT is deliberately only logged, never thrown. compactExperiment
// already turned whatever went wrong into a status instead of an exception, and
// re-throwing here would ask Cloud Tasks to retry a business-logic outcome
// (token resolution failure, a provider error) up to maxAttempts times instead
// of just waiting for the next event to re-trigger it -- exactly the
// distinction finalizeTask draws for finalizeExperiment. An uncaught exception
// -- something outside compactExperiment's own try/catch, e.g. this function
// dying mid-await -- still propagates and gets Cloud Tasks' retry, which is
// what retryConfig is for.
function logResult(result: CompactionResult): void {
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
