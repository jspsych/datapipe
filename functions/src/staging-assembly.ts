// The pure half of the staging tier: its limits, its types, and the two
// decisions that actually shape a researcher's recovered data -- how staged
// trials become a file, and what that file is called.
//
// Split from staging.ts on exactly the grounds compaction-gate.ts is split
// from compaction.ts. Two payoffs:
//
//  - TESTABLE WITHOUT INFRASTRUCTURE. Trial ordering, gap tolerance and
//    filename sanitisation are where a silent data bug would live, and none of
//    them should need an emulator to exercise. staging.ts reaches
//    firebase-admin and nanoid (which is ESM-only and untransformed by this
//    repo's Jest config, so importing it into a unit test fails outright).
//  - CHEAPER COLD STARTS. api-data.ts is the hottest path in this codebase and
//    pays every transitive import on each one.
//
// See functions/src/staging.ts for the Realtime Database half, and
// docs/streaming-ingest-design.md for the design.

// Mirrors the `newData.val().length <= 65536` cap in database.rules.json.
// Exported so api-session-start.ts can tell the client the number rather than
// letting the plugin carry its own copy that could drift out of sync with the
// rule that actually enforces it.
export const MAX_TRIAL_BYTES = 65536;

// Mirrors the 4-digit `$seq` cap in database.rules.json.
export const MAX_TRIALS_PER_SESSION = 10000;

// Client flush cadence, sent to the plugin by api-session-start.ts for the
// same reason as MAX_TRIAL_BYTES: one source of truth, tunable without a
// coordinated plugin release.
export const FLUSH_INTERVAL_MS = 10000;
export const FLUSH_EVERY_N_TRIALS = 10;

// How long after Firebase stamps a disconnect before the session is
// treated as really gone.
//
// This is NOT a formality, and it is why every disconnect slot has a matching
// reconnect slot in database.rules.json. onDisconnect fires on any socket drop -- a participant
// on hotel wifi, a laptop lid closed for a minute, a phone switching from wifi
// to cellular. The plugin clears the stamp and re-arms when it reconnects, so
// the grace period is the window in which that can happen. Ten minutes is long
// enough to cover a reconnect and short enough that a genuinely abandoned
// session is recovered while the study is still running.
//
// Lives here rather than in the sweep because the disconnect trigger needs it
// too (to tell the dashboard when a dropout stops being a possible reconnect),
// and the trigger has no business importing the sweep's upload machinery.
export const ABANDON_GRACE_MS = 10 * 60 * 1000;

// The number of per-connection disconnect slots a session has. Mirrors the
// 1..20 slot pattern on staging/$sid/meta/{disconnects,reconnects} in
// database.rules.json, and is sent to the plugin by api-session-start.ts so it
// stops arming at the cap instead of having its stamps refused. The cap exists
// because every write to those slots runs a function (the dashboard's live
// dropout view) and they are participant-writable; see the rules for why the
// bound has to be structural.
export const MAX_DISCONNECTS = 20;

// How long an admitted session may stay open. Past this the sweep treats it as
// abandoned regardless of what meta says -- the backstop for a client that
// died before it could register an onDisconnect, or one whose onDisconnect
// Firebase never got to run.
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Assembly ceiling. The rules permit 10,000 trials x 64 KiB = 640 MB in the
// worst case, which no honest session approaches and which would OOM the
// 256MiB sweep instantly. Assembly stops here and flags the result as
// truncated rather than dying: a truncated recovery of an abusive or runaway
// session is a diagnosis, a crashed sweep is an outage that also lets every
// other abandoned session pile up behind it.
export const MAX_ASSEMBLED_BYTES = 24 * 1024 * 1024;

