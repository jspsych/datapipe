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
  assembleTrialsPaged,
  partialFilenameFor,
  disconnectedSince,
  streamingEnabled,
  MAX_ASSEMBLED_BYTES,
} from '../../lib/staging-assembly.js';

/** The shape RTDB hands back: a map of sequence key -> trial JSON string. */
function staged(...jsonStrings) {
  return Object.fromEntries(jsonStrings.map((s, i) => [String(i), s]));
}

/**
 * An in-memory fetchPage for assembleTrialsPaged: pages through `entries`
 * (already-sorted [key, value] pairs) `pageSize` at a time, and counts how
 * many times it was called.
 */
function fakePager(entries, pageSize) {
  const calls = { count: 0 };
  const fetchPage = async (afterKey) => {
    calls.count++;
    const startIndex =
      afterKey === null ? 0 : entries.findIndex(([k]) => k === afterKey) + 1;
    const page = entries.slice(startIndex, startIndex + pageSize);
    return { entries: page, done: startIndex + page.length >= entries.length };
  };
  return { fetchPage, calls };
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
    // The rules permit up to 1,000 trials x 16 KiB (functions/src/staging.ts).
    // A crashed sweep is an outage that also lets every other abandoned
    // session pile up behind it, so assembly stops and flags instead.
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

  it('measures the cap in bytes, not UTF-16 length', () => {
    // The review finding this closes: the old comparison used `raw.length`,
    // which for multibyte content undercounts real bytes by up to ~3x (see
    // MAX_TRIAL_BYTES's doc in staging-assembly.ts). A trial made entirely of
    // a 3-byte-per-unit character has to be judged on its real byte size, not
    // its (much smaller-looking) UTF-16 length.
    const wide = 'あ'; // U+3042, 1 UTF-16 unit, 3 UTF-8 bytes
    const trial = JSON.stringify({ v: wide.repeat(10000) }); // ~10,000 units, ~30,000 bytes
    expect(Buffer.byteLength(trial, 'utf8')).toBeGreaterThan(trial.length * 2);

    const trials = {};
    for (let i = 0; i < 2000; i++) trials[String(i)] = trial;

    const result = assembleTrials(trials);

    // If the comparison still used `.length`, this would fit ~800 copies
    // before crossing MAX_ASSEMBLED_BYTES (24 MiB / ~30,000). Measured in
    // real bytes it fits far fewer.
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.data, 'utf8')).toBeLessThanOrEqual(MAX_ASSEMBLED_BYTES);
  });
});

describe('assembleTrialsPaged', () => {
  it('produces the same result as assembleTrials for data that fits in one page', async () => {
    const trials = staged('{"trial":0}', '{"trial":1}', '{"trial":2}');
    const entries = Object.entries(trials);

    const { fetchPage } = fakePager(entries, 10);
    const result = await assembleTrialsPaged(fetchPage);

    expect(result.data).toBe(assembleTrials(trials).data);
    expect(JSON.parse(result.data)).toEqual([
      { trial: 0 },
      { trial: 1 },
      { trial: 2 },
    ]);
    expect(result.trialCount).toBe(3);
    expect(result.gaps).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.pagesFetched).toBe(1);
  });

  it('preserves ascending order across a page boundary', async () => {
    const trials = {};
    for (let i = 0; i < 25; i++) trials[String(i)] = `{"trial":${i}}`;
    const entries = Object.keys(trials)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => [k, trials[k]]);

    const { fetchPage, calls } = fakePager(entries, 10);
    const result = await assembleTrialsPaged(fetchPage);

    expect(JSON.parse(result.data).map((t) => t.trial)).toEqual(
      Array.from({ length: 25 }, (_, i) => i)
    );
    expect(result.trialCount).toBe(25);
    expect(calls.count).toBe(3); // 10 + 10 + 5
    expect(result.pagesFetched).toBe(3);
  });

  it('tolerates gaps and counts skipped trials across pages', async () => {
    const entries = [
      ['0', '{"trial":0}'],
      ['1', '{not json'],
      ['4', '{"trial":4}'],
    ];

    const { fetchPage } = fakePager(entries, 2);
    const result = await assembleTrialsPaged(fetchPage);

    expect(JSON.parse(result.data)).toEqual([{ trial: 0 }, { trial: 4 }]);
    expect(result.skipped).toBe(1);
    expect(result.gaps).toBe(2); // sequence numbers 2 and 3 never arrived
  });

  it('returns an empty assembly when there is nothing staged, in one call', async () => {
    const { fetchPage, calls } = fakePager([], 200);

    const result = await assembleTrialsPaged(fetchPage);

    expect(result.data).toBe('[]');
    expect(result.trialCount).toBe(0);
    expect(calls.count).toBe(1);
    expect(result.pagesFetched).toBe(1);
  });

  it('stops fetching pages once the byte cap is crossed, without reading the rest', async () => {
    // THE FIX THIS TEST PINS: the review found the sweep read a whole session
    // into memory before its size cap applied. Here the fake backing store
    // holds far more than fits under MAX_ASSEMBLED_BYTES, and the assertion
    // is on `calls.count` -- proof the function stopped asking for more
    // pages, not just that it stopped keeping what it already had.
    const big = JSON.stringify({ v: 'x'.repeat(60000) }); // ~60KB/trial
    const totalTrials = 1000; // ~60MB backing store if it were all read
    const entries = Array.from({ length: totalTrials }, (_, i) => [String(i), big]);
    const pageSize = 50; // ~3MB/page

    const { fetchPage, calls } = fakePager(entries, pageSize);
    const result = await assembleTrialsPaged(fetchPage);

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.data, 'utf8')).toBeLessThanOrEqual(MAX_ASSEMBLED_BYTES);
    // MAX_ASSEMBLED_BYTES (24MiB) / ~60KB per trial is ~400 trials, or 8
    // pages of 50 -- nowhere near the 20 pages totalTrials/pageSize would take
    // to read everything.
    const pagesToReadEverything = totalTrials / pageSize;
    expect(calls.count).toBeLessThan(pagesToReadEverything);
    expect(result.pagesFetched).toBe(calls.count);
  });
});

