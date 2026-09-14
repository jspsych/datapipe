// Recovers sessions that were staged but never completed
// (docs/streaming-ingest-design.md, "Abandonment").
//
// A participant closes the tab at trial 199 of 200. Their trials are in the
// RTDB staging tier, Firebase's servers have stamped a disconnect slot via the
// onDisconnect the plugin registered, and nothing else will ever happen to
// them. This sweep is what turns that into a file in the researcher's storage.
//
// ONE INVOCATION PER SWEEP, NOT PER SESSION. This is the single easiest way to
// get the whole design wrong: an onValueCreated trigger on the staging tree
// would be the obvious implementation and would silently reinstate the
// per-trial function invocation the design exists to avoid -- twenty in-flight
// requests globally (index.ts's maxInstances: 20 against api-data.ts's
// concurrency: 1), one provider write per trial, and logs/{experimentId}
// multiplied by ~100x. Do not add a trigger on this tree's trial writes.
//
// (There is exactly one trigger on the tree, and it is not per trial:
// staging-disconnect-trigger.ts, scoped to the per-connection disconnect and
// reconnect slots, which database.rules.json caps at 40 writes per session.
// It keeps the researcher's live-sessions dashboard current; this sweep is
// what corrects that mirror when anything along the way was lost. Read its
// header before adding another.)
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
import queueUpload, { queueDocIdFor } from "./queue-upload.js";
import { uploadPathFor } from "./metadata-derived-files.js";
import { ExperimentData } from "./interfaces.js";
import { mapWithConcurrency } from "./concurrency-limit.js";
import {
  assembleSession,
  countOpenSessions,
  discardSession,
  getOpenSession,
  getSessionMeta,
  listOldestOpenSessions,
  listOpenSessions,
  partialFilenameFor,
  reconcileOpenSessionCounts,
  OpenSession,
  OpenSessionsCursor,
  ABANDON_GRACE_MS,
  disconnectedSince,
} from "./staging.js";
import { reconcileLiveSessions, MAX_RECONCILE } from "./live-sessions.js";

// Re-exported for the emulator suite, which ages its fixtures against it.
// Defined in staging-assembly.ts, next to the other limits the plugin and the
// rules have to agree with.
export { ABANDON_GRACE_MS };


// Process at most this many sessions per run, to stay inside the time and
// memory limits. Same constant and same reasoning as
// scheduled-pending-recovery.ts's MAX_FILES_PER_RUN.
const MAX_SESSIONS_PER_RUN = 10;

// Candidates read PER PAGE. More than can be processed from a single page,
// because most of the oldest open sessions on a busy deployment are LIVE
// rather than abandoned and are skipped without costing anything but a meta
// read. Mirrors the `maxResults: MAX_FILES_PER_RUN * 2` in the pending sweep.
//
// THIS IS A PAGE SIZE, NOT A PER-RUN CAP. A single page used to be the whole
// candidate set: if the CANDIDATES_PER_PAGE oldest open sessions were all
// long-lived or zombie (their onDisconnect never fired, their tab is still
// technically open, whatever the reason), every one of them was skipped as
// live, the cursor never advanced, and everything ABANDONED behind them in
// the queue waited -- potentially for the full 24-hour TTL -- because nothing
// ever looked past position CANDIDATES_PER_PAGE. Paging past a skipped page is
// what fixes that; see the loop in sweepAbandonedSessions.
const CANDIDATES_PER_PAGE = MAX_SESSIONS_PER_RUN * 3;

// Hard ceiling on pages fetched in one run, independent of how many sessions
// get skipped as live. Without this, a deployment with thousands of
// simultaneously live (not abandoned) sessions would have the sweep page
// through the entire table every five minutes looking for the few that are
// actually abandoned -- bounded work turning unbounded. 20 pages of
// CANDIDATES_PER_PAGE (30) is 600 sessions inspected per run at the most, which
// keeps a run's RTDB reads bounded the same way MAX_SESSIONS_PER_RUN bounds
// its writes.
const MAX_PAGES_PER_RUN = 20;

// How many getSessionMeta calls the live-sessions reconciliation pass runs at
// once. Was an unbounded `Promise.all` over up to MAX_RECONCILE (500) open
// sessions; RTDB does not bill operations, so this was never a cost problem,
// but nothing bounded how many reads one 256MiB instance had in flight
// together. See concurrency-limit.ts.
const RECONCILE_CONCURRENCY = 20;

