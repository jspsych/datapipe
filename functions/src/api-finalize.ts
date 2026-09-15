// Phase 4 of docs/finalization-spec.md: the surface that lets a researcher
// actually trigger finalizeExperiment (finalization.ts).
//
// WHY THIS IS TWO FUNCTIONS, NOT ONE, AND WHY THAT IS NOT NEGOTIABLE:
// every DataPipe endpoint is reached through a Firebase Hosting rewrite (see
// firebase.json), and hosting rewrites to Cloud Functions have a HARD 60
// SECOND TIMEOUT regardless of what the function itself is configured for.
// finalizeExperiment routinely runs longer than that -- it streams a merged
// archive for an entire study through Cloud Storage and back out to the
// provider. Running it inline here would mean the hosting layer 504s the
// researcher while the merge keeps running unseen, which is the worst
// possible UX for an operation that permanently deletes the loose files it
// consumes.
//
// So apiFinalize does only cheap, synchronous work -- verify the caller,
// verify ownership, run pre-checks that need no network I/O -- and then
// enqueues a Cloud Task and returns 202 immediately, well inside the 60s
// budget. finalizeTask (onTaskDispatched) is a separate function, invoked by
// the Cloud Tasks service itself rather than through hosting, so it is free
// to run long. Its own ceiling is lower than the 3600s an onRequest function
// could in principle have: task-queue functions cap at 1800s (30 minutes) --
// see firebase-functions's TaskQueueOptions.timeoutSeconds doc comment. That
// is still far more than any hosting rewrite tolerates, which is the only
// property this split actually needs.
//
// Returning 202 and continuing the work in THIS invocation (skip the task
// entirely) was considered and rejected: Cloud Functions throttles CPU after
// the response is sent and may kill the instance shortly after, so anything
// still running past that point is not guaranteed to finish -- and an
// interrupted finalization pass is exactly what finalization.ts's crash-safe
// resume logic exists to make survivable, not something to invite casually.
//
// PROGRESS REPORTING: finalizeExperiment itself is silent about progress --
// it just returns a FinalizationResult when it's done. The dashboard needs
// something to poll before then, so this module owns writing
// experiments/{id}.finalization (FinalizationState, interfaces.ts) around the
// call: "queued" the instant the task is handed to Cloud Tasks, "running" the
// instant the task starts executing, then one of FinalizationResult's own
// status values once it resolves. firestore.rules blocks a client from ever
// writing this field, so its presence is a genuine signal, not something a
// researcher could forge to make the dashboard show a finalized state that
// never happened.
import { onRequest } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db, auth, functions } from "./app.js";
import { finalizeExperiment } from "./finalization.js";
import { ExperimentData, FinalizationState } from "./interfaces.js";

// Task-queue functions cap at 1800s (see module header). finalizeExperiment
// streams rather than buffers (docs/finalization-spec.md's "why streaming,
// not splitting"), so its running time scales with provider round trips, not
// with memory -- 1800s is the most headroom this surface can give it.
const TASK_TIMEOUT_SECONDS = 1800;

function experimentRef(experimentID: string) {
  return db.collection("experiments").doc(experimentID);
}

function isInFlight(status: FinalizationState["status"] | undefined): boolean {
  return status === "queued" || status === "running";
}

