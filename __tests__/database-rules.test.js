/**
 * @jest-environment node
 *
 * Security rules for the RTDB staging tier (database.rules.json).
 *
 * These rules are the entire security boundary for a tree that unauthenticated
 * participants write to from arbitrary hosts, so this suite is deliberately
 * adversarial: every test below is a thing an attacker or a broken client
 * would try, not a thing the plugin does.
 *
 * Sibling of __tests__/firestore-rules.test.js and set up the same way, via
 * @firebase/rules-unit-testing against the emulator. Needs the DATABASE
 * emulator on port 9000 (`firebase emulators:start --only database`); the
 * Firestore emulator on 8080 is not involved.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';

let testEnv;

// An admitted session, and one that was never admitted. Every write test is
// really a test of which of these two the session id belongs to.
const OPEN = 'session-open';
const UNKNOWN = 'session-never-admitted';

/** The Admin-SDK equivalent: seed openSessions the way api-session-start does. */
async function admit(sessionId) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.database().ref(`openSessions/${sessionId}`).set({
      experimentId: 'exp123',
      startedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    });
  });
}

async function seedTrial(sessionId, seq, value) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.database().ref(`staging/${sessionId}/trials/${seq}`).set(value);
  });
}

/** The participant's view: unauthenticated, exactly as an experiment page is. */
function client() {
  return testEnv.unauthenticatedContext().database();
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'datapipe-test',
    database: {
      rules: readFileSync('database.rules.json', 'utf8'),
      host: 'localhost',
      port: 9000,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearDatabase();
  await admit(OPEN);
});

describe('reads', () => {
  // Property 1 in database.rules.json. The session id is a bearer capability
  // handed to a browser; if holding one let you READ the session, it would let
  // you read a participant's data back out of the staging tier.
  it('denies reading the root', async () => {
    await assertFails(client().ref('/').once('value'));
  });

  it('denies reading openSessions, even for an admitted session', async () => {
    await assertFails(client().ref(`openSessions/${OPEN}`).once('value'));
  });

  it('denies reading a session it may legitimately write to', async () => {
    await assertFails(client().ref(`staging/${OPEN}`).once('value'));
  });

  it('denies reading back a trial it wrote itself', async () => {
    await assertSucceeds(client().ref(`staging/${OPEN}/trials/0`).set('{"a":1}'));
    await assertFails(client().ref(`staging/${OPEN}/trials/0`).once('value'));
  });

  it('denies reading a session meta node', async () => {
    await assertFails(client().ref(`staging/${OPEN}/meta`).once('value'));
  });
});

describe('the openSessions gate', () => {
  // Property 4, and the reason the openExperiments mirror is gone: an id that
  // no function minted buys nothing.
  it('denies a trial write for a session that was never admitted', async () => {
    await assertFails(client().ref(`staging/${UNKNOWN}/trials/0`).set('{"a":1}'));
  });

  it('denies a meta write for a session that was never admitted', async () => {
    await assertFails(client().ref(`staging/${UNKNOWN}/meta/startedAt`).set(Date.now()));
  });

  it('allows a trial write for an admitted session', async () => {
    await assertSucceeds(client().ref(`staging/${OPEN}/trials/0`).set('{"a":1}'));
  });

  it('stops accepting writes once the session is discarded', async () => {
    // This is what neuters a stale onDisconnect after a clean completion:
    // discardSession() removes the capability record, so the queued
    // abandonedAt write is denied when the socket eventually closes.
    await assertSucceeds(client().ref(`staging/${OPEN}/trials/0`).set('{"a":1}'));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.database().ref(`openSessions/${OPEN}`).remove();
    });
    await assertFails(client().ref(`staging/${OPEN}/trials/1`).set('{"a":2}'));
    await assertFails(client().ref(`staging/${OPEN}/meta/abandonedAt`).set(Date.now()));
  });

  it('denies a client writing its own openSessions entry', async () => {
    await assertFails(
      client().ref(`openSessions/${UNKNOWN}`).set({
        experimentId: 'exp123',
        startedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      })
    );
  });

  it('denies a client extending its own session expiry', async () => {
    await assertFails(
      client().ref(`openSessions/${OPEN}/expiresAt`).set(Date.now() + 999999999)
    );
  });

  it('denies a client deleting another session wholesale', async () => {
    await seedTrial(OPEN, 0, '{"a":1}');
    await assertFails(client().ref(`staging/${OPEN}`).remove());
    await assertFails(client().ref(`staging/${OPEN}/trials`).remove());
  });
});

