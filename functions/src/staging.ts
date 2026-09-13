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
import { mirrorStart, removeLiveSession, connectionState } from "./live-sessions.js";
import {
  AssembledSession,
  MAX_FILENAME_LENGTH,
  MAX_OPEN_SESSIONS_PER_EXPERIMENT,
  OpenSession,
  SessionMeta,
  SESSION_TTL_MS,
  TrialPage,
  assembleTrialsPaged,
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
//
// Kept as named constants, rather than inlined into generateSessionId below,
// because isValidSessionId has to accept EXACTLY this format: a validator
// hand-copied from the generator can silently drift from it, and the two
// disagreeing is exactly the kind of gap a client-supplied id is built to
// find. Sharing the constants makes that impossible instead of merely
// unlikely.
const SESSION_ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SESSION_ID_LENGTH = 24;

// Exported for staging-session-id.test.js: the shared constants above are
// what keep this and isValidSessionId in agreement, but the pure test still
// generates through this function rather than the constants directly, so it
// exercises the same code path openSession does.
export const generateSessionId = customAlphabet(SESSION_ID_ALPHABET, SESSION_ID_LENGTH);

// Anchored, fixed-length, alphabet-only: no "/", no ".", no empty string. The
// RTDB paths this id is spliced into (`staging/${sessionId}`,
// `openSessions/${sessionId}`) are built by ordinary template-string
// concatenation, and the Admin SDK normalizes a path by DROPPING empty
// segments before it ever reaches the wire -- so a sessionId of "/" resolves
// to "/staging" and "/openSessions" themselves, "//" or "../x" do something
// just as wrong, and a non-string reaches here only because a caller skipped
// this check. This pattern is the one gate a value has to clear before it is
// trusted as a path segment rather than a client-controlled string.
const SESSION_ID_PATTERN = new RegExp(`^[${SESSION_ID_ALPHABET}]{${SESSION_ID_LENGTH}}$`);

/** Whether `value` is exactly the format generateSessionId mints -- nothing else. */
export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

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
// Per-experiment concurrency cap
// ---------------------------------------------------------------------------
//
// openSessionCounts/{experimentId} : number of currently-open sessions.
//
// A REVIEW FINDING THIS ANSWERS: one anonymous POST /api/session mints one
// session id, and nothing before this counter existed stopped that call being
// looped -- an experiment id is public (it ships in the experiment's own
// JavaScript), so the cost of an unbounded loop was 640MB-per-session-id of
// RTDB storage, times however many times it was called. The counter below
// bounds it to MAX_OPEN_SESSIONS_PER_EXPERIMENT sessions per experiment,
// however many times the endpoint is called.
//
// Deliberately NOT a per-IP counter: DataPipe's own code must never read or
// store a participant's IP address (pages/docs/privacy.js). This counts
// SESSIONS for an EXPERIMENT, the same unit maxSessions already limits, and
// carries no information about who is opening them.

const OPEN_SESSION_COUNTS_PATH = "openSessionCounts";

/**
 * Reserve one of MAX_OPEN_SESSIONS_PER_EXPERIMENT concurrent staging slots.
 * Returns false, without writing anything else, once the experiment is at
 * its cap.
 *
 * A TRANSACTION, not a read-then-write: two POST /api/session calls for the
 * same experiment arriving together must not both read "499" and both
 * proceed. RTDB retries a transaction against the server's current value on
 * a conflicting write, which a plain get()-then-set() cannot do.
 *
 * SELF-HEALING ON NEGATIVE OR MALFORMED DRIFT: a stored value that is
 * missing, not a number, or negative -- which releaseOpenSessionSlot's own
 * floor should make impossible, but a hand edit or a bug predating this code
 * could still produce -- is treated as zero rather than compounding the error
 * into a cap that can never again be satisfied. This is the "recomputing when
 * the counter goes negative" half of tolerating drift; reconcileOpenSessionCounts
 * below is the other half, for drift that is positive (a missed decrement)
 * rather than negative.
 */
export async function tryAdmitSession(experimentId: string): Promise<boolean> {
  const ref = rtdb().ref(`${OPEN_SESSION_COUNTS_PATH}/${experimentId}`);
  const result = await ref.transaction((current: unknown) => {
    const count = typeof current === "number" && current > 0 ? current : 0;
    if (count >= MAX_OPEN_SESSIONS_PER_EXPERIMENT) return; // undefined aborts the transaction, writing nothing
    return count + 1;
  });
  return result.committed;
}

/**
 * Release a concurrency slot for an experiment. Floored at zero: a decrement
 * that ever ran without (or twice for) a matching increment must not push the
 * counter negative, which would then let in extra sessions until the count
 * climbed back to zero on its own.
 */
export async function releaseOpenSessionSlot(experimentId: string): Promise<void> {
  const ref = rtdb().ref(`${OPEN_SESSION_COUNTS_PATH}/${experimentId}`);
  await ref.transaction((current: unknown) => {
    const count = typeof current === "number" ? current : 0;
    return Math.max(0, count - 1);
  });
}

/**
 * Correct openSessionCounts for a scoped set of experiments against the RTDB
 * ground truth (POSITIVE drift: a missed decrement -- see
 * tryAdmitSession's doc for the negative-drift half of this).
 *
 * Scoped to `experimentIds`, not every counter that has ever existed: the
 * sweep calls this once per run with the experiments its own candidates
 * belong to, which is the same rotating-window approach
 * CANDIDATES_PER_RUN already takes for the sessions themselves -- a
 * stuck-too-high counter is corrected within a few runs rather than this
 * needing an unbounded read of every experiment that has ever streamed. It
 * also keeps a test that scopes a sweep run to its own experiment id (the
 * `only` seam) from correcting -- or racing against -- a counter that
 * belongs to a different, concurrently-running test.
 *
 * `openSessions` is the caller's already-fetched list of every currently-open
 * session (listOpenSessions()), so this performs no additional read of the
 * staging tier itself -- only of the small openSessionCounts table, and only
 * for the experiment ids in scope.
 */
export async function reconcileOpenSessionCounts(
  experimentIds: Iterable<string>,
  openSessions: OpenSession[]
): Promise<number> {
  const ids = [...new Set(experimentIds)];
  if (ids.length === 0) return 0;

  const trueCounts = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const session of openSessions) {
    if (trueCounts.has(session.experimentId)) {
      trueCounts.set(session.experimentId, (trueCounts.get(session.experimentId) as number) + 1);
    }
  }

  const stored = await Promise.all(
    ids.map((id) => rtdb().ref(`${OPEN_SESSION_COUNTS_PATH}/${id}`).get())
  );

  const updates: Record<string, number | null> = {};
  ids.forEach((id, i) => {
    const storedValue = stored[i].exists() ? stored[i].val() : 0;
    const storedCount = typeof storedValue === "number" ? storedValue : 0;
    const truth = trueCounts.get(id) as number;
    if (storedCount !== truth) {
      updates[id] = truth === 0 ? null : truth;
    }
  });

  const fixed = Object.keys(updates).length;
  if (fixed > 0) {
    await rtdb().ref(OPEN_SESSION_COUNTS_PATH).update(updates);
  }
  return fixed;
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
 *
 * Throws (rather than returning a sentinel) when the experiment is at its
 * concurrency cap. api-session-start.ts's existing try/catch around this call
 * turns that into the same 503 SESSION_START_ERROR shape it already returns
 * for an unprovisioned RTDB instance -- the plugin's documented fallback is
 * to submit once at the end, which is the right behaviour here too.
 */
export async function openSession(
  experimentId: string,
  filename: string | undefined,
  owner: string
): Promise<string> {
  const admitted = await tryAdmitSession(experimentId);
  if (!admitted) {
    throw new Error(
      `Experiment ${experimentId} already has ${MAX_OPEN_SESSIONS_PER_EXPERIMENT} sessions open; ` +
        "refusing another until one completes or is recovered."
    );
  }

  try {
    const sessionId = generateSessionId();
    const now = Date.now();
    const record: Record<string, unknown> = {
      experimentId,
      owner,
      startedAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    // Omitted rather than written as undefined: RTDB rejects undefined values
    // the same way Firestore does, and an absent filename is a normal state.
    if (filename) record.filename = filename.slice(0, MAX_FILENAME_LENGTH);
    await rtdb().ref(`openSessions/${sessionId}`).set(record);

    // The researcher's live dashboard copy (live-sessions.ts). Awaited, so it is
    // written before the participant's page gets its response, but best-effort:
    // mirrorStart swallows its own failure, and the sweep backfills a miss.
    await mirrorStart(sessionId, {
      experimentID: experimentId,
      owner,
      startedAt: now,
      expiresAt: now + SESSION_TTL_MS,
      ...connectionState({}),
    });
    return sessionId;
  } catch (e) {
    // The slot was reserved above but nothing that would need its own
    // teardown got written (or mirrorStart already swallowed its failure), so
    // releasing it here is the only cleanup needed to avoid leaking a
    // permanently-reserved slot on a failed admission.
    await releaseOpenSessionSlot(experimentId);
    throw e;
  }
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
  return (await listOpenSessions()).length;
}

/**
 * Every admitted session. One read of the whole capability table, which is
 * small -- one short record per participant currently mid-experiment, deleted
 * the moment they finish. The sweep uses it for its health count and for
 * reconciling the live-sessions mirror, so it is read once per run for both.
 */
export async function listOpenSessions(): Promise<OpenSession[]> {
  const snap = await rtdb().ref("openSessions").get();
  if (!snap.exists()) return [];
  const rows: OpenSession[] = [];
  snap.forEach((child) => {
    rows.push({ sessionId: child.key as string, ...(child.val() as Omit<OpenSession, "sessionId">) });
    return false;
  });
  return rows;
}

// Trials fetched per RTDB round trip during assembly. Small enough that one
// page (ASSEMBLY_PAGE_SIZE x MAX_TRIAL_BYTES, worst case) is a fraction of
// MAX_ASSEMBLED_BYTES, so assembly can stop mid-page without having pulled
// anything close to a full session into memory first -- which is the whole
// point of paging the read at all (see the review finding at the top of this
// file: assembleSession used to `.get()` the entire trials node before its
// size cap applied).
const ASSEMBLY_PAGE_SIZE = 200;

/**
 * Read and assemble a session's staged trials.
 *
 * READ IN PAGES, not one `.get()` of the whole node. `orderByKey()` gives
 * RTDB's native ordering for integer-valued keys, which is numeric ascending
 * -- the same order assembleTrials produces by sorting -- so
 * `.startAfter(lastKey)` resumes exactly where the previous page left off
 * with no re-sorting required. assembleTrialsPaged stops calling this fetcher
 * the moment the accumulated byte size would cross MAX_ASSEMBLED_BYTES, so an
 * over-cap session is truncated without this function ever holding more than
 * one page in memory.
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
  const trialsRef = rtdb().ref(`staging/${sessionId}/trials`);

  const fetchPage = async (afterKey: string | null): Promise<TrialPage> => {
    const query =
      afterKey === null
        ? trialsRef.orderByKey().limitToFirst(ASSEMBLY_PAGE_SIZE)
        : trialsRef.orderByKey().startAfter(afterKey).limitToFirst(ASSEMBLY_PAGE_SIZE);
    const snap = await query.get();
    if (!snap.exists()) return { entries: [], done: true };
    const entries: Array<[string, unknown]> = [];
    snap.forEach((child) => {
      entries.push([child.key as string, child.val()]);
      return false; // keep iterating (forEach cancels on `true`)
    });
    return { entries, done: entries.length < ASSEMBLY_PAGE_SIZE };
  };

  // pagesFetched is a diagnostic for the caller's own tests, not part of the
  // durable result -- discard it here so AssembledSession stays the one shape
  // every caller (the sweep, its tests) already knows.
  const { pagesFetched: _pagesFetched, ...assembled } = await assembleTrialsPaged(fetchPage);
  return assembled;
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
 *
 * Guards its own input, in addition to every caller checking first: this is
 * exported and called from several places (api-data.ts, the sweep), and it is
 * the function that actually splices sessionId into an RTDB path. A value
 * that fails isValidSessionId is refused here even if some future caller
 * forgets to -- logged and returned, never thrown, matching the best-effort
 * contract above. See isValidSessionId for why this matters: "/", "//", and
 * "../x" all normalize to paths this function must never touch.
 */
export async function discardSession(sessionId: string): Promise<void> {
  if (!isValidSessionId(sessionId)) {
    console.warn(
      `Refusing to discard session with an invalid id: ${JSON.stringify(sessionId)}`
    );
    return;
  }

  // Read BEFORE the delete below removes it: releasing this session's
  // concurrency slot needs to know which experiment it belonged to, and
  // openSessions/{sessionId} is the only place that is recorded. Best-effort
  // like everything else here -- a failed read just skips the release, and
  // reconcileOpenSessionCounts corrects the resulting drift on the sweep's
  // next run rather than this turning into a failed discard.
  let experimentId: string | undefined;
  try {
    const snap = await rtdb().ref(`openSessions/${sessionId}/experimentId`).get();
    if (snap.exists()) experimentId = snap.val() as string;
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(
      `Failed to read experimentId while discarding staging session ${sessionId}: ${detail}`
    );
  }

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

  if (experimentId) await releaseOpenSessionSlot(experimentId);

  // And the researcher's dashboard row. Every way a session ends -- clean
  // completion, a gate refusing it, the sweep recovering or discarding it --
  // comes through here, which is why this is the one place that removes it.
  // Separate from the RTDB update on purpose: either can fail without the
  // other being skipped, and the sweep's reconciliation collects what is left.
  await removeLiveSession(sessionId);
}
