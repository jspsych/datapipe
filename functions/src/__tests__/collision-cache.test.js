/**
 * @jest-environment node
 */

// RED-phase unit tests for step 3a (docs/provider-migration-design.md,
// scratchpad/step3a-collision-cache-spec.md). collision-cache.ts does not
// exist yet — this whole file is expected to fail at module resolution
// until it is implemented.
//
// Style follows upload-queue.test.js: direct Firestore-emulator-backed calls
// against the module's public API, no HTTP layer involved. Every test uses
// its own freshly-generated experiment ID so tests never depend on one
// another's state or ordering.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID, createHash } from "crypto";

import {
  claimFilename,
  confirmClaim,
  releaseClaim,
  CLAIM_TTL_MS,
  STALE_PENDING_TAKEOVER_MS,
  REHYDRATION_LEASE_MS,
  CLAIM_NAMESPACE_VERSION,
  CollisionCacheUnavailableError,
} from "../../lib/collision-cache.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

const config = { projectId: "datapipe-test" };

jest.setTimeout(30000);

let db;

beforeAll(async () => {
  let app;
  try {
    app = getApp("collision-cache-test");
  } catch {
    app = initializeApp(config, "collision-cache-test");
  }
  db = getFirestore(app);
});

// A tolerance window for timestamp assertions — generous enough to absorb
// emulator round-trip latency without hiding a genuinely wrong duration.
const TOLERANCE_MS = 5000;

function freshExperimentId(label) {
  return `collision-${label}-${randomUUID()}`;
}

// Mirrors the spec's hashing rule exactly: sha256hex(salt + ":" + filename).
// Recomputing it locally (rather than trusting the module) lets tests assert
// the doc ID *is* that specific value, not just "some opaque string".
function claimHash(salt, filename) {
  return createHash("sha256").update(`${salt}:${filename}`).digest("hex");
}

async function createExperiment(experimentID, overrides = {}) {
  await db
    .collection("experiments")
    .doc(experimentID)
    .set({
      active: true,
      owner: "collision-test-owner",
      osfFilesLink: "https://example.invalid/files",
      ...overrides,
    });
}

// Pre-warms the cache with a known salt and a future warmUntil so tests that
// aren't *about* rehydration don't incidentally exercise it. Returns the salt
// so callers can compute expected claim-doc hashes.
// Defaults to the CURRENT namespace, because "warm" in almost every test
// means "genuinely usable". Pass namespaceVersion explicitly (or null, for
// the pre-versioning shape) to build a cache that is warm by timestamp but
// stale by namespace.
async function warmExperiment(
  experimentID,
  { salt, warmUntilMs, namespaceVersion = CLAIM_NAMESPACE_VERSION } = {}
) {
  const resolvedSalt = salt || randomUUID().replace(/-/g, "");
  const warmUntil = Timestamp.fromMillis(warmUntilMs ?? Date.now() + 24 * 60 * 60 * 1000);
  const collisionCache = { salt: resolvedSalt, warmUntil };
  if (namespaceVersion !== null) {
    collisionCache.namespaceVersion = namespaceVersion;
  }
  await db.collection("experiments").doc(experimentID).set({ collisionCache }, { merge: true });
  return resolvedSalt;
}

async function getExperimentData(experimentID) {
  const snap = await db.collection("experiments").doc(experimentID).get();
  return snap.data();
}

function claimsCollection(experimentID) {
  return db.collection("experiments").doc(experimentID).collection("filenameClaims");
}

async function getClaimDoc(experimentID, hash) {
  return claimsCollection(experimentID).doc(hash).get();
}

