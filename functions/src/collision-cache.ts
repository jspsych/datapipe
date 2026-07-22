// Firestore-backed filename collision cache (docs/provider-migration-design.md,
// scratchpad/step3a-collision-cache-spec.md).
//
// Duplicate-filename detection moves out of "ask the provider and interpret
// its 409" and into a per-experiment Firestore cache of salted filename
// hashes. The provider's own conflict response stays wired up as a dual-run
// backstop (see api-data.ts / api-base64.ts): callers keep reacting to
// NAME_CONFLICT, but only to reconcile with what the cache already believes.
//
// Firestore layout:
//   experiments/{id}.collisionCache: {
//     salt: string,
//     warmUntil: Timestamp,
//     rehydratingUntil?: Timestamp,
//   }
//   experiments/{id}/filenameClaims/{sha256hex(salt + ":" + filename)}: {
//     status: "pending" | "confirmed",
//     ownerToken: string,
//     createdAt: Timestamp,
//     expiresAt: Timestamp,
//   }
//
// The raw filename is never stored anywhere — only its salted hash, used as
// the claim document's ID.

import { randomBytes, createHash } from "crypto";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db } from "./app.js";
import { FileRef } from "./providers/types.js";

export const CLAIM_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const STALE_PENDING_TAKEOVER_MS = 15 * 60 * 1000; // 15 minutes
export const REHYDRATION_LEASE_MS = 60 * 1000; // 60 seconds

// Thrown when a cold cache needs to rehydrate but the caller-supplied
// listFilesFn fails (e.g. container missing, access revoked). Callers must
// treat this as "we don't know" and fail loudly rather than silently
// accepting a possible duplicate.
export class CollisionCacheUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollisionCacheUnavailableError";
  }
}

export type ClaimResult =
  | { claimed: true }
  | { claimed: false; reason: "duplicate" }
  | { claimed: false; reason: "rehydrating" };

function hashFilename(salt: string, filename: string): string {
  return createHash("sha256").update(`${salt}:${filename}`).digest("hex");
}

function experimentRef(experimentID: string) {
  return db.collection("experiments").doc(experimentID);
}

function claimsCollection(experimentID: string) {
  return experimentRef(experimentID).collection("filenameClaims");
}

// Reads (or lazily creates) the per-experiment salt used to hash filenames.
// The salt is retained indefinitely and never rotated.
async function ensureSalt(experimentID: string): Promise<string> {
  const expRef = experimentRef(experimentID);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(expRef);
    const existingSalt = snap.data()?.collisionCache?.salt as string | undefined;
    if (existingSalt) {
      return existingSalt;
    }
    const salt = randomBytes(32).toString("hex");
    tx.update(expRef, { "collisionCache.salt": salt });
    return salt;
  });
}

async function isCacheWarm(experimentID: string): Promise<boolean> {
  const snap = await experimentRef(experimentID).get();
  const warmUntil = snap.data()?.collisionCache?.warmUntil as FirebaseFirestore.Timestamp | undefined;
  return !!warmUntil && warmUntil.toMillis() > Date.now();
}

// Rehydrates a cold cache: acquires a short lease, lists every file the
// provider currently has, and bulk-writes them as confirmed claims. Returns
// true once the cache is warm, or false if another in-flight request already
// holds the rehydration lease (caller should surface "rehydrating" rather
// than block). Throws CollisionCacheUnavailableError if listFilesFn fails —
// the lease is cleared first so a later request can retry.
async function rehydrate(
  experimentID: string,
  salt: string,
  listFilesFn: () => Promise<FileRef[]>
): Promise<boolean> {
  const expRef = experimentRef(experimentID);

  let acquiredLease = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(expRef);
    const rehydratingUntil = snap.data()?.collisionCache?.rehydratingUntil as
      | FirebaseFirestore.Timestamp
      | undefined;
    if (rehydratingUntil && rehydratingUntil.toMillis() > Date.now()) {
      acquiredLease = false;
      return;
    }
    const leaseUntil = Timestamp.fromMillis(Date.now() + REHYDRATION_LEASE_MS);
    tx.update(expRef, { "collisionCache.rehydratingUntil": leaseUntil });
    acquiredLease = true;
  });

  if (!acquiredLease) {
    return false;
  }

  let files: FileRef[];
  try {
    files = await listFilesFn();
  } catch (e) {
    // Clear the lease so a subsequent claim attempts rehydration again
    // rather than being locked out until the lease naturally expires.
    await expRef.update({ "collisionCache.rehydratingUntil": FieldValue.delete() });
    const detail = e instanceof Error ? e.message : String(e);
    throw new CollisionCacheUnavailableError(
      `Rehydration failed for experiment ${experimentID}: ${detail}`
    );
  }

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + CLAIM_TTL_MS);
  const claims = claimsCollection(experimentID);

  for (let i = 0; i < files.length; i += 500) {
    const chunk = files.slice(i, i + 500);
    const batch = db.batch();
    for (const file of chunk) {
      const hash = hashFilename(salt, file.name);
      batch.set(claims.doc(hash), {
        status: "confirmed",
        ownerToken: "rehydration",
        createdAt: now,
        expiresAt,
      });
    }
    await batch.commit();
  }

  const warmUntil = Timestamp.fromMillis(Date.now() + CLAIM_TTL_MS);
  await expRef.update({
    "collisionCache.warmUntil": warmUntil,
    "collisionCache.rehydratingUntil": FieldValue.delete(),
  });

  return true;
}

