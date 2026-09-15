/**
 * @jest-environment node
 *
 * Pure coverage for computeBackoffMs (functions/src/upload-backoff.ts), the
 * tiered exponential backoff scheduled-upload-retry.ts's handleRetryFailure
 * uses to set an upload-queue item's nextRetryAt.
 *
 * These replace the "handleRetryFailure backoff" and
 * "scheduled-upload-retry tiered backoff arithmetic" hollow tests that used
 * to live in upload-queue.test.js: those declared their own local
 * MAX_BACKOFF_MS / FAST_MAX_BACKOFF_MS / SLOW_MAX_BACKOFF_MS and asserted one
 * spelling of the formula equalled another, so changing the production cap,
 * base, or Math.min argument order left them green. computeBackoffMs is now
 * exported (from a standalone module specifically so this file can import it
 * without pulling in providers/index.js's module-scope `node-fetch` imports
 * or app.js's Firestore/Storage clients), so these assert its real output.
 *
 * Imports the COMPILED module (functions/lib/), so `npm run build` must run
 * first from functions/. No emulator host is set -- upload-backoff.js has no
 * Firestore/Storage dependency of its own; it only reaches queue-upload.js
 * for isFastRetry, which app.js's module-scope initializeApp() tolerates
 * with no project configuration since nothing here ever calls Firestore.
 */

const {
  computeBackoffMs,
  MAX_BACKOFF_MS,
  FAST_MAX_BACKOFF_MS,
} = require("../../lib/upload-backoff.js");

describe("computeBackoffMs — slow tier (no code, or an unrecognized one)", () => {
  test("doubles each retry: ~2, 4, 8, 16 hours before the cap", () => {
    const expectedHours = [2, 4, 8, 16];
    for (let retryCount = 1; retryCount <= 4; retryCount++) {
      expect(computeBackoffMs(retryCount, null)).toBe(expectedHours[retryCount - 1] * 60 * 60 * 1000);
    }
  });

  test("is capped at 24 hours, including well past the boundary", () => {
    // retryCount 5 => 2^5 = 32h, just past the cap.
    expect(computeBackoffMs(5, null)).toBe(MAX_BACKOFF_MS);
    // retryCount 10 => 2^10 = 1024h, the cap must still bind, not merely
    // happen to equal the boundary case above.
    expect(computeBackoffMs(10, null)).toBe(MAX_BACKOFF_MS);
    expect(MAX_BACKOFF_MS).toBe(24 * 60 * 60 * 1000);
  });

  test("an unknown providerErrorCode falls to the slow tier, same as no code at all", () => {
    expect(computeBackoffMs(2, "SOME_FUTURE_PROVIDER_CODE")).toBe(computeBackoffMs(2, null));
    expect(computeBackoffMs(2, "SOME_FUTURE_PROVIDER_CODE")).toBe(4 * 60 * 60 * 1000);
  });

  test("undefined and null both read as the slow tier", () => {
    expect(computeBackoffMs(1, undefined)).toBe(computeBackoffMs(1, null));
  });
});

describe("computeBackoffMs — fast tier (CONTENTION)", () => {
  test("doubles each retry in minutes and is capped at 30 minutes, including well past the boundary", () => {
    const expectedMinutes = [2, 4, 8, 16, 30];
    for (let retryCount = 1; retryCount <= 5; retryCount++) {
      expect(computeBackoffMs(retryCount, "CONTENTION")).toBe(expectedMinutes[retryCount - 1] * 60 * 1000);
    }
    // retryCount 10 => 2^10 minutes, the fast cap must still bind.
    expect(computeBackoffMs(10, "CONTENTION")).toBe(FAST_MAX_BACKOFF_MS);
    expect(FAST_MAX_BACKOFF_MS).toBe(30 * 60 * 1000);
  });
});

describe("computeBackoffMs — Retry-After", () => {
  test("is honored over the tiered exponential value", () => {
    expect(computeBackoffMs(2, null, 120)).toBe(120 * 1000);
  });

  test("larger than the absolute cap is clamped to it, even on the fast tier", () => {
    // 3600s is bigger than FAST_MAX_BACKOFF_MS (1800s) but smaller than
    // MAX_BACKOFF_MS -- clamping to the item's tier cap here would schedule a
    // retry the provider already said would fail before it is due.
    expect(computeBackoffMs(1, "CONTENTION", 3600)).toBe(3600 * 1000);

    // ~27 hours, bigger than MAX_BACKOFF_MS itself -- clamped down to it.
    expect(computeBackoffMs(1, null, 100000)).toBe(MAX_BACKOFF_MS);
  });

  test("smaller than the tier's computed backoff still wins", () => {
    // retryCount 5 on the slow tier alone would compute to the 24h cap;
    // a 5-second Retry-After overrides that entirely, per the current rule
    // that Retry-After (when present) is used verbatim instead of compared
    // against the exponential value.
    expect(computeBackoffMs(5, null, 5)).toBe(5000);
  });

  test("of zero is falsy and falls back to the exponential formula", () => {
    // Documents the current behavior rather than prescribing it: `0 ? a : b`
    // takes the exponential branch, so a literal 0-second Retry-After is
    // indistinguishable from no header at all.
    expect(computeBackoffMs(2, null, 0)).toBe(computeBackoffMs(2, null));
  });
});
