// ONE deployed Cloud Function fronting the two participant-facing HTTP
// endpoints that are NOT the raw data-submission path: apiSessionStart
// (POST /api/session, admits a participant to the RTDB staging tier -- see
// api-session-start.ts's own header) and apiCondition (POST /api/condition,
// random/sequential condition assignment).
//
// WHY MERGE THESE TWO: the same reason dashboard-api.ts merges 17 researcher
// endpoints. Each deployed function has its own instance pool, and a pool
// that low-traffic is nearly always cold. A single participant loading an
// experiment that uses BOTH condition assignment and streaming ingest used to
// pay two independent cold starts, back to back, before their first trial
// ever ran -- worse than either endpoint being cold on its own, and pure
// waste since nothing about them being separate functions ever bought
// anything. Sharing one pool lets a warm instance answer whichever of the two
// a given experiment actually uses.
//
// WHY THESE TWO ARE NOT IN dashboardapi, EVEN THOUGH THE MECHANISM IS
// IDENTICAL: dashboardapi fronts researcher-facing dashboard clicks --
// bursty, low-stakes, and tolerant of a failed deploy or a noisy-neighbor
// traffic spike briefly slowing down an unrelated endpoint. /api/session and
// /api/condition are on the PARTICIPANT-FACING path: every experiment
// session that uses either one blocks on it before trial data can flow, for
// real research participants who cannot retry. Folding them into
// dashboardapi would mean a researcher-side deploy, bug, or traffic burst
// shares a blast radius and a scaling pool with live data collection --
// exactly the coupling this whole consolidation effort is designed to avoid
// re-introducing. They get their own function, sized and deployed
// independently from both dashboardapi and apidata/apibase64.
//
// (/api/data and /api/base64 are a separate case again -- see api-data.ts's
// header: they already share memory/concurrency/timeout tuning forced by real
// OOM incidents, and are consolidated with EACH OTHER, not with these two.)
//
// Same shape as dashboard-api.ts: a plain object keyed by req.path, no
// express Router, a single trailing slash tolerated, an unmatched path is a
// 404 in the same shape a request to a nonexistent function gets today.
//
// THIS IS STEP 1 OF A TWO-STEP ROLLOUT. apiSessionStart and apiCondition stay
// deployed as their own standalone functions (thin onRequest wrappers around
// the same handlers dispatched here) for one release, so `firebase deploy
// --force`'s function-deletes-before-hosting-rewrites-update ordering never
// 404s a live participant mid-deploy. The follow-up removes those two
// standalone exports once this has deployed and hosting points here. See
// index.ts.

import { onRequest } from "firebase-functions/v2/https";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";

import { apiSessionStartHandler } from "./api-session-start.js";
import { apiConditionHandler } from "./api-condition.js";

type Handler = (req: Request, res: Response) => void | Promise<void>;

const ROUTES: Record<string, Handler> = {
  "/api/session": apiSessionStartHandler,
  "/api/condition": apiConditionHandler,
};

export const participantApi = onRequest({ cors: true }, async (req, res) => {
  // Strip exactly one trailing slash, but never touch a bare "/" -- nothing
  // in ROUTES matches that anyway, so it falls through to the 404 below same
  // as any other unmapped path. Same tolerance as dashboard-api.ts.
  const path =
    req.path.length > 1 && req.path.endsWith("/") ? req.path.slice(0, -1) : req.path;

  const handler = ROUTES[path];
  if (!handler) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await handler(req, res);
});
