/**
 * @jest-environment node
 *
 * The pure half of the staging tier: how staged trials become a file, and what
 * that file is called. No emulator -- these are the decisions that actually
 * shape a researcher's recovered data, and they should not need infrastructure
 * to exercise.
 */

import {
  assembleTrials,
  partialFilenameFor,
  MAX_ASSEMBLED_BYTES,
} from '../../lib/staging-assembly.js';

/** The shape RTDB hands back: a map of sequence key -> trial JSON string. */
function staged(...jsonStrings) {
  return Object.fromEntries(jsonStrings.map((s, i) => [String(i), s]));
}

describe('assembleTrials', () => {
  it('produces a JSON array that parses back to the original trials', () => {
    const result = assembleTrials(staged('{"trial":0}', '{"trial":1}', '{"trial":2}'));

    expect(JSON.parse(result.data)).toEqual([
      { trial: 0 },
      { trial: 1 },
      { trial: 2 },
    ]);
    expect(result.trialCount).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.gaps).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('orders trials numerically, not lexicographically', () => {
    // The bug this exists to prevent: RTDB returns keys in lexicographic
    // order, where "10" sorts before "2". Without a numeric sort the recovered
    // file has its trials shuffled, which is silent and unrecoverable -- the
    // researcher has no way to tell a mis-ordered recovery from a real one.
    const trials = {};
    for (let i = 0; i < 12; i++) trials[String(i)] = `{"trial":${i}}`;

    const parsed = JSON.parse(assembleTrials(trials).data);

    expect(parsed.map((t) => t.trial)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('tolerates gaps rather than rejecting the session', () => {
    // Design doc risk #5. A missing sequence number means one flush never
    // landed. The remaining trials are still the participant's real data, and
    // refusing the whole session over a hole would throw away exactly the
    // sessions this feature exists to save.
    const result = assembleTrials({ 0: '{"trial":0}', 1: '{"trial":1}', 4: '{"trial":4}' });

    expect(JSON.parse(result.data)).toEqual([{ trial: 0 }, { trial: 1 }, { trial: 4 }]);
    expect(result.trialCount).toBe(3);
    expect(result.gaps).toBe(2);
  });

  it('reports no gaps for a session that simply stopped early', () => {
    // "Flush 7 was lost" and "the participant stopped after 3" are
    // indistinguishable from the outside, so gaps are counted only BELOW the
    // highest sequence number actually present.
    expect(assembleTrials(staged('{"a":1}', '{"a":2}', '{"a":3}')).gaps).toBe(0);
  });

  it('skips a trial that will not parse instead of corrupting the array', () => {
    // One malformed value would otherwise make the entire assembled array
    // unparseable, losing every good trial alongside the bad one.
    const result = assembleTrials({ 0: '{"trial":0}', 1: '{not json', 2: '{"trial":2}' });

    expect(JSON.parse(result.data)).toEqual([{ trial: 0 }, { trial: 2 }]);
    expect(result.skipped).toBe(1);
    expect(result.trialCount).toBe(2);
  });

  it('skips a non-string value', () => {
    const result = assembleTrials({ 0: '{"trial":0}', 1: { trial: 1 } });

    expect(JSON.parse(result.data)).toEqual([{ trial: 0 }]);
    expect(result.skipped).toBe(1);
  });

  it('emits trial JSON verbatim, preserving key order and formatting', () => {
    // Not parsed and re-serialized: the participant's JSON round-trips byte
    // for byte, and peak memory stays at one copy.
    const original = '{"z":1,"a":2,"nested":{"b":[1,2,3]}}';

    expect(assembleTrials({ 0: original }).data).toBe(`[${original}]`);
  });

  it('returns an empty array for a session with no trials', () => {
    const result = assembleTrials({});

    expect(result.data).toBe('[]');
    expect(result.trialCount).toBe(0);
    expect(JSON.parse(result.data)).toEqual([]);
  });

  it('truncates at the assembly ceiling rather than exhausting memory', () => {
    // The rules permit 10,000 trials x 64 KiB. A crashed sweep is an outage
    // that also lets every other abandoned session pile up behind it, so
    // assembly stops and flags instead.
    const big = JSON.stringify({ v: 'x'.repeat(60000) });
    const trials = {};
    for (let i = 0; i < 500; i++) trials[String(i)] = big;

    const result = assembleTrials(trials);

    expect(result.truncated).toBe(true);
    expect(result.data.length).toBeLessThanOrEqual(MAX_ASSEMBLED_BYTES);
    expect(result.trialCount).toBeLessThan(500);
    // Still valid JSON -- a truncated recovery must be readable, not a
    // half-written array.
    expect(() => JSON.parse(result.data)).not.toThrow();
  });
});

describe('partialFilenameFor', () => {
  const session = (overrides) => ({
    sessionId: 'abc123',
    experimentId: 'exp1',
    startedAt: 0,
    expiresAt: 0,
    ...overrides,
  });

  it('marks the file as partial and as JSON', () => {
    // Assembly always emits JSON regardless of what the experiment would have
    // submitted, so a recovered fragment of a CSV study is a .json file and
    // has to say so.
    expect(partialFilenameFor(session({ filename: 'subject42.csv' }))).toBe(
      'subject42.partial.json'
    );
  });

  it('replaces an existing json extension rather than doubling it', () => {
    expect(partialFilenameFor(session({ filename: 'subject42.json' }))).toBe(
      'subject42.partial.json'
    );
  });

  it('falls back to the session id when no filename was captured', () => {
    expect(partialFilenameFor(session())).toBe('session-abc123.partial.json');
  });

  it('neutralises path separators in a client-supplied name', () => {
    // The name is CLIENT-SUPPLIED and becomes a path in a researcher's Drive,
    // OSF or Zenodo container. Nothing downstream re-checks it.
    const result = partialFilenameFor(session({ filename: '../../etc/passwd' }));

    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    // No leading dot either: that would make the recovered data a hidden file.
    expect(result.startsWith('.')).toBe(false);
    expect(result.endsWith('.partial.json')).toBe(true);

    expect(partialFilenameFor(session({ filename: 'a/b\\c.csv' }))).toBe(
      'a_b_c.partial.json'
    );
  });

  it('strips only a real extension, not a trailing path segment', () => {
    // `\.[^.]*$` looks correct and is not: on a name with embedded dots but no
    // extension it eats the last segment.
    expect(partialFilenameFor(session({ filename: 'etc.d/passwd' }))).toBe(
      'etc.d_passwd.partial.json'
    );
    // A version-style name keeps the version.
    expect(partialFilenameFor(session({ filename: 'data.2026.csv' }))).toBe(
      'data.2026.partial.json'
    );
  });

  it('bounds a hostile filename', () => {
    const result = partialFilenameFor(session({ filename: 'x'.repeat(5000) + '.csv' }));

    expect(result.length).toBeLessThan(250);
    expect(result.endsWith('.partial.json')).toBe(true);
  });

  it('falls back rather than producing a nameless file', () => {
    // A filename that is nothing but an extension would otherwise reduce to
    // "" and produce ".partial.json" -- a hidden file on every POSIX system.
    expect(partialFilenameFor(session({ filename: '.csv' }))).toBe(
      'session-abc123.partial.json'
    );
  });
});
