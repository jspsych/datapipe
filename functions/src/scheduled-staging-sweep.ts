// Recovers sessions that were staged but never completed
// (docs/streaming-ingest-design.md, "Abandonment").
//
// A participant closes the tab at trial 199 of 200. Their trials are in the
// RTDB staging tier, Firebase's servers have stamped meta/abandonedAt via the
// onDisconnect the plugin registered, and nothing else will ever happen to
// them. This sweep is what turns that into a file in the researcher's storage.
//
// ONE INVOCATION PER SWEEP, NOT PER SESSION. This is the single easiest way to
// get the whole design wrong: an onValueCreated trigger on the staging tree
// would be the obvious implementation and would silently reinstate the
// per-trial function invocation the design exists to avoid -- twenty in-flight
// requests globally (index.ts's maxInstances: 20 against api-data.ts's
// concurrency: 1), one provider write per trial, and logs/{experimentId}
// multiplied by ~100x. Do not add a trigger to this tree.
//
// Modelled on scheduled-pending-recovery.ts throughout, including its
// promote-into-the-existing-queue approach and its batching. It does NOT do
// the provider write itself: it hands the assembled session to queueUpload and
// lets scheduled-upload-retry.ts deliver it, which means a recovered session
// appears in the researcher's dashboard QueuePanel, inherits the existing
// backoff, and can be downloaded by hand if delivery never succeeds. No
// duplicate retry infrastructure.
//
// WHY SWEEP HEALTH IS A WRITTEN METRIC AND NOT JUST A CRON ENTRY
//
// A broken sweep is the expensive failure in this design. RTDB storage is
// $5/GB-month, roughly 190x Cloud Storage's $0.026 -- so orphaned staging data
// accumulates at the highest per-GB rate in the stack, silently, while the
// scheduled function looks green in the console because it is running and
// throwing. systemStatus/staging is written on EVERY run, including one that
// found nothing, so "lastRunAt is stale" and "lastError is set" are both
// answerable without reading logs.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./app.js";
import queueUpload from "./queue-upload.js";
import { uploadPathFor } from "./metadata-derived-files.js";
import { ExperimentData } from "./interfaces.js";
import {
  assembleSession,
  countOpenSessions,
  discardSession,
  getSessionMeta,
  listOldestOpenSessions,
  partialFilenameFor,
  OpenSession,
} from "./staging.js";

// How long after Firebase stamps meta/abandonedAt before the session is
// treated as really gone.
//
// This is NOT a formality, and it is why abandonedAt is clearable in
// database.rules.json. onDisconnect fires on any socket drop -- a participant
// on hotel wifi, a laptop lid closed for a minute, a phone switching from wifi
// to cellular. The plugin clears the stamp and re-arms when it reconnects, so
// the grace period is the window in which that can happen. Ten minutes is long
// enough to cover a reconnect and short enough that a genuinely abandoned
// session is recovered while the study is still running.
export const ABANDON_GRACE_MS = 10 * 60 * 1000;

// Process at most this many sessions per run, to stay inside the time and
// memory limits. Same constant and same reasoning as
// scheduled-pending-recovery.ts's MAX_FILES_PER_RUN.
const MAX_SESSIONS_PER_RUN = 10;

// Candidates read per run. More than can be processed, because most of the
// oldest open sessions on a busy deployment are LIVE rather than abandoned and
// are skipped without costing anything but a meta read. Mirrors the
// `maxResults: MAX_FILES_PER_RUN * 2` in the pending sweep.
const CANDIDATES_PER_RUN = MAX_SESSIONS_PER_RUN * 3;

export interface SweepStats {
  candidates: number;
  recovered: number;
  discarded: number;
  skippedLive: number;
  errors: number;
}

export const scheduledStagingSweep = onSchedule(
  // Every five minutes. Faster than scheduled-pending-recovery's fifteen,
  // because what accumulates here is billed at the highest per-GB rate in the
  // stack and because a researcher watching a live study should see recovered
  // sessions within a coffee break, not a lunch break.
  { schedule: "*/5 * * * *", memory: "256MiB" },
  async () => {
    await sweepAbandonedSessions();
  }
);