describe("1. first claim on a cold cache", () => {
  it("creates a salt, claims the filename, and never stores the raw filename anywhere in the claim doc", async () => {
    const experimentID = freshExperimentId("first-claim");
    await createExperiment(experimentID);
    const ownerToken = randomUUID();
    const listFilesFn = jest.fn().mockResolvedValue([]);
    const filename = "data.csv";

    const result = await claimFilename(experimentID, filename, ownerToken, listFilesFn);

    expect(result).toEqual({ claimed: true });

    const expData = await getExperimentData(experimentID);
    expect(expData.collisionCache).toBeDefined();
    expect(typeof expData.collisionCache.salt).toBe("string");
    expect(expData.collisionCache.salt.length).toBeGreaterThan(0);

    const claims = await claimsCollection(experimentID).get();
    expect(claims.docs).toHaveLength(1);
    const claimDoc = claims.docs[0];

    // The doc ID must be the salted hash, not the filename itself.
    expect(claimDoc.id).not.toBe(filename);
    expect(claimDoc.id).toBe(claimHash(expData.collisionCache.salt, filename));

    // The raw filename string must not appear anywhere in the stored claim,
    // including the doc ID — serialize everything and grep for it.
    const serialized = JSON.stringify({ id: claimDoc.id, ...claimDoc.data() });
    expect(serialized).not.toContain(filename);

    const data = claimDoc.data();
    expect(data.status).toBe("pending");
    expect(data.ownerToken).toBe(ownerToken);
    expect(data.createdAt).toBeDefined();
    expect(data.expiresAt).toBeDefined();
  });
});

describe("2. duplicate claim from a different owner", () => {
  it("rejects a second claim of an already-pending filename made by a different token", async () => {
    const experimentID = freshExperimentId("dup-diff-token");
    await createExperiment(experimentID);
    await warmExperiment(experimentID);
    const listFilesFn = jest.fn().mockResolvedValue([]);
    const filename = "dup.csv";

    const first = await claimFilename(experimentID, filename, randomUUID(), listFilesFn);
    expect(first).toEqual({ claimed: true });

    const second = await claimFilename(experimentID, filename, randomUUID(), listFilesFn);
    expect(second).toEqual({ claimed: false, reason: "duplicate" });

    // Cache was already warm — rehydration must never have run.
    expect(listFilesFn).not.toHaveBeenCalled();
  });
});

describe("3. idempotent re-entry with the same owner token", () => {
  it("allows the same owner token to re-claim its own pending filename without creating a second doc", async () => {
    const experimentID = freshExperimentId("idempotent");
    await createExperiment(experimentID);
    await warmExperiment(experimentID);
    const listFilesFn = jest.fn().mockResolvedValue([]);
    const ownerToken = randomUUID();
    const filename = "retry.csv";

    const first = await claimFilename(experimentID, filename, ownerToken, listFilesFn);
    expect(first).toEqual({ claimed: true });

    const second = await claimFilename(experimentID, filename, ownerToken, listFilesFn);
    expect(second).toEqual({ claimed: true });

    const claims = await claimsCollection(experimentID).get();
    expect(claims.docs).toHaveLength(1);
  });
});

describe("4. confirmClaim", () => {
  it("marks the claim confirmed, bumps collisionCache.warmUntil forward, and blocks future claims of that filename", async () => {
    const experimentID = freshExperimentId("confirm");
    await createExperiment(experimentID);
    // Warm, but only a little way out — far short of CLAIM_TTL_MS — so a bump
    // from confirmClaim is unambiguous and can't be confused with rehydration
    // (which would also set warmUntil, but only runs on a COLD cache).
    const initialWarmUntilMs = Date.now() + 5 * 60 * 1000;
    const salt = await warmExperiment(experimentID, { warmUntilMs: initialWarmUntilMs });
    const listFilesFn = jest.fn().mockResolvedValue([]);
    const ownerToken = randomUUID();
    const filename = "confirmed.csv";

    await claimFilename(experimentID, filename, ownerToken, listFilesFn);
    expect(listFilesFn).not.toHaveBeenCalled(); // cache was warm

    const beforeConfirm = Date.now();
    await confirmClaim(experimentID, filename, ownerToken);
    const afterConfirm = Date.now();

    const expData = await getExperimentData(experimentID);
    const warmUntilMs = expData.collisionCache.warmUntil.toMillis();
    expect(warmUntilMs).toBeGreaterThan(initialWarmUntilMs);
    expect(warmUntilMs).toBeGreaterThanOrEqual(beforeConfirm + CLAIM_TTL_MS - TOLERANCE_MS);
    expect(warmUntilMs).toBeLessThanOrEqual(afterConfirm + CLAIM_TTL_MS + TOLERANCE_MS);

    const hash = claimHash(salt, filename);
    const claimSnap = await getClaimDoc(experimentID, hash);
    expect(claimSnap.data().status).toBe("confirmed");

    const later = await claimFilename(experimentID, filename, randomUUID(), listFilesFn);
    expect(later).toEqual({ claimed: false, reason: "duplicate" });
  });
});

