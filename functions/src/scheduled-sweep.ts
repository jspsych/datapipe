// One scheduled function, replacing four.
//
// `test`/`main` used to deploy scheduledUploadRetry (*/5), scheduledStagingSweep
// (*/5), scheduledMailRetry (*/10) and scheduledPendingRecovery (*/15) as four
// separate Cloud Functions -- each with its own instance pool AND its own Cloud
// Scheduler job. Cloud Scheduler gives only 3 free jobs per billing account, and
// scheduledTokenRefresh (weekly, untouched -- see scheduled-token-refresh.ts)
// made a fifth. Folding the four frequent sweeps into this single function,
// triggered by a single Cloud Scheduler job on the fastest cadence any of them
// needed (5 minutes), stays under that quota while every job keeps its own
// cadence via `jobsDueAt` below.
//
// 512MiB, not 256MiB: each job used to get its own 256MiB heap. Now they share
// one instance's heap, and the two heaviest -- upload-retry (re-uploads queued
// payloads, holding a payload's bytes in memory) and the staging sweep
// (assembles sessions up to MAX_ASSEMBLED_BYTES, 24MiB, in staging.ts) -- can
// both have live allocations in the same process across a run. 512MiB gives
// that headroom without assuming they never overlap.
//
// TRADEOFF: a slow upload-retry pass delays the jobs that run after it in the
// same invocation (staging sweep runs first now -- see runSweep's ordering
// comment in scheduled-sweep-core.ts -- but mail retry and pending recovery
// still wait behind upload-retry). timeoutSeconds: 540 (Cloud Functions v2's
// practical scheduled-function ceiling) is the backstop: if the whole sequence
// ever ran that long, this file's own try/catch structure (in runSweep) has
// already let every job before the slow one finish and been recorded, and the
// invocation itself is what Cloud Logging marks as failed. Slow, not silently
// dropped.
//
// The pure gating and orchestration (`jobsDueAt`, `runSweep`) live in
// scheduled-sweep-core.ts, which imports nothing from ./app.js -- see that
// file's header for why, and scheduled-sweep-core.test.ts for the unit test
// this split makes possible without an emulator.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { jobsDueAt, runSweep } from "./scheduled-sweep-core.js";
import { runStagingSweep } from "./scheduled-staging-sweep.js";
import { runUploadRetry } from "./scheduled-upload-retry.js";
import { runMailRetry } from "./scheduled-mail-retry.js";
import { runPendingRecovery } from "./scheduled-pending-recovery.js";

export const scheduledSweep = onSchedule(
  { schedule: "*/5 * * * *", memory: "512MiB", timeoutSeconds: 540 },
  async (event) => {
    // scheduleTime is documented as always populated (real schedule fires
    // give the Cloud Scheduler job's schedule time; a manual trigger gives
    // the execution time) -- but it is untyped input from outside this
    // process, so this falls back rather than letting an unparseable or
    // absent value silently skip every gated job for the tick.
    const scheduledAt = event.scheduleTime ? new Date(event.scheduleTime) : new Date();
    const due = jobsDueAt(scheduledAt);

    await runSweep(
      {
        stagingSweep: runStagingSweep,
        uploadRetry: runUploadRetry,
        mailRetry: runMailRetry,
        pendingRecovery: runPendingRecovery,
      },
      due
    );
  }
);
