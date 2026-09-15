/**
 * @jest-environment node
 *
 * Pure constant-relationship tests for collision-cache.ts's rehydration
 * lease. No Firestore emulator involved -- see rehydrate() in
 * functions/src/collision-cache.ts for the mechanism these constants govern,
 * and functions/src/__tests__/collision-cache.test.js (emulator-backed) for
 * behavioral coverage of acquisition/takeover.
 */

import {
  REHYDRATION_LEASE_MS,
  REHYDRATION_HEARTBEAT_MS,
} from '../../lib/collision-cache.js';

// apiData / apiBase64's timeoutSeconds (functions/src/api-data.ts,
// functions/src/api-base64.ts). Not imported from the built function options
// here because pulling in api-data.js/api-base64.js just to read a number
// would drag in every dependency the participant-submission path has; the
// value is asserted directly against those files in
// function-capacity-options.test.js, and re-asserted as a literal here so a
// change to one without the other fails loudly in whichever test runs first.
const FUNCTION_TIMEOUT_SECONDS = 300;
const FUNCTION_TIMEOUT_MS = FUNCTION_TIMEOUT_SECONDS * 1000;

describe('REHYDRATION_LEASE_MS vs. the function timeout', () => {
  it('outlives the longest request that could hold it, with a real margin', () => {
    // The lease is written once, at acquisition (rehydrate() in
    // collision-cache.ts), and must not expire before Cloud Run would kill a
    // legitimately still-running holder -- otherwise a second request treats
    // a live rehydration as abandoned and starts a redundant one of its own.
    expect(REHYDRATION_LEASE_MS).toBeGreaterThan(FUNCTION_TIMEOUT_MS);

    // "A real margin", not just technically greater: at least 10 seconds, to
    // absorb the acquisition transaction's own round trip and clock skew
    // between this process and Cloud Run's timeout enforcement.
    const MIN_MARGIN_MS = 10 * 1000;
    expect(REHYDRATION_LEASE_MS - FUNCTION_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_MARGIN_MS);
  });
});

describe('REHYDRATION_HEARTBEAT_MS vs. REHYDRATION_LEASE_MS', () => {
  it('is much shorter than the lease, so a dead holder is detected long before the lease would otherwise expire', () => {
    // Without a heartbeat, raising REHYDRATION_LEASE_MS to outlive the
    // function timeout would let a DEAD holder (one that never runs a
    // `finally` block because its instance was hard-killed) block every
    // other request against the experiment for the full lease -- worse than
    // before this change, not better. The heartbeat must cut that stall back
    // down to something close to the old 60-second lease, not merely below
    // the new one.
    expect(REHYDRATION_HEARTBEAT_MS).toBeLessThan(REHYDRATION_LEASE_MS);
    expect(REHYDRATION_HEARTBEAT_MS).toBeLessThanOrEqual(60 * 1000);
  });

  it('is comfortably longer than a single 500-document batch commit should ever take', () => {
    // rehydrate() renews the heartbeat once per 500-document batch (plus
    // around the listFiles() call). If the interval were shorter than a
    // realistic batch-commit latency, a live holder mid-commit would
    // routinely appear dead to other requests. A generous floor here is a
    // proxy for "not accidentally tiny".
    expect(REHYDRATION_HEARTBEAT_MS).toBeGreaterThanOrEqual(10 * 1000);
  });
});