async function attemptClaim(
  experimentID: string,
  filename: string,
  ownerToken: string,
  salt: string
): Promise<ClaimResult> {
  const hash = hashFilename(salt, filename);
  const claimRef = claimsCollection(experimentID).doc(hash);

  return db.runTransaction(async (tx): Promise<ClaimResult> => {
    const snap = await tx.get(claimRef);
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + CLAIM_TTL_MS);

    if (!snap.exists) {
      tx.set(claimRef, { status: "pending", ownerToken, createdAt: now, expiresAt });
      return { claimed: true };
    }

    const data = snap.data()!;

    if (data.status === "pending") {
      if (data.ownerToken === ownerToken) {
        // Idempotent re-entry — the retry queue re-claiming its own filename.
        return { claimed: true };
      }

      const createdAtMs = (data.createdAt as FirebaseFirestore.Timestamp).toMillis();
      if (Date.now() - createdAtMs > STALE_PENDING_TAKEOVER_MS) {
        tx.set(claimRef, { status: "pending", ownerToken, createdAt: now, expiresAt });
        return { claimed: true };
      }
    }

    // confirmed, or a fresh pending claim owned by someone else.
    return { claimed: false, reason: "duplicate" };
  });
}

export async function claimFilename(
  experimentID: string,
  filename: string,
  ownerToken: string,
  listFilesFn: () => Promise<FileRef[]>
): Promise<ClaimResult> {
  const salt = await ensureSalt(experimentID);

  const warm = await isCacheWarm(experimentID);
  if (!warm) {
    const nowWarm = await rehydrate(experimentID, salt, listFilesFn);
    if (!nowWarm) {
      return { claimed: false, reason: "rehydrating" };
    }
  }

  return attemptClaim(experimentID, filename, ownerToken, salt);
}

// Best-effort: marks a claim confirmed and bumps the cache's warmUntil.
// Never throws — a confirm failure must not fail the request that already
// succeeded (or was provably a name conflict) against the provider. Missing
// claims / salt / owner mismatches are logged, not thrown.
export async function confirmClaim(
  experimentID: string,
  filename: string,
  ownerToken: string
): Promise<void> {
  try {
    const expRef = experimentRef(experimentID);
    const expSnap = await expRef.get();
    const salt = expSnap.data()?.collisionCache?.salt as string | undefined;
    if (!salt) {
      console.error(
        `confirmClaim: no collisionCache.salt for experiment ${experimentID}; cannot confirm claim`
      );
      return;
    }

    const hash = hashFilename(salt, filename);
    const claimRef = claimsCollection(experimentID).doc(hash);

    // The experiment doc already takes one write per submission (the sessions
    // increment); bumping warmUntil on every confirm would double that under
    // burst load. Skip the bump while warmUntil is still comfortably in the
    // future — a day of drift is irrelevant against a 90-day window.
    const currentWarmUntil = expSnap.data()?.collisionCache?.warmUntil as
      | FirebaseFirestore.Timestamp
      | undefined;

    await db.runTransaction(async (tx) => {
      const claimSnap = await tx.get(claimRef);
      if (!claimSnap.exists) {
        console.error(`confirmClaim: no claim doc found for experiment ${experimentID}`);
        return;
      }

      const data = claimSnap.data()!;
      if (data.ownerToken !== ownerToken) {
        console.error(`confirmClaim: owner token mismatch for experiment ${experimentID}`);
        return;
      }

      const now = Timestamp.now();
      const expiresAt = Timestamp.fromMillis(now.toMillis() + CLAIM_TTL_MS);
      tx.update(claimRef, { status: "confirmed", expiresAt });
      const warmEnough =
        currentWarmUntil &&
        currentWarmUntil.toMillis() > now.toMillis() + CLAIM_TTL_MS - 24 * 60 * 60 * 1000;
      if (!warmEnough) {
        tx.update(expRef, { "collisionCache.warmUntil": expiresAt });
      }
    });
  } catch (e) {
    console.error(
      `confirmClaim failed for experiment ${experimentID}, filename ${filename}:`,
      e instanceof Error ? e.message : e
    );
  }
}

// Deletes a claim only if it is still pending and owned by the given token —
// a no-op with the wrong token or for a confirmed claim.
export async function releaseClaim(
  experimentID: string,
  filename: string,
  ownerToken: string
): Promise<void> {
  const expRef = experimentRef(experimentID);
  const expSnap = await expRef.get();
  const salt = expSnap.data()?.collisionCache?.salt as string | undefined;
  if (!salt) {
    return;
  }

  const hash = hashFilename(salt, filename);
  const claimRef = claimsCollection(experimentID).doc(hash);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(claimRef);
    if (!snap.exists) {
      return;
    }
    const data = snap.data()!;
    if (data.status === "pending" && data.ownerToken === ownerToken) {
      tx.delete(claimRef);
    }
  });
}