export const apiFinalize = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Same Bearer/verifyIdToken shape as api-queue-status.ts, per
  // docs/finalization-spec.md's Phase 4 instructions.
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let uid: string;
  try {
    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    uid = decodedToken.uid;
  } catch {
    res.status(401).json({ error: "Invalid authentication token" });
    return;
  }

  const experimentID = req.body?.experimentID as string | undefined;
  if (!experimentID) {
    res.status(400).json({ error: "experimentID is required" });
    return;
  }

  const expRef = experimentRef(experimentID);
  const expSnap = await expRef.get();
  // Same 403-for-both convention as api-queue-status.ts: a nonexistent
  // experiment and someone else's experiment get the identical response, so
  // this endpoint never confirms which experiment IDs exist to a caller who
  // does not already own one.
  if (!expSnap.exists || expSnap.data()?.owner !== uid) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const expData = expSnap.data() as ExperimentData;

  // Permanent, and the one pre-check worth short-circuiting on even though
  // finalizeExperiment would also catch it -- a second click after
  // finalization already landed must not enqueue a task (there is nothing
  // left for it to do) or overwrite the finalization record that already
  // describes what happened.
  if (expData.finalized === true) {
    res.status(200).json({ status: "already-finalized" });
    return;
  }

  // The other pre-check cheap enough to run here: it reads fields already in
  // hand, no I/O. Everything else finalizeExperiment refuses on (provider
  // capabilities, queued uploads, the compaction lease) needs a provider
  // lookup or a Firestore query beyond what's already been read, so it is
  // deliberately left to finalizeTask -- duplicating that logic here would
  // just be a second, divergent copy of finalization.ts's own eligibility
  // rules.
  if (!expData.storageProvider || !expData.providerContainer) {
    res.status(400).json({
      status: "not-eligible",
      detail: "legacy experiment with no provider container",
    });
    return;
  }

  // Idempotent against a duplicate click (a second tab, a double-tap on a
  // slow connection): if a pass is already in flight, report that instead of
  // enqueueing a second task. A second concurrent finalizeExperiment call
  // would just bounce off the compaction lease as "leased-elsewhere," which
  // is a confusing thing to surface for what the researcher experienced as
  // clicking one button once.
  const inFlightStatus = expData.finalization?.status;
  if (isInFlight(inFlightStatus)) {
    res.status(202).json({ status: inFlightStatus });
    return;
  }

  const now = Timestamp.now();
  await expRef.update({
    "finalization.status": "queued",
    "finalization.startedAt": now,
    "finalization.finishedAt": FieldValue.delete(),
    "finalization.detail": FieldValue.delete(),
  });

  try {
    await functions.taskQueue<{ experimentID: string }>("finalizetask").enqueue({ experimentID });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await expRef
      .update({
        "finalization.status": "failed",
        "finalization.finishedAt": Timestamp.now(),
        "finalization.detail": `failed to enqueue finalization task: ${detail}`,
      })
      .catch(() => undefined);
    res.status(500).json({ error: "Failed to enqueue finalization" });
    return;
  }

  res.status(202).json({ status: "queued" });
});

export const finalizeTask = onTaskDispatched<{ experimentID: string }>(
  {
    timeoutSeconds: TASK_TIMEOUT_SECONDS,
    memory: "1GiB",
    retryConfig: { maxAttempts: 3 },
    rateLimits: { maxConcurrentDispatches: 5 },
  },
  async (request) => {
    const { experimentID } = request.data;
    if (!experimentID) {
      // Malformed payload -- nothing to retry into, and nothing to do.
      console.error("finalizeTask: dispatched with no experimentID");
      return;
    }

    const expRef = experimentRef(experimentID);
    const expSnap = await expRef.get();
    if (!expSnap.exists) {
      // The experiment was deleted between enqueue and dispatch (or this is
      // a stale Cloud Tasks retry of a task whose experiment is long gone).
      // There is no document left to write progress onto.
      console.error(`finalizeTask: experiment ${experimentID} no longer exists`);
      return;
    }

    await expRef
      .update({
        "finalization.status": "running",
        "finalization.finishedAt": FieldValue.delete(),
        "finalization.detail": FieldValue.delete(),
      })
      .catch((e) => console.error(`finalizeTask: failed to record running state for ${experimentID}`, e));

    let result;
    try {
      result = await finalizeExperiment(experimentID);
    } catch (e) {
      // finalizeExperiment already catches everything it can attribute to a
      // specific step and returns a "failed" FinalizationResult instead of
      // throwing (see its own top-level try/catch); reaching here means
      // something failed OUTSIDE that -- e.g. this very write above. Recorded
      // as "failed" and NOT rethrown: see the module header on why this task
      // never asks Cloud Tasks to retry a business-logic outcome. A genuine
      // crash (the process dying mid-await) never reaches this catch at all,
      // so Cloud Tasks' own retry still covers that case via retryConfig.
      const detail = e instanceof Error ? e.message : String(e);
      await expRef
        .update({
          "finalization.status": "failed",
          "finalization.finishedAt": Timestamp.now(),
          "finalization.detail": detail,
        })
        .catch((writeErr) => console.error(`finalizeTask: failed to record failure for ${experimentID}`, writeErr));
      return;
    }

    const patch: Record<string, unknown> = {
      "finalization.status": result.status,
      "finalization.finishedAt": Timestamp.now(),
    };
    patch["finalization.detail"] = result.detail ?? FieldValue.delete();
    await expRef
      .update(patch)
      .catch((e) => console.error(`finalizeTask: failed to record terminal state for ${experimentID}`, e));
  }
);