/**
 * `only` exists as a TEST SEAM and defaults to the production behaviour of
 * sweeping every open session.
 *
 * This sweep is global and destructive -- it promotes what it finds and then
 * DELETES the staging node -- so a test that runs it unscoped against the
 * shared emulator consumes fixtures belonging to whatever other suite happens
 * to be running in parallel. That is not hypothetical: it is exactly the
 * long-lived flake documented on recoverPendingUploads in
 * scheduled-pending-recovery.ts, where an unrelated suite failed roughly one
 * run in three and always passed in isolation. Tests must pass the session ids
 * they created.
 */
export async function sweepAbandonedSessions(
  only?: Set<string>
): Promise<SweepStats> {
  const stats: SweepStats = {
    candidates: 0,
    recovered: 0,
    discarded: 0,
    skippedLive: 0,
    errors: 0,
  };
  let lastError: string | null = null;

  try {
    const candidates = (await listOldestOpenSessions(CANDIDATES_PER_RUN)).filter(
      (s) => !only || only.has(s.sessionId)
    );
    stats.candidates = candidates.length;

    const now = Date.now();

    for (const session of candidates) {
      if (stats.recovered + stats.discarded >= MAX_SESSIONS_PER_RUN) break;

      try {
        const meta = await getSessionMeta(session.sessionId);

        const abandoned =
          typeof meta.abandonedAt === "number" &&
          now - meta.abandonedAt >= ABANDON_GRACE_MS;
        // The backstop, for a client that died before it could register an
        // onDisconnect at all, or one whose onDisconnect Firebase never ran.
        // Without it such a session would sit in RTDB forever, being paid for.
        const expired =
          typeof session.expiresAt === "number" && now >= session.expiresAt;

        if (!abandoned && !expired) {
          stats.skippedLive++;
          continue;
        }

        const outcome = await recoverSession(session);
        if (outcome === "recovered") stats.recovered++;
        else stats.discarded++;
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Unknown error";
        // One bad session must not stop the run: the others behind it are
        // accruing storage cost, and a session that throws every time would
        // otherwise block the queue permanently.
        console.error(
          `Failed to recover staging session ${session.sessionId}: ${detail}`
        );
        lastError = detail;
        stats.errors++;
      }
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : "Unknown error";
    console.error(`Staging sweep failed: ${lastError}`);
    stats.errors++;
  }

  await recordSweepHealth(stats, lastError);

  if (stats.recovered > 0 || stats.discarded > 0) {
    console.log(
      `Staging sweep: recovered ${stats.recovered}, discarded ${stats.discarded}, ` +
        `skipped ${stats.skippedLive} live of ${stats.candidates} candidates.`
    );
  }

  return stats;
}

/**
 * Turn one abandoned session into a queued partial upload, or discard it.
 *
 * Returns "recovered" when a queue entry was written, "discarded" when the
 * session was dropped without one. Either way the staging node is gone
 * afterwards -- this function never leaves data behind for the next run to
 * rediscover, because a session that cannot be recovered is a session that
 * would otherwise be paid for forever.
 */
export async function recoverSession(
  session: OpenSession
): Promise<"recovered" | "discarded"> {
  const { sessionId, experimentId } = session;

  const expDoc = await db.collection("experiments").doc(experimentId).get();
  if (!expDoc.exists) {
    console.warn(
      `Staging session ${sessionId} belongs to missing experiment ${experimentId}; discarding.`
    );
    await discardSession(sessionId);
    return "discarded";
  }

  const expData = expDoc.data() as ExperimentData;

  if (!expData.owner) {
    console.warn(
      `Experiment ${experimentId} has no owner; discarding staging session ${sessionId}.`
    );
    await discardSession(sessionId);
    return "discarded";
  }

  // THE SECOND DOOR. api-session-start.ts checked these gates when the session
  // opened, and api-data.ts checks them again on a clean completion -- but this
  // path runs minutes to hours later, and a researcher can finalize or switch
  // off collection in between. Uploading here without re-checking would put a
  // file OUTSIDE a merged archive, which is precisely the non-Psych-DS state
  // docs/finalization-spec.md exists to prevent, and would do it through a
  // path no participant triggered.
  //
  // The data is discarded rather than held: the researcher has said this
  // experiment accepts nothing further, and DataPipe holding a participant's
  // trials indefinitely against that instruction is the wrong default.
  if (expData.finalized) {
    console.log(
      `Experiment ${experimentId} is finalized; discarding staging session ${sessionId}.`
    );
    await discardSession(sessionId);
    return "discarded";
  }

  if (!expData.active) {
    console.log(
      `Experiment ${experimentId} is not collecting; discarding staging session ${sessionId}.`
    );
    await discardSession(sessionId);
    return "discarded";
  }

  const assembled = await assembleSession(sessionId);

  // Nothing was ever staged: a session that opened and closed without a single
  // flush. Common and uninteresting -- a participant who loaded the page and
  // left. There is no data to recover and an empty file would be noise in the
  // researcher's dataset.
  if (assembled.trialCount === 0) {
    await discardSession(sessionId);
    return "discarded";
  }

  const filename = partialFilenameFor(session);
  // Layout-aware, exactly as promoteToQueue is: a metadata-active experiment
  // stores its raw file under data/raw/. Recovered sessions get no metadata or
  // derived files regenerated -- this path has no metadata pipeline, and the
  // raw file is the source of truth -- the same documented limitation the
  // pending-recovery sweep carries.
  const uploadFilename = uploadPathFor(expData.metadataActive, filename);

  const notes: string[] = [`${assembled.trialCount} trials`];
  if (assembled.gaps > 0) notes.push(`${assembled.gaps} missing`);
  if (assembled.skipped > 0) notes.push(`${assembled.skipped} unreadable`);
  if (assembled.truncated) notes.push("truncated at the size limit");

  await queueUpload({
    experimentID: experimentId,
    owner: expData.owner,
    filename: uploadFilename,
    data: assembled.data,
    dataType: "data",
    osfFilesLink: expData.osfFilesLink,
    storageProvider: expData.storageProvider,
    providerContainer: expData.providerContainer,
    errorCode: 0,
    // Bookkeeping, not an instruction: the field RECORDS whether the path that
    // enqueued this entry already incremented `experiments/{id}.sessions`.
    // Nothing reads it today -- scheduled-upload-retry.ts never consults it --
    // so it is a record of what happened, on the same terms as the note in
    // metadata-derived-upload.ts.
    //
    // False because nothing incremented, and nothing should. A participant who
    // abandoned partway has not produced a session, and counting them would
    // consume a researcher's maxSessions cap with data nobody submitted.
    // api-session-start.ts does not increment either, for the same reason; the
    // count is still taken exactly once, on a clean completion, by api-data.ts.
    sessionIncremented: false,
    // Read by upload-failure-notify.ts, which refuses to open a notification
    // episode on a partial. A tab closing is not "your data stopped arriving".
    partial: true,
    failureReason: `Recovered from an abandoned session (${notes.join(", ")})`,
  });

  await discardSession(sessionId);
  return "recovered";
}

/**
 * systemStatus/staging -- the sweep's health surface.
 *
 * Written on every run, including a no-op one, so a stale `lastRunAt` is
 * itself the alarm. `systemStatus` has no match block in firestore.rules and
 * is therefore already closed to every client, exactly like systemStatus/mail
 * (functions/src/mail-availability.ts) -- written down here so nobody later
 * "fixes" the absence of a rule by adding one.
 *
 * Best-effort: a failure to record health must never be the thing that fails a
 * sweep that actually recovered data.
 */
async function recordSweepHealth(
  stats: SweepStats,
  lastError: string | null
): Promise<void> {
  try {
    // Read back AFTER the run, so the number reflects what is still sitting in
    // RTDB rather than what was there when the run started. This is the figure
    // that grows without bound when the sweep is broken.
    const openSessionCount = await countOpenSessions();
    await db
      .collection("systemStatus")
      .doc("staging")
      .set(
        {
          lastRunAt: Timestamp.now(),
          openSessionCount,
          candidates: stats.candidates,
          recovered: stats.recovered,
          discarded: stats.discarded,
          skippedLive: stats.skippedLive,
          errors: stats.errors,
          lastError,
        },
        { merge: true }
      );
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(`Failed to record staging sweep health: ${detail}`);
  }
}
