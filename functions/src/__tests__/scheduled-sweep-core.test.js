/**
 * @jest-environment node
 *
 * Pure coverage for scheduled-sweep-core.ts's `jobsDueAt` (the 5/10/15-minute
 * cadence gating) and `runSweep` (the sequential, isolate-failures
 * orchestration scheduled-sweep.ts wires the four real jobs into).
 *
 * Imports the COMPILED module (functions/lib/), so `npm run build` must run
 * first from functions/ -- same convention as backoff-arithmetic.test.js.
 * scheduled-sweep-core.js has no Firestore/Storage dependency of its own (see
 * its header comment on why it deliberately avoids importing app.js), so no
 * emulator host needs to be set and this suite needs no emulator to run.
 */

const { jobsDueAt, runSweep } = require("../../lib/scheduled-sweep-core.js");

// A UTC date at an arbitrary day/hour, with only the minutes varying between
// cases -- jobsDueAt only ever looks at getUTCMinutes().
function atMinute(minutes) {
  return new Date(Date.UTC(2026, 0, 1, 12, minutes, 0));
}

describe("jobsDueAt", () => {
  test("mailRetry is due every 10 minutes, floored to the 5-minute slot", () => {
    expect(jobsDueAt(atMinute(0)).mailRetry).toBe(true);
    expect(jobsDueAt(atMinute(10)).mailRetry).toBe(true);
    expect(jobsDueAt(atMinute(20)).mailRetry).toBe(true);
    expect(jobsDueAt(atMinute(30)).mailRetry).toBe(true);
    expect(jobsDueAt(atMinute(5)).mailRetry).toBe(false);
    expect(jobsDueAt(atMinute(15)).mailRetry).toBe(false);
    expect(jobsDueAt(atMinute(25)).mailRetry).toBe(false);
  });

  test("pendingRecovery is due every 15 minutes, floored to the 5-minute slot", () => {
    expect(jobsDueAt(atMinute(0)).pendingRecovery).toBe(true);
    expect(jobsDueAt(atMinute(15)).pendingRecovery).toBe(true);
    expect(jobsDueAt(atMinute(30)).pendingRecovery).toBe(true);
    expect(jobsDueAt(atMinute(45)).pendingRecovery).toBe(true);
    expect(jobsDueAt(atMinute(5)).pendingRecovery).toBe(false);
    expect(jobsDueAt(atMinute(10)).pendingRecovery).toBe(false);
    expect(jobsDueAt(atMinute(20)).pendingRecovery).toBe(false);
  });

  test("both are due at :00, :30 (their common multiple within the hour)", () => {
    expect(jobsDueAt(atMinute(0))).toEqual({ mailRetry: true, pendingRecovery: true });
    expect(jobsDueAt(atMinute(30))).toEqual({ mailRetry: true, pendingRecovery: true });
  });

  test("floors rather than exact-matches: a delivery a few minutes into a slot still counts as that slot", () => {
    // :10:03 must still read as the :10 slot (mailRetry due), not fall
    // between gates and run neither job for the tick.
    expect(jobsDueAt(atMinute(10 + 3)).mailRetry).toBe(true);
    // :15:04 must still read as the :15 slot (pendingRecovery due).
    expect(jobsDueAt(atMinute(15 + 4)).pendingRecovery).toBe(true);
  });

  test("neither is due at :05, :25, :35, :55", () => {
    for (const m of [5, 25, 35, 55]) {
      expect(jobsDueAt(atMinute(m))).toEqual({ mailRetry: false, pendingRecovery: false });
    }
  });

  test("an Invalid Date falls back to the wall clock instead of skipping both gated jobs", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:30:02Z"));
    try {
      expect(jobsDueAt(new Date("not a timestamp"))).toEqual({ mailRetry: true, pendingRecovery: true });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("runSweep", () => {
  function makeJobs(overrides = {}) {
    return {
      stagingSweep: jest.fn().mockResolvedValue(undefined),
      uploadRetry: jest.fn().mockResolvedValue(undefined),
      mailRetry: jest.fn().mockResolvedValue(undefined),
      pendingRecovery: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  const ALL_DUE = { mailRetry: true, pendingRecovery: true };
  const NONE_DUE = { mailRetry: false, pendingRecovery: false };

  test("runs staging sweep and upload retry every tick, in that order", async () => {
    const calls = [];
    const jobs = makeJobs({
      stagingSweep: jest.fn().mockImplementation(async () => calls.push("stagingSweep")),
      uploadRetry: jest.fn().mockImplementation(async () => calls.push("uploadRetry")),
    });

    await runSweep(jobs, NONE_DUE);

    expect(calls).toEqual(["stagingSweep", "uploadRetry"]);
    expect(jobs.mailRetry).not.toHaveBeenCalled();
    expect(jobs.pendingRecovery).not.toHaveBeenCalled();
  });

  test("runs the gated jobs, after the two always-on jobs, only when due", async () => {
    const calls = [];
    const jobs = makeJobs({
      stagingSweep: jest.fn().mockImplementation(async () => calls.push("stagingSweep")),
      uploadRetry: jest.fn().mockImplementation(async () => calls.push("uploadRetry")),
      mailRetry: jest.fn().mockImplementation(async () => calls.push("mailRetry")),
      pendingRecovery: jest.fn().mockImplementation(async () => calls.push("pendingRecovery")),
    });

    await runSweep(jobs, ALL_DUE);

    expect(calls).toEqual(["stagingSweep", "uploadRetry", "mailRetry", "pendingRecovery"]);
  });

  test("one job throwing does not stop the others from running", async () => {
    const jobs = makeJobs({
      uploadRetry: jest.fn().mockRejectedValue(new Error("boom")),
    });

    await expect(runSweep(jobs, ALL_DUE)).rejects.toThrow();

    expect(jobs.stagingSweep).toHaveBeenCalledTimes(1);
    expect(jobs.uploadRetry).toHaveBeenCalledTimes(1);
    expect(jobs.mailRetry).toHaveBeenCalledTimes(1);
    expect(jobs.pendingRecovery).toHaveBeenCalledTimes(1);
  });

  test("throws a single summary error naming every job that failed", async () => {
    const jobs = makeJobs({
      stagingSweep: jest.fn().mockRejectedValue(new Error("staging boom")),
      pendingRecovery: jest.fn().mockRejectedValue(new Error("recovery boom")),
    });

    let caught;
    try {
      await runSweep(jobs, ALL_DUE);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toContain("stagingSweep");
    expect(caught.message).toContain("pendingRecovery");
    expect(caught.message).not.toContain("uploadRetry failed");
    expect(caught.message).not.toContain("mailRetry failed");
  });

  test("resolves cleanly when every job succeeds", async () => {
    await expect(runSweep(makeJobs(), ALL_DUE)).resolves.toBeUndefined();
  });

  test("a gated job that is not due this tick is never invoked, even if it would have thrown", async () => {
    const jobs = makeJobs({
      mailRetry: jest.fn().mockRejectedValue(new Error("should never run")),
      pendingRecovery: jest.fn().mockRejectedValue(new Error("should never run")),
    });

    await expect(runSweep(jobs, NONE_DUE)).resolves.toBeUndefined();
    expect(jobs.mailRetry).not.toHaveBeenCalled();
    expect(jobs.pendingRecovery).not.toHaveBeenCalled();
  });
});
