// The live-sessions mirror: one Firestore document per in-progress streaming
// session, so the experiment dashboard can show how many participants are
// part-way through and for how long -- updating live, through the same
// Firestore listeners every other panel on that page already uses.
//
// WHY A MIRROR, AND WHY IN FIRESTORE
//
// The truth lives in the Realtime Database staging tier, and a researcher's
// browser can never read it. A session id is a WRITE CAPABILITY: whoever holds
// it can append trials to that participant's session. Any RTDB node a
// researcher could subscribe to would hand those ids out. So the server keeps
// this copy instead -- keyed by a one-way hash of the session id, holding no
// participant data -- and firestore.rules lets each researcher read only their
// own experiments' documents.
//
// WHO WRITES IT (all server-side; none of it runs per trial)
//
//   openSession()      staging.ts, at POST /api/session       -> created
//   the trigger        staging-disconnect-trigger.ts, on a
//                      disconnect or reconnect slot write     -> state updated
//   discardSession()   staging.ts: completion, a gate
//                      refusing the submission, the sweep     -> deleted
//   reconcileLiveSessions()  every sweep run                  -> corrected
//
// It is DERIVED STATE, and derived state drifts: a Firestore write at session
// start can fail after the RTDB write succeeded, a delete at completion can
// fail, a trigger can be lost. So every sweep run rebuilds what these documents
// should say from the RTDB ground truth and fixes whatever disagrees. The
// mirror can therefore be wrong for at most one sweep interval (5 minutes), and
// the number of fixes it needed is written to systemStatus/staging -- a write
// path that starts failing shows up there as a non-zero count, not as a
// dashboard that is quietly wrong.

import { createHash } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./app.js";
import {
  ABANDON_GRACE_MS,
  OpenSession,
  SessionMeta,
  disconnectedSince,
} from "./staging-assembly.js";

export const LIVE_SESSIONS = "liveSessions";

/** Most mirror documents one reconciliation pass will look at. */
export const MAX_RECONCILE = 500;

/**
 * The mirror document id for a session.
 *
 * A SHA-256 of the session id, not the id itself: a document id is visible to
 * whoever can read the document, and the session id is a write capability.
 * The session id carries ~143 bits of entropy (staging.ts), so the hash cannot
 * be reversed by guessing. It is deterministic, which is what lets completion
 * and the trigger address the document without an extra database read.
 */
export function publicIdFor(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

/** What a mirror document says, in milliseconds. */
export interface MirrorState {
  experimentID: string;
  owner: string;
  startedAt: number;
  expiresAt: number;
  state: "active" | "disconnected";
  disconnectedAt: number | null;
  /**
   * When a dropout stops being a possible reconnect and becomes "stopped,
   * being recovered". Stored rather than computed in the browser, so the
   * dashboard never needs its own copy of the sweep's grace period.
   */
  recoverAfter: number | null;
}

/** The connection-state half of a mirror document, from a session's meta. */
export function connectionState(
  meta: SessionMeta
): Pick<MirrorState, "state" | "disconnectedAt" | "recoverAfter"> {
  const since = disconnectedSince(meta);
  return since === null
    ? { state: "active", disconnectedAt: null, recoverAfter: null }
    : { state: "disconnected", disconnectedAt: since, recoverAfter: since + ABANDON_GRACE_MS };
}

/** The whole mirror document a session should have, from ground truth. */
export function desiredMirror(
  session: OpenSession,
  owner: string,
  meta: SessionMeta
): MirrorState {
  return {
    experimentID: session.experimentId,
    owner,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    ...connectionState(meta),
  };
}

/** Fields that differ between what a document says and what it should say. */
export function mirrorDiff(
  existing: Partial<MirrorState>,
  desired: MirrorState
): Partial<MirrorState> {
  const diff: Partial<MirrorState> = {};
  for (const key of Object.keys(desired) as Array<keyof MirrorState>) {
    if ((existing[key] ?? null) !== desired[key]) {
      (diff as Record<string, unknown>)[key] = desired[key];
    }
  }
  return diff;
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------

const toTimestamp = (ms: number | null) => (ms === null ? null : Timestamp.fromMillis(ms));

function toFirestore(fields: Partial<MirrorState>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] =
      key === "startedAt" || key === "expiresAt" || key === "disconnectedAt" || key === "recoverAfter"
        ? toTimestamp(value as number | null)
        : value;
  }
  return out;
}