// Cap on the client-supplied filename carried through a session. Generous for
// any real name, and a bound on a string that a client controls and that ends
// up as a path in a researcher's storage.
export const MAX_FILENAME_LENGTH = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenSession {
  sessionId: string;
  experimentId: string;
  startedAt: number;
  expiresAt: number;
  /**
   * The filename the participant intended to submit under, captured at session
   * start so an ABANDONED session can be recovered under a name the researcher
   * recognises rather than an opaque id.
   *
   * Optional because a client need not supply one, and untrusted because a
   * client supplies it: partialFilenameFor() sanitises it on the way out. It
   * is never used as the name of a completed submission -- a clean completion
   * carries its own filename on the /api/data request, as it always has.
   */
  filename?: string;
}

/**
 * Per-connection slots, keyed 1..20. RTDB hands back small integer keys as an
 * ARRAY (index 0 empty) rather than an object, so both shapes must be read --
 * see slotEntries().
 */
export type SlotMap = Record<string, number> | Array<number | null | undefined>;

export interface SessionMeta {
  startedAt?: number;
  lastFlushAt?: number;
  disconnects?: SlotMap;
  reconnects?: SlotMap;
}

export interface AssembledSession {
  /** A JSON array of the staged trials, ready for the upload pipeline. */
  data: string;
  trialCount: number;
  /** Trials dropped because they would not parse as JSON. */
  skipped: number;
  /** True if assembly stopped at MAX_ASSEMBLED_BYTES. */
  truncated: boolean;
  /** Missing sequence numbers below the highest one seen -- lost flushes. */
  gaps: number;
}

/**
 * The name a recovered partial session is stored under.
 *
 * Three things happen here, and each one is load-bearing:
 *
 *  - `/` and `\` are replaced, exactly as persistPending does. The base name
 *    is CLIENT-SUPPLIED, and it becomes a path in a researcher's Drive, OSF or
 *    Zenodo container. Nothing else in this pipeline re-checks it.
 *  - The original extension is dropped and `.partial.json` is appended.
 *    Assembly always emits a JSON array regardless of what the experiment
 *    would have submitted (the design confines server-side serialization to
 *    this one path precisely so jsPsych's CSV writer never has to be
 *    reimplemented in functions/), so a recovered fragment of a CSV study is a
 *    .json file and must say so.
 *  - `.partial.` is what makes the file self-describing in the researcher's
 *    storage. A recovered fragment sitting in a dataset under an ordinary name
 *    would quietly make the record non-Psych-DS -- the same class of problem
 *    docs/finalization-spec.md addresses for archives.
 *
 * Falls back to the session id when no filename was captured. Opaque, but
 * unique and traceable back to a sweep log line.
 */
export function partialFilenameFor(session: OpenSession): string {
  const fallback = `session-${session.sessionId}`;
  const base = (session.filename || fallback)
    // Path separators first: the name becomes a path in a researcher's Drive,
    // OSF or Zenodo container, and nothing downstream re-checks it.
    .replace(/[/\\]/g, "_")
    .slice(0, MAX_FILENAME_LENGTH)
    // Strip a real extension, and ONLY a real extension. `\.[^.]*$` looks
    // right and is not: on a name with no extension but embedded dots -- which
    // is what "../../etc/passwd" sanitises to -- it eats the last path segment
    // and yields ".._." . Bounding the match to a short alphanumeric run is
    // what "extension" actually means, and it also leaves a version-style name
    // like "data.2026.csv" as "data.2026" rather than "data".
    .replace(/\.[A-Za-z0-9]{1,10}$/, "")
    // A leading dot makes a hidden file on every POSIX system, and would hide
    // a participant's recovered data from the researcher looking for it.
    .replace(/^\.+/, "");
  return `${base || fallback}.partial.json`;
}

/**
 * The pure half of assembleSession: everything above, minus the read.
 *
 * Split out so the ordering, gap and truncation behaviour can be tested
 * without an emulator -- the same separation compaction-gate.ts makes for
 * compaction, and for the same reason: the interesting logic should not need
 * the infrastructure to exercise it.
 */