describe('append-only trials', () => {
  // Property 2. Also what makes a retried flush idempotent rather than
  // destructive -- see "ORDERING AND DUPLICATES" in database.rules.json.
  it('denies overwriting a trial that already exists', async () => {
    await assertSucceeds(client().ref(`staging/${OPEN}/trials/7`).set('{"a":1}'));
    await assertFails(client().ref(`staging/${OPEN}/trials/7`).set('{"a":2}'));
  });

  it('denies deleting a trial', async () => {
    await seedTrial(OPEN, 3, '{"a":1}');
    await assertFails(client().ref(`staging/${OPEN}/trials/3`).remove());
  });

  it('allows a gap in sequence numbers', async () => {
    // A lost flush must not block the ones after it: assembleSession()
    // tolerates gaps precisely because the rules permit them.
    await assertSucceeds(client().ref(`staging/${OPEN}/trials/0`).set('{"a":0}'));
    await assertSucceeds(client().ref(`staging/${OPEN}/trials/5`).set('{"a":5}'));
  });
});

describe('size and shape caps', () => {
  // Property 3. Rules cannot count children, so these two caps are the only
  // bound expressible here.
  it('accepts a trial at exactly the 64 KiB cap', async () => {
    const atCap = JSON.stringify({ v: 'x'.repeat(65536 - 12) });
    expect(atCap.length).toBeLessThanOrEqual(65536);
    await assertSucceeds(client().ref(`staging/${OPEN}/trials/0`).set(atCap));
  });

  it('denies a trial one byte over the cap', async () => {
    await assertFails(client().ref(`staging/${OPEN}/trials/0`).set('x'.repeat(65537)));
  });

  it('denies a non-string trial value', async () => {
    // Trials are stored as strings so the size cap means what it says and no
    // rule has to bound object nesting or width.
    await assertFails(client().ref(`staging/${OPEN}/trials/0`).set({ a: 1 }));
    await assertFails(client().ref(`staging/${OPEN}/trials/1`).set(12345));
  });

  it('accepts the highest permitted sequence number', async () => {
    await assertSucceeds(client().ref(`staging/${OPEN}/trials/9999`).set('{"a":1}'));
  });

  it('denies a sequence number past the 10,000-trial ceiling', async () => {
    await assertFails(client().ref(`staging/${OPEN}/trials/10000`).set('{"a":1}'));
  });

  it('denies a non-numeric sequence key', async () => {
    await assertFails(client().ref(`staging/${OPEN}/trials/abc`).set('{"a":1}'));
    await assertFails(client().ref(`staging/${OPEN}/trials/-1`).set('{"a":1}'));
  });
});

describe('meta', () => {
  it('allows startedAt to be written once and never again', async () => {
    await assertSucceeds(client().ref(`staging/${OPEN}/meta/startedAt`).set(Date.now()));
    await assertFails(client().ref(`staging/${OPEN}/meta/startedAt`).set(0));
  });

  it('allows lastFlushAt to be refreshed on every flush', async () => {
    await assertSucceeds(client().ref(`staging/${OPEN}/meta/lastFlushAt`).set(Date.now()));
    await assertSucceeds(client().ref(`staging/${OPEN}/meta/lastFlushAt`).set(Date.now() + 1));
  });

  it('allows abandonedAt to be set and then cleared on reconnect', async () => {
    // The clear path is not a nicety: without it one wifi blip permanently
    // marks a running session abandoned and the sweep writes a partial file
    // for a participant who is still doing trials.
    await assertSucceeds(client().ref(`staging/${OPEN}/meta/abandonedAt`).set(Date.now()));
    await assertSucceeds(client().ref(`staging/${OPEN}/meta/abandonedAt`).set(null));
  });

  it('denies a non-numeric timestamp', async () => {
    await assertFails(client().ref(`staging/${OPEN}/meta/lastFlushAt`).set('now'));
  });

  it('denies an unknown key under meta', async () => {
    await assertFails(client().ref(`staging/${OPEN}/meta/notes`).set('x'.repeat(1000)));
  });

  it('denies an unknown branch under a session', async () => {
    await assertFails(client().ref(`staging/${OPEN}/scratch`).set('x'.repeat(1000)));
  });
});

describe('the real flush shape', () => {
  // What the plugin actually sends: one multi-path update carrying a batch of
  // trials plus the liveness stamp. RTDB evaluates each resolved path
  // independently, so this must pass as a whole.
  it('accepts a batched multi-path update', async () => {
    await assertSucceeds(
      client().ref(`staging/${OPEN}`).update({
        'trials/0': '{"trial":0}',
        'trials/1': '{"trial":1}',
        'trials/2': '{"trial":2}',
        'meta/lastFlushAt': Date.now(),
      })
    );
  });

  it('rejects the whole batch if any trial in it is a rewrite', async () => {
    // Multi-path updates are atomic, so a replay that renumbers incorrectly
    // fails whole rather than half-landing.
    await seedTrial(OPEN, 1, '{"trial":1}');
    await assertFails(
      client().ref(`staging/${OPEN}`).update({
        'trials/1': '{"trial":"rewritten"}',
        'trials/2': '{"trial":2}',
        'meta/lastFlushAt': Date.now(),
      })
    );
  });

  it('rejects a batch that smuggles in an out-of-shape path', async () => {
    await assertFails(
      client().ref(`staging/${OPEN}`).update({
        'trials/0': '{"trial":0}',
        'meta/injected': 'x',
      })
    );
  });
});
