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
//   staging/{sessionId}/meta       { startedAt, lastFlushAt, disconnects/{n}, reconnects/{n} }
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

import { getDatabaseWithUrl, Database } from "firebase-admin/database";
import { customAlphabet } from "nanoid";
import { app } from "./app.js";
import {
  AssembledSession,
  MAX_FILENAME_LENGTH,
  OpenSession,
  SessionMeta,
  SESSION_TTL_MS,
  assembleTrials,
} from "./staging-assembly.js";

// Re-exported so callers have ONE import for the staging tier and do not have
// to know which half a given name lives in. staging-assembly.ts is the module
// to import directly only when the RTDB half must stay out of the graph --
// which is what its own unit tests do.
export * from "./staging-assembly.js";

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
 * Resolved in this order:
 *
 *  1. STAGING_DATABASE_URL -- an explicit override, and the escape hatch if
 *     the resolution below is ever wrong for a project: set it in
 *     functions/.env.<project> to take effect on a deploy. No deployment sets
 *     it today. functions/.env.local sets it for the emulator (see the comment
 *     there for why the emulator needs pinning), and staging-emulator.test.js
 *     sets it in-process to whatever the endpoint reports. NOT named
 *     FIREBASE_DATABASE_URL, which is what this was first called: firebase-tools
 *     reserves the FIREBASE_ prefix and rejects any .env key using it, so an
 *     escape hatch by that name could never actually have been opened.
 *  2. FIREBASE_CONFIG.databaseURL -- the REAL address of the project's default
 *     instance. `firebase deploy` fills it from the Firebase Management API
 *     (projects/{id}/adminSdkConfig), so it is right for an instance in any
 *     region, and the functions emulator fills it with the emulator's own
 *     `http://127.0.0.1:9000/?ns=<instance>` URL. Both were checked against
 *     firebase-tools' source (emulator/adminSdkConfig.js,
 *     emulator/functionsEmulator.js getFirebaseConfig).
 *  3. Derived from the project id. Correct ONLY for a default instance created
 *     in us-central1: an instance in any other region lives at
 *     `<name>.<region>.firebasedatabase.app` instead, and a guess of
 *     `<project>-default-rtdb.firebaseio.com` would fail every session start.
 *     This used to be the only rule. It is kept as the last resort for a
 *     process with no FIREBASE_CONFIG at all -- a Jest suite importing this
 *     module directly.
 *
 * FIREBASE_CONFIG is captured at DEPLOY time. An instance created after the
 * last deploy is invisible to (2) until the next one; the deploy workflows
 * include `--only database`, which fails outright without an instance, so in
 * practice the instance always exists before the functions that need it.
 */
export function stagingDatabaseURL(): string {
  const explicit = process.env.STAGING_DATABASE_URL;
  if (explicit) return explicit;

  const fromConfig = databaseURLFromFirebaseConfig();
  if (fromConfig) return fromConfig;

  const project =
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "Cannot determine the staging database URL: none of STAGING_DATABASE_URL, " +
        "FIREBASE_CONFIG.databaseURL or GCLOUD_PROJECT is set."
    );
  }
  return `https://${project}-default-rtdb.firebaseio.com`;
}

/**
 * FIREBASE_CONFIG's databaseURL, or undefined.
 *
 * Tolerant by design: FIREBASE_CONFIG may be absent (Jest), may be a path to a
 * JSON file rather than JSON (the Admin SDK accepts both), may be malformed, or
 * may carry an empty databaseURL -- which is exactly what the Management API
 * reports for a project with no RTDB instance. Every one of those falls
 * through to the next rule instead of throwing, because this runs on the
 * session-start path and a throw there is a 503 for a reason that has nothing
 * to do with the database.
 */
function databaseURLFromFirebaseConfig(): string | undefined {
  const raw = process.env.FIREBASE_CONFIG;
  if (!raw || !raw.trim().startsWith("{")) return undefined;
  try {
    const url = (JSON.parse(raw) as { databaseURL?: unknown }).databaseURL;
    return typeof url === "string" && url.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Memoized Admin SDK database handle.
 *
 * Deliberately not a module-level constant (and deliberately not in app.ts):
 * resolving a database URL throws when there is none to resolve, and app.ts is
 * imported by every function in this codebase. Doing it here means a project
 * with no RTDB instance provisioned breaks only the staging endpoints, instead
 * of failing to load api-data.ts and api-condition.ts along with them.
 *
 * getDatabaseWithUrl rather than getDatabase: the latter reads the URL out of
 * the app options, which are empty under the emulator and in the Jest suites
 * (initializeApp() in app.ts takes no arguments and FIREBASE_CONFIG is only
 * set inside a deployed function).
 */
function rtdb(): Database {
  if (!cachedDb) cachedDb = getDatabaseWithUrl(stagingDatabaseURL(), app);
  return cachedDb;
}

/** Test seam: drop the memoized handle so a suite can repoint the emulator. */
export function resetStagingHandleForTests(): void {
  cachedDb = null;
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
export async function openSession(
  experimentId: string,
  filename?: string
): Promise<string> {
  const sessionId = generateSessionId();
  const now = Date.now();
  const record: Record<string, unknown> = {
    experimentId,
    startedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  // Omitted rather than written as undefined: RTDB rejects undefined values
  // the same way Firestore does, and an absent filename is a normal state.
  if (filename) record.filename = filename.slice(0, MAX_FILENAME_LENGTH);
  await rtdb().ref(`openSessions/${sessionId}`).set(record);
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
  return assembleTrials(snap.val() as Record<string, string>);
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