describe("5. releaseClaim", () => {
  it("deletes an owned pending claim so another token can claim it, and is a no-op with the wrong token", async () => {
    const experimentID = freshExperimentId("release");
    await createExperiment(experimentID);
    await warmExperiment(experimentID);
    const listFilesFn = jest.fn().mockResolvedValue([]);
    const ownerToken = randomUUID();
    const otherToken = randomUUID();
    const filename = "released.csv";

    await claimFilename(experimentID, filename, ownerToken, listFilesFn);

    // Wrong-token release must not touch the claim.
    await releaseClaim(experimentID, filename, otherToken);
    const stillBlocked = await claimFilename(experimentID, filename, otherToken, listFilesFn);
    expect(stillBlocked).toEqual({ claimed: false, reason: "duplicate" });

    // Correct-token release removes it, freeing the filename.
    await releaseClaim(experimentID, filename, ownerToken);
    const reclaimed = await claimFilename(experimentID, filename, otherToken, listFilesFn);
    expect(reclaimed).toEqual({ claimed: true });
  });
});

describe("6. stale pending takeover", () => {
  it("lets a new token take over a pending claim whose createdAt is older than STALE_PENDING_TAKEOVER_MS", async () => {
    const experimentID = freshExperimentId("stale-takeover");
    await createExperiment(experimentID);
    const salt = await warmExperiment(experimentID);
    const staleOwnerToken = randomUUID();
    const filename = "stale.csv";
    const hash = claimHash(salt, filename);

    const staleCreatedAt = Timestamp.fromMillis(Date.now() - STALE_PENDING_TAKEOVER_MS - 60 * 1000);
    await claimsCollection(experimentID)
      .doc(hash)
      .set({
        status: "pending",
        ownerToken: staleOwnerToken,
        createdAt: staleCreatedAt,
        expiresAt: Timestamp.fromMillis(Date.now() + CLAIM_TTL_MS),
      });

    const newToken = randomUUID();
    const listFilesFn = jest.fn().mockResolvedValue([]);
    const result = await claimFilename(experimentID, filename, newToken, listFilesFn);

    expect(result).toEqual({ claimed: true });

    const claimSnap = await getClaimDoc(experimentID, hash);
    expect(claimSnap.data().ownerToken).toBe(newToken);
    expect(claimSnap.data().status).toBe("pending");
    expect(claimSnap.data().createdAt.toMillis()).toBeGreaterThan(staleCreatedAt.toMillis());
  });
});

describe("7. filename and experiment isolation", () => {
  it("claims different filenames independently within an experiment, and hashes an identical filename differently per experiment", async () => {
    const expA = freshExperimentId("iso-a");
    const expB = freshExperimentId("iso-b");
    await createExperiment(expA);
    await createExperiment(expB);
    const saltA = await warmExperiment(expA);
    const saltB = await warmExperiment(expB);
    const listFilesFn = jest.fn().mockResolvedValue([]);
    const sharedFilename = "shared-name.csv";

    const resultOne = await claimFilename(expA, "one.csv", randomUUID(), listFilesFn);
    const resultTwo = await claimFilename(expA, "two.csv", randomUUID(), listFilesFn);
    expect(resultOne).toEqual({ claimed: true });
    expect(resultTwo).toEqual({ claimed: true });

    const resultInB = await claimFilename(expB, sharedFilename, randomUUID(), listFilesFn);
    const resultInA = await claimFilename(expA, sharedFilename, randomUUID(), listFilesFn);
    expect(resultInB).toEqual({ claimed: true });
    expect(resultInA).toEqual({ claimed: true });

    expect(saltA).not.toBe(saltB);
    const hashInA = claimHash(saltA, sharedFilename);
    const hashInB = claimHash(saltB, sharedFilename);
    expect(hashInA).not.toBe(hashInB);

    expect((await getClaimDoc(expA, hashInA)).exists).toBe(true);
    expect((await getClaimDoc(expB, hashInB)).exists).toBe(true);
  });
});

