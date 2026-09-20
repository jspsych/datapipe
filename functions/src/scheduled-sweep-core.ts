// The pure orchestration and cadence-gating logic behind scheduled-sweep.ts,
// deliberately split into its own module that imports nothing from ./app.js.
//
// Anything that imports app.js (directly or transitively) runs
// firebase-admin's initializeApp() at MODULE LOAD TIME, which tries to reach
// real GCP -- or hangs -- when no emulator is configured. The four job
// modules this sweep wires together (scheduled-staging-sweep.ts and friends)
// all import app.js, so a unit test for the orchestration itself must not
// import them either. Keeping `jobsDueAt` and `runSweep` here, taking the
// real jobs as plain functions, is what lets both be tested with no emulator
// and no module mocking -- see scheduled-sweep-core.test.ts.

/** Which of the two gated jobs are due on a given invocation. */
export interface JobsDue {
  mailRetry: boolean;
  pendingRecovery: boolean;
}

/**
 * Decide which gated jobs run on this tick of the 5-minute cron.
 *
 * Every invocation of scheduled-sweep runs the staging sweep and the upload
 * retry (they need the full 5-minute cadence). Mail retry only needs every
 * 10 minutes and pending recovery only every 15 -- so rather than running a
 * dedicated Cloud Scheduler job for each (only 3 scheduler jobs are free per
 * billing account, and this consolidation exists to stay under that), this
 * function decides whether the current tick is also a mail-retry tick and/or
 * a pending-recovery tick.
 *
 * Gated on the invocation's SCHEDULED time, not a counter: Cloud Functions
 * instances are stateless (may be cold-started on any tick, may serve
 * several), so there is nowhere to keep a running count that survives
 * between invocations. The scheduled time is the only thing every
 * invocation can independently derive the same answer from.
 *
 * Floors to the 5-minute slot rather than requiring an exact match on the
 * minute, because Cloud Scheduler does not guarantee the function receives
 * the request at exactly :00, :05, :10, ... -- a delivery at :10:03 must
 * still count as the :10 slot, or it would fall through both gates and the
 * job would simply not run that tick.
 */
export function jobsDueAt(date: Date): JobsDue {
  // An unparseable scheduleTime arrives here as an Invalid Date, whose NaN
  // minutes fail BOTH modulo checks -- the gated jobs would silently not run.
  // Fall back to the wall clock, which is at worst a few seconds off the slot.
  if (Number.isNaN(date.getTime())) {
    date = new Date();
  }
  const slot = Math.floor(date.getUTCMinutes() / 5) * 5;
  return {
    mailRetry: slot % 10 === 0,
    pendingRecovery: slot % 15 === 0,
  };
}

/** The four consolidated jobs, as plain functions -- see scheduled-sweep.ts. */
export interface SweepJobs {
  stagingSweep: () => Promise<unknown>;
  uploadRetry: () => Promise<unknown>;
  mailRetry: () => Promise<unknown>;
  pendingRecovery: () => Promise<unknown>;
}

// Only log a per-job timing line when a job ran long enough to be worth
// knowing about -- this codebase avoids noisy logs on the no-op path (see
// e.g. scheduled-mail-retry.ts's `if (report.scanned > 0 || report.paused)`).
// 30s is well under the 540s budget but well above what any of these four
// jobs take on a normal, mostly-empty pass.
const SLOW_JOB_MS = 30_000;

/**
 * Run the four jobs SEQUENTIALLY -- not Promise.all/allSettled. They now
 * share one 512MiB instance (see scheduled-sweep.ts's header on why that
 * memory figure), and running them concurrently would mean their peak heaps
 * stack instead of being reclaimed between jobs. Sequential also keeps
 * provider request load the same as when each job was its own function.
 *
 * Order: staging sweep, upload retry (+ cleanup), then the two gated jobs.
 * Staging sweep feeds the upload queue (it hands recovered sessions to
 * queueUpload), so running it first means a session recovered this tick can
 * be picked up by the SAME tick's upload-retry pass instead of waiting for
 * the next one. This actually holds, not just in theory: queueUpload's
 * attemptImmediately (set by scheduled-staging-sweep.ts's recoverSession)
 * gives a recovered entry nextRetryAt = now rather than the ordinary 1-hour
 * default, so it is within scheduled-upload-retry.ts's
 * `where("nextRetryAt", "<=", now)` window the moment upload retry runs a few
 * lines below in this same invocation -- see queue-upload.ts's
 * firstRetryDelayMs comment for why that default would otherwise defeat the
 * ordering described here.
 *
 * Each job runs in its own try/catch: one job throwing must never prevent
 * the others from running, since they are otherwise-unrelated cleanup
 * passes over disjoint data. Errors are logged with the job's name via
 * console.error as they happen. After every job has had its turn, if any
 * failed, this throws ONE summary error naming all of them -- so the
 * invocation is still recorded as failed in Cloud Logging/monitoring,
 * without needing (and without adding) the scheduler's own retry, which
 * would replay every job, including the ones that already succeeded.
 */
export async function runSweep(jobs: SweepJobs, due: JobsDue): Promise<void> {
  const failed: string[] = [];

  const run = async (name: string, job: () => Promise<unknown>) => {
    const start = Date.now();
    try {
      await job();
      const elapsedMs = Date.now() - start;
      if (elapsedMs > SLOW_JOB_MS) {
        console.log(`scheduled-sweep: ${name} took ${elapsedMs}ms`);
      }
    } catch (e) {
      // The error itself, not just its message: the stack is the only thing
      // that says WHERE in a several-hundred-line job it came from.
      console.error(`scheduled-sweep: ${name} failed:`, e);
      failed.push(name);
    }
  };

  await run("stagingSweep", jobs.stagingSweep);
  await run("uploadRetry", jobs.uploadRetry);
  if (due.mailRetry) await run("mailRetry", jobs.mailRetry);
  if (due.pendingRecovery) await run("pendingRecovery", jobs.pendingRecovery);

  if (failed.length > 0) {
    throw new Error(`scheduled-sweep: ${failed.length} job(s) failed: ${failed.join(", ")}`);
  }
}
