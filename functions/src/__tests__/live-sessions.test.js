/**
 * @jest-environment node
 *
 * The pure half of the live-sessions mirror (functions/src/live-sessions.ts):
 * what a researcher's dashboard row should say, computed from the staging
 * tier's ground truth. No emulator.
 */

import { createHash } from 'crypto';
import {
  publicIdFor,
  connectionState,
  desiredMirror,
  mirrorDiff,
  readWasTruncated,
  idsToDelete,
  MAX_RECONCILE,
} from '../../lib/live-sessions.js';
import { ABANDON_GRACE_MS } from '../../lib/staging-assembly.js';

const SESSION = {
  sessionId: 'Abc123XyZ456Abc123XyZ456',
  experimentId: 'exp1',
  startedAt: 1_000_000,
  expiresAt: 2_000_000,
};

describe('publicIdFor', () => {
  it('is the first 32 hex characters of a SHA-256 of the session id', () => {
    // Recomputed here rather than trusted: this id is the only thing standing
    // between a researcher's browser and a write capability.
    const expected = createHash('sha256').update(SESSION.sessionId).digest('hex').slice(0, 32);
    expect(publicIdFor(SESSION.sessionId)).toBe(expected);
  });

  it('never contains the session id itself', () => {
    expect(publicIdFor(SESSION.sessionId)).not.toContain(SESSION.sessionId);
    expect(publicIdFor(SESSION.sessionId).toLowerCase()).not.toContain(
      SESSION.sessionId.toLowerCase().slice(0, 8)
    );
  });

  it('is deterministic, so completion and the trigger can address the doc without a read', () => {
    expect(publicIdFor('same')).toBe(publicIdFor('same'));
    expect(publicIdFor('a')).not.toBe(publicIdFor('b'));
  });
});

describe('connectionState', () => {
  it('reports a session with no dropout as active', () => {
    expect(connectionState({ lastFlushAt: 5 })).toEqual({
      state: 'active',
      disconnectedAt: null,
      recoverAfter: null,
    });
  });

  it('reports an unanswered dropout, and when it stops being a possible reconnect', () => {
    // recoverAfter is stored so the dashboard never needs its own copy of the
    // sweep's grace period to tell "may resume" from "being recovered".
    expect(connectionState({ disconnects: { 1: 5000 } })).toEqual({
      state: 'disconnected',
      disconnectedAt: 5000,
      recoverAfter: 5000 + ABANDON_GRACE_MS,
    });
  });

  it('reads the sparse array RTDB actually returns', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(connectionState({ disconnects: [, 5000] }).state).toBe('disconnected');
  });

  it('reports an answered dropout as active again', () => {
    expect(connectionState({ disconnects: { 1: 5000 }, reconnects: { 1: 6000 } }).state).toBe(
      'active'
    );
  });
});

describe('desiredMirror', () => {
  it('carries only what the dashboard shows and the rules need', () => {
    const doc = desiredMirror(SESSION, 'owner-uid', { disconnects: { 1: 1_500_000 } });

    expect(doc).toEqual({
      experimentID: 'exp1',
      owner: 'owner-uid',
      startedAt: 1_000_000,
      expiresAt: 2_000_000,
      state: 'disconnected',
      disconnectedAt: 1_500_000,
      recoverAfter: 1_500_000 + ABANDON_GRACE_MS,
    });
    // No session id and no filename: the id is a write capability, and the
    // filename was deliberately left off the dashboard.
    expect(JSON.stringify(doc)).not.toContain(SESSION.sessionId);
    expect(doc).not.toHaveProperty('filename');
  });
});