describe("8. expiresAt timing", () => {
  it("sets expiresAt ~CLAIM_TTL_MS in the future on create, and refreshes it forward on confirm", async () => {
    const experimentID = freshExperimentId("expires-at");
    await createExperiment(experimentID);
    const salt = await warmExperiment(experimentID);
    const listFilesFn = jest.fn().mockResolvedValue([]);
    const ownerToken = randomUUID();
    const filename = "ttl.csv";
    const hash = claimHash(salt, filename);

    const beforeClaim = Date.now();
    await claimFilename(experimentID, filename, ownerToken, listFilesFn);
    const afterClaim = Date.now();

    let claimSnap = await getClaimDoc(experimentID, hash);
    const createdExpiresAtMs = claimSnap.data().expiresAt.toMillis();
    expect(createdExpiresAtMs).toBeGreaterThanOrEqual(beforeClaim + CLAIM_TTL_MS - TOLERANCE_MS);
    expect(createdExpiresAtMs).toBeLessThanOrEqual(afterClaim + CLAIM_TTL_MS + TOLERANCE_MS);

    // Small delay so a refreshed expiresAt is unambiguously later, not just
    // equal due to millisecond truncation.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const beforeConfirm = Date.now();
    await confirmClaim(experimentID, filename, ownerToken);
    const afterConfirm = Date.now();

    claimSnap = await getClaimDoc(experimentID, hash);
    const confirmedExpiresAtMs = claimSnap.data().expiresAt.toMillis();
    expect(confirmedExpiresAtMs).toBeGreaterThanOrEqual(beforeConfirm + CLAIM_TTL_MS - TOLERANCE_MS);
    expect(confirmedExpiresAtMs).toBeLessThanOrEqual(afterConfirm + CLAIM_TTL_MS + TOLERANCE_MS);
    expect(confirmedExpiresAtMs).toBeGreaterThanOrEqual(createdExpiresAtMs);
  });
});

describe("9. rehydration on a cold cache", () => {
  it("bulk-confirms every filename listFilesFn returns, calling it exactly once even across multiple claims", async () => {
    const experimentID = freshExperimentId("rehydrate");
    await createExperiment(experimentID); // no collisionCache field at all — cold by construction
    const listFilesFn = jest.fn().mockResolvedValue([{ name: "a.csv" }, { name: "b.csv" }]);

    const beforeRehydrate = Date.now();
    const result = await claimFilename(experimentID, "c.csv", randomUUID(), listFilesFn);

    expect(result).toEqual({ claimed: true }); // c.csv wasn't in the listing
    expect(listFilesFn).toHaveBeenCalledTimes(1);

    const expData = await getExperimentData(experimentID);
    expect(expData.collisionCache.warmUntil.toMillis()).toBeGreaterThanOrEqual(
      beforeRehydrate + CLAIM_TTL_MS - TOLERANCE_MS
    );

    const salt = expData.collisionCache.salt;
    const aSnap = await getClaimDoc(experimentID, claimHash(salt, "a.csv"));
    const bSnap = await getClaimDoc(experimentID, claimHash(salt, "b.csv"));
    expect(aSnap.data().status).toBe("confirmed");
    expect(aSnap.data().ownerToken).toBe("rehydration");
    expect(bSnap.data().status).toBe("confirmed");
    expect(bSnap.data().ownerToken).toBe("rehydration");

    // a.csv is now provably taken via the bulk-written claim from rehydration.
    const dup = await claimFilename(experimentID, "a.csv", randomUUID(), listFilesFn);
    expect(dup).toEqual({ claimed: false, reason: "duplicate" });

    // Neither the c.csv claim nor the a.csv duplicate check should have
    // triggered a second rehydration pass.
    expect(listFilesFn).toHaveBeenCalledTimes(1);
  });
});

describe("10. rehydration lease held by another request", () => {
  it("returns reason 'rehydrating' without calling listFilesFn while another request's lease is active", async () => {
    const experimentID = freshExperimentId("lease-held");
    await createExperiment(experimentID);
    await db
      .collection("experiments")
      .doc(experimentID)
      .set(
        {
          collisionCache: {
            salt: randomUUID().replace(/-/g, ""),
            // warmUntil deliberately absent/past — cache is cold, forcing the
            // rehydration-lease check to run.
            rehydratingUntil: Timestamp.fromMillis(Date.now() + REHYDRATION_LEASE_MS),
          },
        },
        { merge: true }
      );
    const listFilesFn = jest.fn().mockResolvedValue([]);

    const result = await claimFilename(experimentID, "leased.csv", randomUUID(), listFilesFn);

    expect(result).toEqual({ claimed: false, reason: "rehydrating" });
    expect(listFilesFn).not.toHaveBeenCalled();
  });
});