describe('streamingEnabled', () => {
  it('defaults to enabled when unset', () => {
    expect(streamingEnabled({})).toBe(true);
  });

  it('stays enabled for any value other than the literal string "false"', () => {
    expect(streamingEnabled({ STREAMING_ENABLED: 'true' })).toBe(true);
    expect(streamingEnabled({ STREAMING_ENABLED: '' })).toBe(true);
    expect(streamingEnabled({ STREAMING_ENABLED: 'FALSE' })).toBe(true);
    expect(streamingEnabled({ STREAMING_ENABLED: '0' })).toBe(true);
  });

  it('disables only on the exact string "false"', () => {
    expect(streamingEnabled({ STREAMING_ENABLED: 'false' })).toBe(false);
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

describe('disconnectedSince', () => {
  // Shared by the sweep and the dashboard's live view, so a wrong answer here
  // is either a participant recovered as a partial file while still working,
  // or a dropout the researcher never sees.

  it('reports a connected session with no stamps as connected', () => {
    expect(disconnectedSince({ startedAt: 1, lastFlushAt: 2 })).toBeNull();
  });

  it('reports the stamp time for an unanswered drop', () => {
    expect(disconnectedSince({ disconnects: { 1: 5000 } })).toBe(5000);
  });

  it('reads the sparse array RTDB returns for small integer keys', () => {
    // {"1": 5000} comes back from RTDB as a SPARSE array -- a hole at index 0,
    // not a null. Both are tested because only the hole broke anything: .map
    // skips holes, and the first version threw on every real dropout while a
    // test written with `[null, 5000]` passed.
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [, 5000];
    expect(0 in sparse).toBe(false);
    expect(disconnectedSince({ disconnects: sparse })).toBe(5000);
    // eslint-disable-next-line no-sparse-arrays
    expect(disconnectedSince({ disconnects: [, 5000], reconnects: [, 6000] })).toBeNull();
    expect(disconnectedSince({ disconnects: [null, 5000] })).toBe(5000);
  });

  it('treats a reconnect mark as answering its slot', () => {
    expect(disconnectedSince({ disconnects: { 1: 5000 }, reconnects: { 1: 6000 } })).toBeNull();
  });

  it('answers a late stamp from an old connection by slot, not by arrival order', () => {
    // The reconnect mark for connection 1 was written BEFORE connection 1's
    // stamp landed (half-open socket after a network switch): its timestamp
    // is earlier. Order-by-time would call this a live dropout.
    expect(disconnectedSince({ disconnects: { 1: 9000 }, reconnects: { 1: 7000 } })).toBeNull();
  });

  it('judges by the highest stamped slot', () => {
    // Connection 1 dropped and came back; connection 2 dropped and did not.
    expect(
      disconnectedSince({ disconnects: { 1: 1000, 2: 8000 }, reconnects: { 1: 2000 } })
    ).toBe(8000);
  });

  it('ignores an unanswered old slot once a higher slot has been answered', () => {
    // Slot 1's reconnect mark was lost, but slot 2 was later stamped and
    // answered: the participant has been back since.
    expect(
      disconnectedSince({ disconnects: { 1: 1000, 2: 3000 }, reconnects: { 2: 4000 } })
    ).toBeNull();
  });

  it('treats trials flushed after the stamp as proof the participant is back', () => {
    // The backstop for a lost reconnect mark: without it one dropped write
    // gets a working participant recovered as a partial session.
    expect(disconnectedSince({ disconnects: { 1: 5000 }, lastFlushAt: 6000 })).toBeNull();
    expect(disconnectedSince({ disconnects: { 1: 5000 }, lastFlushAt: 4000 })).toBe(5000);
  });

  it('ignores malformed slots rather than throwing', () => {
    expect(disconnectedSince({ disconnects: { 0: 5, x: 9, 3: 'soon' } })).toBeNull();
  });
});