export function assembleTrials(
  trials: Record<string, string>
): AssembledSession {
  // Numeric sort: RTDB hands back keys in lexicographic order, where "10"
  // sorts before "2" and the recovered file would have its trials shuffled.
  const keys = Object.keys(trials).sort((a, b) => Number(a) - Number(b));

  const parts: string[] = [];
  let bytes = 2; // the enclosing brackets
  let skipped = 0;
  let truncated = false;

  for (const key of keys) {
    const raw = trials[key];
    if (typeof raw !== "string") {
      skipped++;
      continue;
    }
    try {
      JSON.parse(raw);
    } catch {
      skipped++;
      continue;
    }
    const cost = raw.length + (parts.length > 0 ? 1 : 0); // + the comma
    if (bytes + cost > MAX_ASSEMBLED_BYTES) {
      truncated = true;
      break;
    }
    bytes += cost;
    parts.push(raw);
  }

  // Gaps are counted against the highest sequence number actually present, not
  // against a trial count the client never told us -- there is no way to
  // distinguish "flush 7 was lost" from "the participant stopped after 6".
  const highest = keys.length ? Number(keys[keys.length - 1]) : -1;
  const gaps =
    highest >= 0 && Number.isFinite(highest)
      ? Math.max(0, highest + 1 - keys.length)
      : 0;

  return {
    data: `[${parts.join(",")}]`,
    trialCount: parts.length,
    skipped,
    truncated,
    gaps,
  };
}

/** [slot number, timestamp] pairs from either shape RTDB may return. */
function slotEntries(slots: SlotMap | undefined): Array<[number, number]> {
  if (!slots) return [];
  const pairs: Array<[number, number]> = [];
  // Array.from, not .map: RTDB's arrays are SPARSE -- index 0 is a hole, not
  // a null -- and .map skips holes, leaving `undefined` entries that the
  // destructuring loop below throws on ("for is not iterable"). Array.from
  // visits every index. Found by the emulator suite; a unit test written with
  // `[null, 5000]` passed, because that is not the shape RTDB returns.
  const entries = Array.isArray(slots)
    ? Array.from(slots, (value, index) => [String(index), value] as const)
    : Object.entries(slots);
  for (const [key, value] of entries) {
    const n = Number(key);
    if (Number.isInteger(n) && n >= 1 && typeof value === "number") {
      pairs.push([n, value]);
    }
  }
  return pairs;
}

/**
 * When the session's current connection dropped, or null if it is connected.
 *
 * The session is disconnected when its HIGHEST stamped disconnect slot has no
 * matching reconnect mark. Two rules make that honest rather than merely
 * plausible:
 *
 *  - SLOTS, NOT ARRIVAL ORDER. The plugin arms slot n+1 only after it is back
 *    online from slot n, so the highest stamped slot is the most recent drop
 *    Firebase has reported. A stamp for an old connection that lands late --
 *    a network switch can leave the old socket half-open until the server
 *    times it out -- is either already answered by its reconnect mark or
 *    superseded by a higher slot.
 *  - A FLUSH AFTER THE STAMP WINS. If the reconnect mark itself was lost (the
 *    one write here that can fail without anyone noticing), trials arriving
 *    after the stamp are proof the participant is still there. Without this, a
 *    single dropped write would get a working participant recovered as a
 *    partial session ten minutes later.
 *
 * Shared by the sweep (is it past the grace period?) and the live-sessions
 * mirror (what should the dashboard say?), so the two can never disagree.
 */
export function disconnectedSince(meta: SessionMeta): number | null {
  const stamps = slotEntries(meta.disconnects);
  if (stamps.length === 0) return null;

  const [latestSlot, stampedAt] = stamps.reduce((a, b) => (b[0] > a[0] ? b : a));
  const healed = slotEntries(meta.reconnects).some(([n]) => n === latestSlot);
  if (healed) return null;
  if (typeof meta.lastFlushAt === "number" && meta.lastFlushAt > stampedAt) return null;
  return stampedAt;
}