describe("11. rehydration failure", () => {
  it("throws CollisionCacheUnavailableError and clears the lease so a later claim retries rehydration", async () => {
    const experimentID = freshExperimentId("rehydrate-fail");
    await createExperiment(experimentID); // cold cache, no salt yet

    const failingListFiles = jest.fn().mockRejectedValue(new Error("container access revoked"));

    await expect(claimFilename(experimentID, "x.csv", randomUUID(), failingListFiles)).rejects.toThrow(
      CollisionCacheUnavailableError
    );

    const expDataAfterFailure = await getExperimentData(experimentID);
    expect(expDataAfterFailure.collisionCache.rehydratingUntil).toBeFalsy();

    const workingListFiles = jest.fn().mockResolvedValue([]);
    const result = await claimFilename(experimentID, "x.csv", randomUUID(), workingListFiles);

    expect(result).toEqual({ claimed: true });
    expect(workingListFiles).toHaveBeenCalledTimes(1); // rehydration retried, not skipped
  });
});

describe("12. warm cache", () => {
  it("never calls listFilesFn when warmUntil is already in the future", async () => {
    const experimentID = freshExperimentId("warm");
    await createExperiment(experimentID);
    await warmExperiment(experimentID);
    const listFilesFn = jest.fn().mockResolvedValue([]);

    const result = await claimFilename(experimentID, "warm.csv", randomUUID(), listFilesFn);

    expect(result).toEqual({ claimed: true });
    expect(listFilesFn).not.toHaveBeenCalled();
  });
});

// A cache is only usable if its hashes are in the namespace the code will
// look them up under. When an adapter changes what it claims or reports (see
// CLAIM_NAMESPACE_VERSION), a cache warmed under the old rule holds hashes
// nothing will ever match again -- so it has to read as COLD despite a
// warmUntil far in the future, or every lookup misses in silence for up to
// the 90-day TTL. On Drive, which has no NAME_CONFLICT backstop, that window
// is duplicates written with nothing to catch them.
describe("13. namespace versioning", () => {
  it("treats a cache warmed under an older namespace as cold and rehydrates it", async () => {
    const experimentID = freshExperimentId("ns-old");
    await createExperiment(experimentID);
    const salt = await warmExperiment(experimentID, {
      namespaceVersion: CLAIM_NAMESPACE_VERSION - 1,
    });
    const listFilesFn = jest.fn().mockResolvedValue([{ name: "data/raw/existing.json" }]);

    // Rehydration runs despite warmUntil being in the future...
    const result = await claimFilename(experimentID, "fresh.json", randomUUID(), listFilesFn);
    expect(listFilesFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ claimed: true });

    // ...and the listing it pulled in is now claimable-against, in the new
    // namespace, under the full path the adapter reports.
    const dup = await claimFilename(
      experimentID,
      "data/raw/existing.json",
      randomUUID(),
      listFilesFn
    );
    expect(dup).toEqual({ claimed: false, reason: "duplicate" });

    const after = await getExperimentData(experimentID);
    expect(after.collisionCache.namespaceVersion).toBe(CLAIM_NAMESPACE_VERSION);
    expect(after.collisionCache.salt).toBe(salt); // salt is never rotated
  });

  it("treats a pre-versioning cache (no namespaceVersion field) as namespace 1", async () => {
    const experimentID = freshExperimentId("ns-absent");
    await createExperiment(experimentID);
    await warmExperiment(experimentID, { namespaceVersion: null });
    const listFilesFn = jest.fn().mockResolvedValue([]);

    await claimFilename(experimentID, "fresh.json", randomUUID(), listFilesFn);

    expect(listFilesFn).toHaveBeenCalledTimes(1);
    const after = await getExperimentData(experimentID);
    expect(after.collisionCache.namespaceVersion).toBe(CLAIM_NAMESPACE_VERSION);
  });

  it("does not re-rehydrate a cache already warm in the current namespace", async () => {
    const experimentID = freshExperimentId("ns-current");
    await createExperiment(experimentID);
    await warmExperiment(experimentID, { namespaceVersion: CLAIM_NAMESPACE_VERSION });
    const listFilesFn = jest.fn().mockResolvedValue([]);

    await claimFilename(experimentID, "fresh.json", randomUUID(), listFilesFn);

    expect(listFilesFn).not.toHaveBeenCalled();
  });
});
