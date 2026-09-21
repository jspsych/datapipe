// The one deployed trigger on uploadQueue/{docId}, running two independent
// concerns that both need to see every write to this collection:
//
//   1. failure-notify (upload-failure-notify.ts): tell a researcher once when
//      their data stops arriving.
//   2. compaction discovery (compaction.ts / compaction-triggers.ts): notice
//      the two cases the experiment-document trigger cannot see -- a write the
//      provider refused for lack of room, and a retry-worker completion that
//      never touched `sessions`.
//
// EXPORTED AS onUploadQueueChanged / deployed as onuploadqueuechanged
// DELIBERATELY: that is the name compaction-triggers.ts's half of this used
// to have, and keeping it means this deploy is an in-place update of an
// EXISTING trigger rather than delete-one/create-another. There is no window
// in which uploadQueue writes go unobserved while Cloud Functions tears down
// the old trigger and stands up a new one -- only onuploadfailure, the other
// half of what used to watch this collection, is actually deleted. See
// upload-failure-notify.ts's header for why the two used to be separate
// functions and are not any more.
//
// Each concern runs in its OWN try/catch, so a broken mail write can never
// suppress a compaction discovery and vice versa. If either throws, both are
// logged (the error object, not just its message, so a stack trace survives
// into Cloud Logging) and ONE summary error is thrown afterward, so the
// invocation is still recorded as failed for whichever concern broke -- there
// is no retry envelope to lose here (this trigger declares none, same as
// onUploadFailure never did), so throwing costs nothing but an accurate log.
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { db } from "./app.js";
import { handleQueueWrite } from "./upload-failure-notify.js";
import { capFor, leaseHeld } from "./compaction-triggers.js";
import { enqueueCompaction } from "./compaction-task.js";

type QueueData = FirebaseFirestore.DocumentData | undefined;

/**
 * Pure predicate for the two queue-write shapes compaction cares about.
 *
 * QUOTA_EXCEEDED means the provider has already refused a write for lack of
 * room -- the most urgent signal there is, and the one that makes a
 * researcher's hand-uploaded files eventually visible to us despite producing
 * no event of their own.
 *
 * A completed entry means the retry worker just landed a file WITHOUT
 * `sessions` moving, because that submission incremented it when it first
 * arrived and failed. A draining backlog is otherwise invisible to the
 * experiment-document trigger.
 *
 * Decided from the event payload alone -- no Firestore reads -- so a queue
 * write that means nothing for capacity (the overwhelming majority) costs
 * nothing beyond this check.
 */
export function isCompactionSignal(before: QueueData, after: QueueData): boolean {
  if (!after) {
    return false;
  }
  const blocked = after.status === "pending" && after.providerErrorCode === "QUOTA_EXCEEDED";
  const justLanded = after.status === "completed" && before?.status !== "completed";
  return blocked || justLanded;
}

async function discoverCompaction(before: QueueData, after: QueueData): Promise<void> {
  if (!isCompactionSignal(before, after)) {
    return;
  }
  const experimentID = after?.experimentID as string | undefined;
  if (!experimentID) {
    return;
  }

  // Unlike onExperimentGrew there is no experiment document already in hand,
  // so eligibility costs exactly one read -- capFor/leaseHeld are the same
  // predicates that trigger uses, run here against a document fetched for the
  // purpose. A blocked entry is worth that read regardless of the cap check
  // below: it is proof from the provider itself that the record is full, but
  // it is still only worth enqueueing a task for a provider that can compact
  // at all.
  const expSnap = await db.collection("experiments").doc(experimentID).get();
  if (!expSnap.exists) {
    return;
  }
  const expData = expSnap.data();
  if (capFor(expData) === null) {
    return;
  }
  if (leaseHeld(expData)) {
    return;
  }

  await enqueueCompaction(experimentID);
}

export const onUploadQueueChanged = onDocumentWritten(
  { document: "uploadQueue/{docId}", memory: "256MiB" },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const docId = event.params.docId;

    const errors: unknown[] = [];

    try {
      const outcome = await handleQueueWrite(before, after, docId);
      if (outcome !== "noop") {
        console.log(`upload-failure-notify: ${docId} -> ${outcome}`);
      }
    } catch (e) {
      errors.push(e);
      console.error(`upload-queue-trigger: failure-notify failed for ${docId}:`, e);
    }

    try {
      await discoverCompaction(before, after);
    } catch (e) {
      errors.push(e);
      console.error(`upload-queue-trigger: compaction discovery failed for ${docId}:`, e);
    }

    if (errors.length > 0) {
      throw new Error(
        `onUploadQueueChanged: ${errors.length} of 2 concern(s) failed for ${docId} -- see the logged errors above`
      );
    }
  }
);
