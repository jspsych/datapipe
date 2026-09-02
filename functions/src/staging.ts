// The staging tier for incremental session upload
// (docs/streaming-ingest-design.md).
//
// This is the ONLY module in the codebase that talks to the Realtime Database.
// Everything else -- api-session-start.ts, api-data.ts,
// scheduled-staging-sweep.ts -- goes through the functions here, for the same
// reason compaction-gate.ts is split out of compaction.ts: api-data.ts is the
// hottest path in this codebase and pays every transitive import on each cold
// start, so the surface it touches is kept deliberately small.
//
// WHAT LIVES IN RTDB, AND WHAT DOES NOT
//
//   openSessions/{sessionId}       { experimentId, startedAt, expiresAt }
//   staging/{sessionId}/meta       { startedAt, lastFlushAt, abandonedAt? }
//   staging/{sessionId}/trials/{seq}   one trial's JSON, as a string
//
// openSessions is the capability table: a session id is admitted to the
// staging tier only because POST /api/session put it here, having first run
// the same four gates api-data.ts runs (exists / not finalized / active /
// under maxSessions). database.rules.json gates every participant write on the
// corresponding node existing, which is what makes a client-held session id
// unforgeable rather than merely unguessable.
//
// ENCRYPTION AT REST -- A DELIBERATE DEVIATION, STATED PLAINLY
//
// persist-pending.ts and queue-upload.ts encrypt their payloads with
// payload-crypto.ts, because those objects hold a participant's submission for
// up to seven days. Staged trials hold comparable data for minutes to hours,
// and the design doc's position was that the shorter window does not change
// the answer.
//
// It cannot be done here, and the reason is structural rather than an
// oversight: the writer is the PARTICIPANT'S BROWSER. It has no key, and any
// key shipped to it in a plugin bundle is a key every participant holds, which
// is not encryption. What staged trials get instead:
//
//   - database.rules.json grants `.read` to nobody, at any depth. A client
//     cannot read back even its own trials; only this module ever reads them.
//   - Google encrypts Realtime Database contents at rest by default.
//   - The window is minutes, not days: the node is deleted the moment
//     /api/data succeeds, and the sweep is the backstop for the rest.
//
// If application-layer encryption of staged data is required, the staging tier
// cannot be client-written at all, and the design has to change rather than
// this module.

import { getDatabase, Database } from "firebase-admin/database";
import { customAlphabet } from "nanoid";
import { app } from "./app.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

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

// Same alphabet as create-experiment.ts's experiment ids, at double the
// length. This id is a BEARER CAPABILITY -- whoever holds it can write to the
// session -- so unguessability is the security property, not just collision
// avoidance. 24 chars of a 62-symbol alphabet is ~143 bits.
const generateSessionId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  24
);

// ---------------------------------------------------------------------------
// Lazy database handle
// ---------------------------------------------------------------------------

let cachedDb: Database | null = null;

/**
 * The database URL this deployment stages into.
 *
 * Returned to the client by api-session-start.ts rather than compiled into the
 * plugin, which is what lets ONE published plugin build talk to
 * datapipe-test and to production without a `NEXT_PUBLIC`-style build flag on
 * the participant's side.
 *
 * FIREBASE_DATABASE_URL wins when set (an explicit override, and what the test
 * suites use); otherwise the default instance name is derived from the project
 * id. Under the emulator the host portion is ignored -- the Admin SDK routes
 * by the `?ns=` namespace it appends -- so any well-formed URL naming the
 * right project works.
 */
export function stagingDatabaseURL(): string {
  const explicit = process.env.FIREBASE_DATABASE_URL;
  if (explicit) return explicit;
  const project =
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "Cannot determine the staging database URL: neither FIREBASE_DATABASE_URL " +
        "nor GCLOUD_PROJECT is set."
    );
  }
  return `https://${project}-default-rtdb.firebaseio.com`;
}

/**
 * Memoized Admin SDK database handle.
 *
 * Deliberately not a module-level constant (and deliberately not in app.ts):
 * getDatabase() throws when it cannot resolve a URL, and app.ts is imported by
 * every function in this codebase. Resolving it here means a project with no
 * RTDB instance provisioned breaks only the staging endpoints, instead of
 * failing to load api-data.ts and api-condition.ts along with them.
 */
function rtdb(): Database {
  if (!cachedDb) cachedDb = getDatabase(app, stagingDatabaseURL());
  return cachedDb;
}