describe('mirrorDiff', () => {
  const desired = desiredMirror(SESSION, 'owner-uid', {});

  it('is empty when the document already says the right thing', () => {
    expect(mirrorDiff({ ...desired }, desired)).toEqual({});
  });

  it('reports only the fields that differ', () => {
    const stale = { ...desired, state: 'disconnected', disconnectedAt: 9, recoverAfter: 10 };

    expect(mirrorDiff(stale, desired)).toEqual({
      state: 'active',
      disconnectedAt: null,
      recoverAfter: null,
    });
  });

  it('treats a missing field as needing to be written', () => {
    const { recoverAfter, ...partial } = desired;
    expect(recoverAfter).toBeNull();
    // Absent and null are the same answer for a nullable field, so nothing to
    // write for recoverAfter -- but a missing owner is a real gap.
    expect(mirrorDiff(partial, desired)).toEqual({});
    const { owner, ...noOwner } = desired;
    expect(mirrorDiff(noOwner, desired)).toEqual({ owner });
  });
});

describe('readWasTruncated', () => {
  // The cap is passed explicitly rather than exercised at its production size
  // (500): the comparison is a one-line arithmetic check, and a fake cap
  // proves the same logic without spending the test on building 500 fixtures.
  it('is false while the read came in under the cap', () => {
    expect(readWasTruncated(3, 5)).toBe(false);
  });

  it('is true at the cap, even though that could just mean an exact count', () => {
    // Indistinguishable from inside this module -- see the header. Treating
    // it as truncated is the conservative side of that ambiguity.
    expect(readWasTruncated(5, 5)).toBe(true);
  });

  it('is true past the cap', () => {
    expect(readWasTruncated(6, 5)).toBe(true);
  });

  it('defaults to MAX_RECONCILE, matching production wiring', () => {
    expect(readWasTruncated(MAX_RECONCILE - 1)).toBe(false);
    expect(readWasTruncated(MAX_RECONCILE)).toBe(true);
  });
});

describe('idsToDelete', () => {
  const readAt = 10_000_000;
  const oldDoc = { startedAt: readAt - 10 * 60_000 };

  it('deletes a mirror doc whose session is genuinely gone, when the read was not truncated', () => {
    const existing = new Map([['gone-1', oldDoc]]);
    const wanted = new Set(); // nothing open claims this id

    expect(idsToDelete(existing, wanted, readAt, false)).toEqual(['gone-1']);
  });

  it('never deletes a session present in the wanted set', () => {
    const existing = new Map([['open-1', oldDoc]]);
    const wanted = new Set(['open-1']);

    expect(idsToDelete(existing, wanted, readAt, false)).toEqual([]);
  });

  it('leaves alone a doc created after the read, regardless of the wanted set', () => {
    const fresh = { startedAt: readAt + 5000 };
    const existing = new Map([['fresh-1', fresh]]);

    expect(idsToDelete(existing, new Set(), readAt, false)).toEqual([]);
  });

  // The actual bug: with more open sessions than one run's read can cover,
  // a genuinely open session can rank outside the cut. Its mirror doc must
  // survive even though it is absent from `wanted` -- the case a truncated
  // read can never rule out.
  it('deletes nothing when the open-session read was truncated, even for real open sessions ranked outside the cut', () => {
    // More mirror docs than one reconciliation pass's cap, all for sessions
    // that are genuinely still open -- `wanted` below stands in for a
    // MAX_RECONCILE-sized RTDB read that could not fit all of them.
    const existing = new Map();
    for (let i = 0; i < MAX_RECONCILE + 1; i++) {
      existing.set(`session-${i}`, oldDoc);
    }
    // Only the first MAX_RECONCILE made it into this run's open-session read;
    // session-500 ranked outside the cut but is just as open as the rest.
    const wanted = new Set(Array.from({ length: MAX_RECONCILE }, (_, i) => `session-${i}`));
    expect(wanted.has(`session-${MAX_RECONCILE}`)).toBe(false);

    const deleted = idsToDelete(existing, wanted, readAt, true);

    expect(deleted).toEqual([]);
    for (let i = 0; i <= MAX_RECONCILE; i++) {
      expect(deleted).not.toContain(`session-${i}`);
    }
  });
});
