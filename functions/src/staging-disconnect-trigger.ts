// Shows a participant's dropout on the researcher's live dashboard within
// seconds, by updating the live-sessions mirror (live-sessions.ts) whenever a
// disconnect or reconnect slot is written.
//
// THIS IS THE ONE FUNCTION TRIGGERED BY THE STAGING TREE, AND IT IS BOUNDED.
//
// The staging tier's founding rule is that no function runs per TRIAL: a
// trigger on trial writes would bring back the per-trial invocation the whole
// design exists to avoid (see the header of scheduled-staging-sweep.ts). This
// trigger is scoped so trials can never reach it -- its path is
// staging/{sid}/meta/{kind}/{n}, two levels under meta, which no trial write
// and no lastFlushAt write touches. Verified in the emulator: a trial write
// and a lastFlushAt write beside a stamp fire it exactly once, for the stamp.
//
// But these slots are written with the PARTICIPANT's permissions, so the rules
// are what bound it. database.rules.json allows slots 1..20 of each kind,
// write-once, server time only: at most 40 writes per session id, however it is
// used. Without that bound anyone holding a session id could loop writes and
// turn one /api/session request into millions of invocations. Do not widen the
// slot rules without revisiting this.
//
// A session's discard also deletes its slots, which fires this once per slot
// written; those events are skipped below, and they only ever come from the
// server, once per session.

import { onValueWritten } from "firebase-functions/v2/database";
import { getSessionMeta } from "./staging.js";
import { mirrorConnectionState } from "./live-sessions.js";

export const onStagingDisconnect = onValueWritten(
  { ref: "/staging/{sessionId}/meta/{kind}/{slot}", memory: "256MiB" },
  async (event) => {
    const { sessionId, kind } = event.params;
    if (kind !== "disconnects" && kind !== "reconnects") return;

    // A deletion means discardSession() is removing the whole session, and
    // with it the mirror document. Nothing to show.
    if (!event.data.after.exists()) return;

    // Recompute from the whole meta rather than from this one event. Events
    // are delivered at least once and in no guaranteed order -- a reconnect
    // mark can legitimately land before its stamp -- so the only safe answer
    // is the one disconnectedSince() gives for the slots as they stand now.
    const meta = await getSessionMeta(sessionId);
    await mirrorConnectionState(sessionId, meta);
  }
);
