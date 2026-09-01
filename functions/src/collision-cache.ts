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
//     namespaceVersion?: number,   // absent === 1; see CLAIM_NAMESPACE_VERSION
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

// Identifies the NAMESPACE a cache's claim hashes were written in -- i.e. the
// rule mapping a file to the name that gets hashed. Bump this whenever any
// adapter changes what storedNameFor returns or what listFiles reports, and
// every existing cache is treated as cold and rehydrates itself into the new
// namespace on next use.
//
// Without it such a change is silently unsafe for up to CLAIM_TTL_MS: the
// experiment doc still says warmUntil is in the future, so no rehydration is
// triggered, while every lookup hashes a name in the new namespace and misses
// the old claims. On a provider with no NAME_CONFLICT backstop (Drive) that
// means duplicates written with nothing to catch them.
//
// v2: gdrive listFiles/storedNameFor moved from bare leaf to full
// container-relative path.
export const CLAIM_NAMESPACE_VERSION = 2;

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
  const cache = snap.data()?.collisionCache;
  const warmUntil = cache?.warmUntil as FirebaseFirestore.Timestamp | undefined;
  if (!warmUntil || warmUntil.toMillis() <= Date.now()) return false;
  // A cache warmed under an older naming rule is COLD, however recent it is --
  // its hashes are in a namespace nothing looks up any more. Caches written
  // before versioning have no field at all, which is namespace 1.
  const version = (cache?.namespaceVersion as number | undefined) ?? 1;
  return version === CLAIM_NAMESPACE_VERSION;
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
    // Stamped in the same write that marks the cache warm, so a cache can
    // never be warm without recording which namespace it was warmed in.
    "collisionCache.namespaceVersion": CLAIM_NAMESPACE_VERSION,
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

// Reads the per-experiment salt without creating one. Compaction needs the
// hash of names it already knows about, and an experiment that has never had
// a claim made against it has nothing to seal — so returning null here is a
// normal outcome, not an error, and must not lazily mint a salt the way
// ensureSalt does.
export async function getSalt(experimentID: string): Promise<string | null> {
  const snap = await experimentRef(experimentID).get();
  return (snap.data()?.collisionCache?.salt as string | undefined) ?? null;
}

// The claim document ID for a stored filename. Exported so compaction can
// address claims for files it only knows by name from a provider listing,
// without the raw name ever being written to Firestore (see the header note).
export function claimDocId(salt: string, storedName: string): string {
  return hashFilename(salt, storedName);
}

// Marks claims as belonging to files that now live inside a compaction archive
// rather than as loose files on the provider, and REMOVES their expiresAt so
// Firestore's TTL leaves them alone.
//
// Dropping the TTL is the whole point, and without it compaction quietly
// breaks duplicate detection. A confirmed claim normally expires after
// CLAIM_TTL_MS and that is safe, because a cold cache rehydrates from the
// provider's own listing and re-learns every name. An archived file is no
// longer in that listing — it is a member of a zip — so once its claim
// expires nothing can bring it back, and a resubmission of a filename already
// collected months ago would be accepted as new. These claims therefore have
// to outlive the cache that would otherwise reconstruct them.
//
// Idempotent: re-sealing an already-sealed claim is a no-op write, which
// matters because compaction re-runs this when resuming an interrupted pass.
// A claim that is missing entirely is created as sealed rather than skipped —
// the file provably exists on the provider (compaction just read it out of a
// listing), so the safe state is "claimed", and a claim whose TTL already
// lapsed is exactly the case that would otherwise stay lost.
//
// Takes hashes rather than names on purpose. Compaction records a batch's
// membership BEFORE uploading its archive so an interrupted pass can be
// resumed, and that record lives in Firestore — so it has to be hashes, or
// the header note above ("the raw filename is never stored anywhere") would
// stop being true. Both callers already hold hashes: the first pass derives
// them from the provider listing via claimDocId, and the resume path reads
// them straight off the batch document.
export async function sealClaimHashes(experimentID: string, hashes: string[]): Promise<void> {
  const claims = claimsCollection(experimentID);
  const now = Timestamp.now();

  for (let i = 0; i < hashes.length; i += 500) {
    const chunk = hashes.slice(i, i + 500);
    const batch = db.batch();
    for (const hash of chunk) {
      batch.set(
        claims.doc(hash),
        {
          status: "confirmed",
          sealed: true,
          sealedAt: now,
          ownerToken: "compaction",
          expiresAt: FieldValue.delete(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

// Which of these stored names are already inside an archive. Compaction calls
// this before selecting a batch so an interrupted pass — archive uploaded,
// originals not yet all deleted — never seals the same session twice into two
// different zips.
export async function readSealedNames(
  experimentID: string,
  salt: string,
  storedNames: string[]
): Promise<Set<string>> {
  const sealed = new Set<string>();
  const claims = claimsCollection(experimentID);

  // getAll caps at 500 documents per call, well above a single provider
  // listing, but chunked anyway so this cannot become a latent limit.
  for (let i = 0; i < storedNames.length; i += 300) {
    const chunk = storedNames.slice(i, i + 300);
    if (chunk.length === 0) {
      continue;
    }
    const snaps = await db.getAll(...chunk.map((name) => claims.doc(claimDocId(salt, name))));
    snaps.forEach((snap, index) => {
      if (snap.exists && snap.data()?.sealed === true) {
        sealed.add(chunk[index]);
      }
    });
  }

  return sealed;
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