export interface SweepStats {
  candidates: number;
  recovered: number;
  discarded: number;
  skippedLive: number;
  errors: number;
  /** Candidate pages fetched this run (see CANDIDATES_PER_PAGE / MAX_PAGES_PER_RUN). */
  pages: number;
  /**
   * Live-sessions mirror documents this run had to create, correct or delete.
   * Should be zero: each one is a write on the session lifecycle that failed or
   * was lost. A value that stays non-zero run after run is a broken write path.
   */
  mirrorFixed: number;
  /**
   * openSessionCounts entries this run had to correct against the RTDB ground
   * truth -- the per-experiment concurrency cap's drift-tolerance backstop
   * (see reconcileOpenSessionCounts in staging.ts). Should be zero for the
   * same reason mirrorFixed should: each fix is evidence a decrement was
   * missed somewhere upstream.
   */
  countersFixed: number;
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
    pages: 0,
    mirrorFixed: 0,
    countersFixed: 0,
  };
  let lastError: string | null = null;
  let openSessionCount: number | null = null;
  let mirror = { created: 0, updated: 0, deleted: 0 };
  // The experiments this run's candidates belong to -- the scope for
  // reconcileOpenSessionCounts below. Populated even for candidates that turn
  // out to be live and get skipped: a live session still proves its
  // experiment's counter is worth checking this run, on the same paged,
  // bounded-per-run window the candidate loop below already applies to the
  // sessions themselves (CANDIDATES_PER_PAGE / MAX_PAGES_PER_RUN).
  const candidateExperimentIds = new Set<string>();

  // `only`-scoped runs (tests) can stop as soon as every id they care about
  // has been seen, rather than paging until the whole (possibly large, shared
  // emulator) table is exhausted. Production runs (`only` undefined) always
  // page until one of the other three stopping conditions below fires.
  const pending = only ? new Set(only) : null;

  try {
    const now = Date.now();
    let cursor: OpenSessionsCursor | undefined;

    pageLoop: for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const rawPage = await listOldestOpenSessions(CANDIDATES_PER_PAGE, cursor);
      if (rawPage.length === 0) break;
      stats.pages++;

      // Advance the cursor off the RAW page (not the `only`-filtered one)
      // regardless of whether anything on it matched -- this is what lets a
      // wall of skipped-or-out-of-scope candidates be paged PAST instead of
      // re-read forever. See CANDIDATES_PER_PAGE's comment.
      const lastRow = rawPage[rawPage.length - 1];
      cursor = { expiresAt: lastRow.expiresAt, sessionId: lastRow.sessionId };

      const pageCandidates = only ? rawPage.filter((s) => only.has(s.sessionId)) : rawPage;
      stats.candidates += pageCandidates.length;
      // Populated even for candidates that turn out to be live and get
      // skipped below: a live session still proves its experiment's counter
      // is worth checking this run, on the same rotating (page-at-a-time)
      // window this loop already applies to the sessions themselves.
      for (const s of pageCandidates) candidateExperimentIds.add(s.experimentId);

      for (const session of pageCandidates) {
        if (stats.recovered + stats.discarded >= MAX_SESSIONS_PER_RUN) break pageLoop;

        try {
          const meta = await getSessionMeta(session.sessionId);

          const since = disconnectedSince(meta);
          const abandoned = since !== null && now - since >= ABANDON_GRACE_MS;
          // The backstop, for a client that died before it could register an
          // onDisconnect at all, or one whose onDisconnect Firebase never ran.
          // Without it such a session would sit in RTDB forever, being paid for.
          const expired =
            typeof session.expiresAt === "number" && now >= session.expiresAt;

          if (!abandoned && !expired) {
            stats.skippedLive++;
            pending?.delete(session.sessionId);
            continue;
          }

          const result = await recoverSession(session);
          if (result.discardOk) {
            if (result.status === "recovered") stats.recovered++;
            else stats.discarded++;
          } else {
            // The queue write (if any) happened, but the staging node is
            // STILL THERE -- discardSession returned false rather than
            // throwing. Reporting this as "recovered" or "discarded" would
            // describe cleanup that has not actually happened: the session
            // will surface again as a candidate next run (still open, still
            // abandoned) and, if it was already queued, recoverSession's own
            // dedup check is what stops that from becoming a duplicate
            // delivery -- not this branch. Counted as an error so a discard
            // path that is silently and persistently failing is visible in
            // systemStatus/staging instead of being folded into "recovered".
            console.error(
              `Staging session ${session.sessionId} was ${result.status} but its RTDB node ` +
                `could not be removed; it remains staged and will be retried next run.`
            );
            stats.errors++;
          }
          pending?.delete(session.sessionId);
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
          pending?.delete(session.sessionId);
        }
      }

      if (rawPage.length < CANDIDATES_PER_PAGE) break; // table exhausted
      if (pending && pending.size === 0) break; // everything in scope was found
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : "Unknown error";
    console.error(`Staging sweep failed: ${lastError}`);
    stats.errors++;
  }

  // Reconcile the live-sessions mirror against the truth. AFTER recovery, so
  // the sessions just recovered or discarded are already gone from both sides
  // and are not counted as fixes. A separate try: a mirror failure must not
  // be what stops abandoned sessions being recovered, and vice versa.
  let openSessionsForCounters: OpenSession[] = [];
  try {
    const readAt = Date.now();
    const open = await listOpenSessions();
    openSessionCount = open.length;
    openSessionsForCounters = open;
    const inScope = (only ? open.filter((s) => only.has(s.sessionId)) : open).slice(0, MAX_RECONCILE);
    // Bounded, not `Promise.all`: up to MAX_RECONCILE (500) sessions here, and
    // nothing should put 500 concurrent RTDB reads in flight from one 256MiB
    // instance at once. See concurrency-limit.ts.
    const entries = await mapWithConcurrency(inScope, RECONCILE_CONCURRENCY, async (session) => ({
      session,
      meta: await getSessionMeta(session.sessionId),
    }));

    // Only for sessions opened before owner was recorded on openSessions; one
    // read per experiment per run.
    const owners = new Map<string, string | null>();
    const ownerOf = async (experimentId: string) => {
      if (!owners.has(experimentId)) {
        const doc = await db.collection("experiments").doc(experimentId).get();
        owners.set(experimentId, doc.exists ? ((doc.data() as ExperimentData).owner ?? null) : null);
      }
      return owners.get(experimentId) ?? null;
    };
    const stillOpen = async (sessionId: string) => (await getOpenSession(sessionId)) !== null;

    mirror = await reconcileLiveSessions(entries, readAt, ownerOf, stillOpen, only);
    stats.mirrorFixed = mirror.created + mirror.updated + mirror.deleted;
    if (stats.mirrorFixed > 0) {
      console.warn(
        `Live-sessions mirror needed ${stats.mirrorFixed} fix(es): ` +
          `${mirror.created} created, ${mirror.updated} corrected, ${mirror.deleted} removed.`
      );
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : "Unknown error";
    console.error(`Live-sessions reconciliation failed: ${lastError}`);
    stats.errors++;
  }

  // Correct the per-experiment concurrency counters (staging.ts's
  // openSessionCounts) for the experiments touched this run. A separate try,
  // for the same reason as the mirror above: a counter-reconciliation failure
  // must not be what stops the mirror or the recovery pass, or vice versa.
  // Scoped to candidateExperimentIds rather than every experiment with an open
  // session, both to keep this bounded (the same paged, bounded-per-run
  // reasoning as CANDIDATES_PER_PAGE / MAX_PAGES_PER_RUN) and to keep a
  // test's scoped sweep run from correcting a counter belonging to a
  // different, concurrently-running test.
  try {
    stats.countersFixed = await reconcileOpenSessionCounts(
      candidateExperimentIds,
      openSessionsForCounters
    );
    if (stats.countersFixed > 0) {
      console.warn(
        `Open-session concurrency counters needed ${stats.countersFixed} fix(es).`
      );
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : "Unknown error";
    console.error(`Open-session counter reconciliation failed: ${lastError}`);
    stats.errors++;
  }

  await recordSweepHealth(stats, lastError, openSessionCount, mirror);

  if (stats.recovered > 0 || stats.discarded > 0) {
    console.log(
      `Staging sweep: recovered ${stats.recovered}, discarded ${stats.discarded}, ` +
        `skipped ${stats.skippedLive} live of ${stats.candidates} candidates.`
    );
  }

  return stats;
}

/** What became of one candidate session, and whether its RTDB node is actually gone. */
export interface RecoverResult {
  /** "recovered" when a queue entry was written this run, "discarded" otherwise. */
  status: "recovered" | "discarded";
  /**
   * Whether discardSession actually removed the staging node. When false, the
   * session is still open and will reappear as a candidate next run -- see
   * discardSession's own doc comment for why this matters more for
   * "recovered" than for "discarded".
   */
  discardOk: boolean;
}

/**
 * Turn one abandoned session into a queued partial upload, or discard it.
 *
 * "Discarded" means the session was dropped without a queue entry.
 * "Recovered" means one was written. Either way this function ATTEMPTS to
 * remove the staging node before returning, but does not assume it succeeded
 * -- see `discardOk` and discardSession's doc comment. A session whose discard
 * failed is not lost: it stays in openSessions and is picked up again next
 * run, and the completed-queue-entry check below is what makes that safe to
 * retry rather than a source of duplicate deliveries.
 */
export async function recoverSession(
  session: OpenSession
): Promise<RecoverResult> {
  const { sessionId, experimentId } = session;

  const expDoc = await db.collection("experiments").doc(experimentId).get();
  if (!expDoc.exists) {
    console.warn(
      `Staging session ${sessionId} belongs to missing experiment ${experimentId}; discarding.`
    );
    return { status: "discarded", discardOk: await discardSession(sessionId) };
  }

  const expData = expDoc.data() as ExperimentData;

  if (!expData.owner) {
    console.warn(
      `Experiment ${experimentId} has no owner; discarding staging session ${sessionId}.`
    );
    return { status: "discarded", discardOk: await discardSession(sessionId) };
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
    return { status: "discarded", discardOk: await discardSession(sessionId) };
  }

  if (!expData.active) {
    console.log(
      `Experiment ${experimentId} is not collecting; discarding staging session ${sessionId}.`
    );
    return { status: "discarded", discardOk: await discardSession(sessionId) };
  }

  const assembled = await assembleSession(sessionId);

  // Nothing was ever staged: a session that opened and closed without a single
  // flush. Common and uninteresting -- a participant who loaded the page and
  // left. There is no data to recover and an empty file would be noise in the
  // researcher's dataset.
  if (assembled.trialCount === 0) {
    return { status: "discarded", discardOk: await discardSession(sessionId) };
  }

  const filename = partialFilenameFor(session);
  // Layout-aware, exactly as promoteToQueue is: a metadata-active experiment
  // stores its raw file under data/raw/. Recovered sessions get no metadata or
  // derived files regenerated -- this path has no metadata pipeline, and the
  // raw file is the source of truth -- the same documented limitation the
  // pending-recovery sweep carries.
  const uploadFilename = uploadPathFor(expData.metadataActive, filename);

  // partialFilenameFor is a PURE function of the session -- same session id,
  // same filename, every time. So if an earlier run already queued this exact
  // session and that entry has since COMPLETED (the retry worker delivered
  // it), the only reason this session is still here to be recovered again is
  // that its discardSession call failed afterwards (see discardSession's doc
  // comment). Re-queueing would land a second copy of the same partial with
  // the provider: queueUpload's own dedup logic only special-cases "pending"
  // and "processing" entries, and a "completed" one falls through and gets
  // freshly re-queued. Checking here, before the call, is what stops that.
  const docId = queueDocIdFor(experimentId, uploadFilename);
  const existing = await db.collection("uploadQueue").doc(docId).get();
  if (existing.exists && existing.data()?.status === "completed") {
    console.warn(
      `Staging session ${sessionId} already delivered as uploadQueue/${docId}; ` +
        `skipping re-queue and just clearing the leftover staging node.`
    );
    return { status: "discarded", discardOk: await discardSession(sessionId) };
  }

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

  return { status: "recovered", discardOk: await discardSession(sessionId) };
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
  lastError: string | null,
  openSessionCountAfterRun: number | null,
  mirror: { created: number; updated: number; deleted: number }
): Promise<void> {
  try {
    // Read AFTER the run, so the number reflects what is still sitting in
    // RTDB rather than what was there when the run started. This is the figure
    // that grows without bound when the sweep is broken. The reconciliation
    // pass already read it; only a run whose reconciliation failed reads again.
    const openSessionCount = openSessionCountAfterRun ?? (await countOpenSessions());
    await db
      .collection("systemStatus")
      .doc("staging")
      .set(
        {
          lastRunAt: Timestamp.now(),
          openSessionCount,
          candidates: stats.candidates,
          pages: stats.pages,
          recovered: stats.recovered,
          discarded: stats.discarded,
          skippedLive: stats.skippedLive,
          errors: stats.errors,
          mirrorFixed: stats.mirrorFixed,
          countersFixed: stats.countersFixed,
          mirror,
          lastError,
        },
        { merge: true }
      );
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(`Failed to record staging sweep health: ${detail}`);
  }
}