function fromFirestore(data: FirebaseFirestore.DocumentData): Partial<MirrorState> {
  const millis = (v: unknown) =>
    v instanceof Timestamp ? v.toMillis() : v === null || v === undefined ? null : Number(v);
  return {
    experimentID: data.experimentID,
    owner: data.owner,
    startedAt: millis(data.startedAt) ?? undefined,
    expiresAt: millis(data.expiresAt) ?? undefined,
    state: data.state,
    disconnectedAt: millis(data.disconnectedAt),
    recoverAfter: millis(data.recoverAfter),
  };
}

const docFor = (sessionId: string) => db.collection(LIVE_SESSIONS).doc(publicIdFor(sessionId));

/**
 * Create the mirror document for a session that has just been admitted.
 *
 * Best-effort by contract: it runs on the session-start path, and a
 * participant must never be refused a session because the researcher's
 * dashboard copy could not be written. The next sweep backfills a miss.
 */
export async function mirrorStart(sessionId: string, state: MirrorState): Promise<void> {
  try {
    await docFor(sessionId).set(toFirestore(state));
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(`Failed to write live-session mirror for a new session: ${detail}`);
  }
}

/**
 * Update the connection state from a session's meta. Used by the trigger.
 *
 * update(), never set(): if completion has already deleted the document, a
 * late disconnect event must not bring it back as a ghost row on the
 * researcher's dashboard. A missing document is therefore the expected outcome
 * of that race, not an error.
 */
export async function mirrorConnectionState(sessionId: string, meta: SessionMeta): Promise<void> {
  try {
    await docFor(sessionId).update(toFirestore(connectionState(meta)));
  } catch (e) {
    if ((e as { code?: number }).code === 5) return; // NOT_FOUND: already gone
    throw e;
  }
}

/** Remove a session's mirror document. Best-effort; the sweep collects misses. */
export async function removeLiveSession(sessionId: string): Promise<void> {
  try {
    await docFor(sessionId).delete();
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(`Failed to delete live-session mirror: ${detail}`);
  }
}

export interface ReconcileEntry {
  session: OpenSession;
  meta: SessionMeta;
}

export interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
}

/**
 * Make the mirror match the RTDB ground truth.
 *
 * `entries` is every open session (with its meta) as read at `readAt`.
 * `ownerOf` resolves an experiment's owner for a session that predates owner
 * being recorded on openSessions. `stillOpen` re-checks a session immediately
 * before creating its document, because one that completed between the read
 * and now would otherwise come back as a ghost row until the next run.
 *
 * `only` scopes the pass to the given session ids -- the same TEST SEAM as
 * sweepAbandonedSessions, for the same reason: this is destructive, and an
 * unscoped pass against the shared emulator would delete documents belonging
 * to whatever else is running.
 */
export async function reconcileLiveSessions(
  entries: ReconcileEntry[],
  readAt: number,
  ownerOf: (experimentId: string) => Promise<string | null>,
  stillOpen: (sessionId: string) => Promise<boolean>,
  only?: Set<string>
): Promise<ReconcileResult> {
  const result: ReconcileResult = { created: 0, updated: 0, deleted: 0 };

  const scoped = only ? entries.filter((e) => only.has(e.session.sessionId)) : entries;
  const scopedIds = only ? new Set([...only].map(publicIdFor)) : null;

  const snapshot = await db.collection(LIVE_SESSIONS).limit(MAX_RECONCILE).get();
  const existing = new Map<string, Partial<MirrorState>>();
  snapshot.forEach((doc) => {
    if (!scopedIds || scopedIds.has(doc.id)) existing.set(doc.id, fromFirestore(doc.data()));
  });

  const wanted = new Set<string>();
  for (const { session, meta } of scoped) {
    const id = publicIdFor(session.sessionId);
    wanted.add(id);

    const owner = session.owner ?? (await ownerOf(session.experimentId));
    if (!owner) continue; // an orphaned session; the sweep discards it
    const desired = desiredMirror(session, owner, meta);
    const current = existing.get(id);

    if (!current) {
      if (!(await stillOpen(session.sessionId))) continue;
      await db.collection(LIVE_SESSIONS).doc(id).set(toFirestore(desired));
      result.created++;
      continue;
    }
    const diff = mirrorDiff(current, desired);
    if (Object.keys(diff).length > 0) {
      await db.collection(LIVE_SESSIONS).doc(id).update(toFirestore(diff));
      result.updated++;
    }
  }

  for (const [id, doc] of existing) {
    if (wanted.has(id)) continue;
    // A document created AFTER the open-session read belongs to a session this
    // pass never saw, not to one that has ended. Deleting it would wipe a
    // participant who started a second ago off the dashboard until the next
    // run. A minute's margin covers clock skew between the two reads.
    if ((doc.startedAt ?? 0) > readAt - 60_000) continue;
    await db.collection(LIVE_SESSIONS).doc(id).delete();
    result.deleted++;
  }

  return result;
}