/** Test seam: drop the memoized handle so a suite can repoint the emulator. */
export function resetStagingHandleForTests(): void {
  cachedDb = null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenSession {
  sessionId: string;
  experimentId: string;
  startedAt: number;
  expiresAt: number;
}

export interface SessionMeta {
  startedAt?: number;
  lastFlushAt?: number;
  abandonedAt?: number;
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

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Admit a session to the staging tier and return its id.
 *
 * The caller (api-session-start.ts) is responsible for having checked that the
 * experiment is open. This function does not re-check, because it cannot: RTDB
 * has no view of Firestore, and that asymmetry is the whole reason session ids
 * are minted server-side.
 */
export async function openSession(experimentId: string): Promise<string> {
  const sessionId = generateSessionId();
  const now = Date.now();
  await rtdb()
    .ref(`openSessions/${sessionId}`)
    .set({ experimentId, startedAt: now, expiresAt: now + SESSION_TTL_MS });
  return sessionId;
}

/** The capability record for a session id, or null if it is not open. */
export async function getOpenSession(
  sessionId: string
): Promise<OpenSession | null> {
  const snap = await rtdb().ref(`openSessions/${sessionId}`).get();
  if (!snap.exists()) return null;
  const value = snap.val() as Omit<OpenSession, "sessionId">;
  return { sessionId, ...value };
}

/** A session's meta node, or an empty object if the client never wrote one. */
export async function getSessionMeta(sessionId: string): Promise<SessionMeta> {
  const snap = await rtdb().ref(`staging/${sessionId}/meta`).get();
  return snap.exists() ? (snap.val() as SessionMeta) : {};
}

/**
 * Oldest-first candidates for the sweep.
 *
 * Ordered by `expiresAt`, which for a fixed TTL is the same order as
 * `startedAt` -- so the sessions most likely to be abandoned surface first,
 * and the read is bounded regardless of how many sessions are in flight. The
 * caller filters live ones out by reading each candidate's meta; this only has
 * to make sure it never reads the whole table.
 *
 * Requires the `.indexOn: ["expiresAt"]` directive in database.rules.json --
 * without it RTDB still answers, but by downloading the entire node and
 * sorting in the client, which is precisely what the bound above exists to
 * avoid.
 */
export async function listOldestOpenSessions(
  limit: number
): Promise<OpenSession[]> {
  const snap = await rtdb()
    .ref("openSessions")
    .orderByChild("expiresAt")
    .limitToFirst(limit)
    .get();
  if (!snap.exists()) return [];
  const rows: OpenSession[] = [];
  snap.forEach((child) => {
    const value = child.val() as Omit<OpenSession, "sessionId">;
    rows.push({ sessionId: child.key as string, ...value });
    return false; // keep iterating (forEach cancels on `true`)
  });
  // forEach preserves the query order; the object from val() would not.
  return rows;
}

/** How many sessions are currently admitted. Diagnostic, for sweep health. */
export async function countOpenSessions(): Promise<number> {
  const snap = await rtdb().ref("openSessions").get();
  return snap.exists() ? snap.numChildren() : 0;
}

/**
 * Read and assemble a session's staged trials.
 *
 * GAPS ARE TOLERATED, NOT REJECTED (design doc risk #5). A missing sequence
 * number means one flush never landed -- a dropped request, a tab closed
 * mid-write. The remaining trials are still the participant's real data, and
 * refusing the whole session over a hole would throw away exactly the sessions
 * this feature exists to save. The count is reported so the caller can say so
 * in the failure reason.
 *
 * Trial values are emitted VERBATIM rather than parsed and re-serialized: the
 * participant's JSON round-trips byte for byte, and peak memory stays at one
 * copy. Each is still parse-CHECKED, because one malformed value would
 * otherwise corrupt the entire assembled array.
 */
export async function assembleSession(
  sessionId: string
): Promise<AssembledSession> {
  const snap = await rtdb().ref(`staging/${sessionId}/trials`).get();
  if (!snap.exists()) {
    return { data: "[]", trialCount: 0, skipped: 0, truncated: false, gaps: 0 };
  }

  const trials = snap.val() as Record<string, string>;
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

/**
 * Remove a session from the staging tier: its trials and its capability
 * record, in one multi-path update so neither can outlive the other.
 *
 * Dropping openSessions is what makes any onDisconnect the client still has
 * registered a no-op -- database.rules.json denies the write once the node is
 * gone -- so a completed session cannot later be marked abandoned by a socket
 * closing.
 *
 * Best-effort by contract. Every caller has already got the participant's data
 * somewhere durable by the time it calls this, so a failure here is orphaned
 * staging data (which the sweep collects on its next pass) rather than lost
 * data. It must never turn a successful submission into an error response.
 */
export async function discardSession(sessionId: string): Promise<void> {
  try {
    await rtdb()
      .ref()
      .update({
        [`staging/${sessionId}`]: null,
        [`openSessions/${sessionId}`]: null,
      });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(`Failed to discard staging session ${sessionId}: ${detail}`);
  }
}
