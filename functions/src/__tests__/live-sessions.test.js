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
