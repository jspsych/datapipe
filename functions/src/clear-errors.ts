// POST /api/clearerrors -- lets a researcher clear the "rejected submissions"
// panel on their experiment dashboard (components/dashboard/ErrorPanel.js).
//
// This has to be a server route because firestore.rules' logs/{id} match
// block grants clients `read` and `create` but deliberately NO `update`
// (write-log.ts is the only writer that increments logError/errors/
// errorsByCode, and nothing about that record is meant to be client-editable
// -- see the rules file for the block this route does not need to touch).
// Clearing the panel is therefore a write only server code can make.
//
// WHAT THIS DOES NOT DO: it never deletes or rewrites `errors`, `logError`,
// or `errorsByCode`. Those stay exactly as write-log.ts left them -- the
// lifetime record is kept on purpose, for support/debugging (a researcher's
// bug report references the same numbers DataPipe support would query), and
// `errorsByCode` is a cumulative, cross-clear tally by design (the operator
// question it answers, "which provider is failing and how", does not reset
// just because one researcher cleared their own panel). "Clearing" only
// advances a watermark the frontend subtracts against: see
// lib/error-panel.js's visibleErrorCount/visibleErrorRows, which is the same
// function pages/admin/[experiment_id].js and ErrorPanel.js both call.
//
// Modelled on ensure-derived-paths.ts: same POST-only/405, requireUser,
// experimentID validation, and 403-for-both (missing vs. not-yours)
// ownership check, dispatched from dashboard-api.ts alongside the other
// low-traffic dashboard endpoints.
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./app.js";
import MESSAGES from "./api-messages.js";
import { requireUser } from "./require-user.js";
import { getExperiment } from "./experiment-id.js";

function logsRef(experimentID: string) {
  return db.collection("logs").doc(experimentID);
}

// Plain handler, not an onRequest export -- dispatched from dashboard-api.ts
// along with the other low-traffic dashboard endpoints, merged into ONE
// deployed function (dashboardapi) so they share warm instances.
export async function clearErrorsHandler(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authResult = await requireUser(req, res);
  if (!authResult) return;
  const { uid } = authResult;

  const experimentID = req.body?.experimentID as string | undefined;
  if (typeof experimentID !== "string" || experimentID.trim().length === 0) {
    res.status(400).json(MESSAGES.MISSING_PARAMETER);
    return;
  }

  const expSnap = await getExperiment(experimentID);
  // Same 403-for-both convention as ensure-derived-paths.ts: a nonexistent
  // experiment and someone else's experiment get the identical response, so
  // this endpoint never confirms which experiment IDs exist to a caller who
  // does not already own one. (getExperiment's null also covers an id
  // Firestore would reject outright.)
  if (!expSnap || expSnap.data()?.owner !== uid) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const logRef = logsRef(experimentID);

  // A transaction, not a blind write: write-log.ts's "logError" branch
  // increments logError (and appends to errors) inside its own transaction,
  // concurrently with this one. The watermark this route writes
  // (logErrorCleared) has to equal a value of logError that was actually
  // observed in the SAME snapshot as the errorsClearedAt timestamp it is
  // paired with -- a read-then-blind-write here could race a concurrent
  // rejection and either clear a submission that arrived after the
  // timestamp, or leave one stale that arrived before it.
  await db.runTransaction(async (t) => {
    const snap = await t.get(logRef);
    // No logs document yet (an experiment that has never logged anything, or
    // one still mid-first-write). Nothing to clear -- respond 200 without
    // creating one, so this route can never be the thing that first brings a
    // logs/{id} document into existence.
    if (!snap.exists) return;

    const logError = snap.get("logError");
    t.set(
      logRef,
      {
        errorsClearedAt: FieldValue.serverTimestamp(),
        logErrorCleared: typeof logError === "number" ? logError : 0,
      },
      { merge: true }
    );
  });

  res.status(200).json(MESSAGES.SUCCESS);
}
