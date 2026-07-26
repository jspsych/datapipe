import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db, storage } from "./app.js";
import { getProvider } from "./providers/index.js";
import { ContainerRef, StorageProviderId, ResolvedAuth } from "./providers/types.js";
import resolveToken from "./resolve-token.js";
import { claimFilename, confirmClaim, CollisionCacheUnavailableError } from "./collision-cache.js";
import { ExperimentData, UserData } from "./interfaces.js";
import { isFastRetry } from "./queue-upload.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 hours (slow tier cap, unchanged)
// Fast tier (CONTENTION/RATE_LIMITED, see queue-upload.ts's isFastRetry): a
// much shorter cap, since these clear in seconds/minutes rather than needing
// an outage to end.
const FAST_MAX_BACKOFF_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Scheduled function that runs every 5 minutes to retry failed uploads.
 * Processes up to 25 pending items per run, applies tiered exponential
 * backoff, and cleans up entries older than 7 days.
 *
 * The 5-minute cadence (was hourly) is what makes the fast retry tier real:
 * queueUpload can set a 60-second nextRetryAt for CONTENTION/RATE_LIMITED
 * failures, but that's meaningless if this worker only wakes up once an
 * hour. The query below already gates on `nextRetryAt <= now`, so slow-tier
 * items are unaffected by the faster cadence — they simply aren't due yet
 * most of the times this runs.
 */
export const scheduledUploadRetry = onSchedule("*/5 * * * *", async () => {
  await retryPendingUploads();
  await cleanupOldEntries();
});

/**
 * `ownerScope` is a TEST SEAM, defaulting to production behavior (every
 * pending item). This worker sweeps the whole uploadQueue collection and
 * mutates what it finds, so a test that runs it unscoped against the shared
 * emulator processes whatever other suites have queued -- the same
 * cross-suite hazard that recoverPendingUploads' `prefix` seam exists for
 * (see ddef109). Filtering happens in memory rather than in the query so the
 * production query shape, and therefore its Firestore index, is untouched.
 */
export async function retryPendingUploads(ownerScope?: string) {
  const now = Timestamp.now();

  // 25 items processed serially at ~600ms per provider write is ~15s of
  // work per run — safely inside the scheduled-function budget — and lifts
  // the drain rate from 10/hour (old hourly cadence) to 25 * 12 runs/hour =
  // 300/hour under the new 5-minute cadence.
  const pendingItems = await db
    .collection("uploadQueue")
    .where("status", "==", "pending")
    .where("nextRetryAt", "<=", now)
    .orderBy("nextRetryAt", "asc")
    .limit(25)
    .get();

  const dueDocs = ownerScope
    ? pendingItems.docs.filter((d) => d.data().owner === ownerScope)
    : pendingItems.docs;

  if (dueDocs.length === 0) {
    console.log("No pending uploads to retry.");
    return;
  }

  console.log(`Found ${dueDocs.length} pending upload(s) to retry.`);

  // Group by owner to avoid hammering same user's rate limit
  const byOwner = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const doc of dueDocs) {
    const owner = doc.data().owner;
    if (!byOwner.has(owner)) {
      byOwner.set(owner, []);
    }
    byOwner.get(owner)!.push(doc);
  }

  // Interleave: take one from each owner at a time
  const ordered: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let hasMore = true;
  let index = 0;
  while (hasMore) {
    hasMore = false;
    for (const docs of byOwner.values()) {
      if (index < docs.length) {
        ordered.push(docs[index]);
        hasMore = true;
      }
    }
    index++;
  }

  for (const queueDoc of ordered) {
    await processQueueItem(queueDoc);
  }
}

async function processQueueItem(queueDoc: FirebaseFirestore.QueryDocumentSnapshot) {
  const docRef = queueDoc.ref;
  const data = queueDoc.data();

  // Atomically claim the item
  try {
    await db.runTransaction(async (transaction) => {
      const freshDoc = await transaction.get(docRef);
      if (freshDoc.data()?.status !== "pending") {
        throw new Error("Already claimed");
      }
      transaction.update(docRef, { status: "processing", lastAttemptAt: Timestamp.now() });
    });
  } catch {
    console.log(`Skipping ${queueDoc.id} — already claimed by another instance.`);
    return;
  }

  // Re-resolve the OSF token
  const userDoc = await db.doc(`users/${data.owner}`).get();
  if (!userDoc.exists) {
    await docRef.update({ status: "failed", failureReason: "Owner user not found" });
    return;
  }

  const expDoc = await db.doc(`experiments/${data.experimentID}`).get();
  if (!expDoc.exists) {
    await docRef.update({ status: "failed", failureReason: "Experiment not found" });
    return;
  }

  const userData = userDoc.data() as UserData;
  const expData = expDoc.data() as ExperimentData;

  let auth: ResolvedAuth;
  try {
    const tokenResult = await resolveToken(userData, expData);
    if (!tokenResult.success) {
      await handleRetryFailure(docRef, data, `Token resolution failed: ${tokenResult.error}`);
      return;
    }
    auth = { token: tokenResult.token, serverUrl: tokenResult.serverUrl };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    await handleRetryFailure(docRef, data, `Token resolution exception: ${detail}`);
    return;
  }

  // Read cached data from Cloud Storage
  let fileData: string | Buffer;
  try {
    const bucket = storage.bucket();
    const file = bucket.file(data.storagePath);
    const [contents] = await file.download();
    if (data.dataType === "base64") {
      const raw = contents.toString("utf-8");
      const split = raw.split(",");
      fileData = split.length > 1 ? Buffer.from(split[1], "base64") : Buffer.from(raw, "base64");
    } else {
      fileData = contents.toString("utf-8");
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    await docRef.update({ status: "failed", failureReason: `Failed to read cached data: ${detail}` });
    return;
  }

  // Provider/container come from the queue doc's provider-migration fields
  // when present; legacy entries (queued before this generalization) fall
  // back to the OSF shape built from osfFilesLink.
  const providerId: StorageProviderId = (data.storageProvider as StorageProviderId) || "osf";
  const provider = getProvider(providerId);
  const container: ContainerRef = data.providerContainer
    ? (data.providerContainer as ContainerRef)
    : { provider: "osf", filesLink: data.osfFilesLink };

  // Collision cache: only entries queued after the cache existed carry a
  // claimToken. Entries queued before it skip the cache entirely — legacy
  // behavior, the provider's own conflict backstop still applies to them.
  if (data.claimToken) {
    let claimResult: Awaited<ReturnType<typeof claimFilename>>;
    try {
      claimResult = await claimFilename(data.experimentID, data.filename, data.claimToken, () =>
        provider.listFiles(auth, container)
      );
    } catch (e) {
      if (e instanceof CollisionCacheUnavailableError) {
        await handleRetryFailure(docRef, data, `Collision cache rehydration failed: ${e.message}`);
        return;
      }
      throw e;
    }

    if (!claimResult.claimed) {
      if (claimResult.reason === "duplicate") {
        // Someone else confirmed this name while we were queued — mirrors
        // today's 409-on-retry-means-done semantics.
        await markCompleted(docRef, data);
        console.log(`Upload ${queueDoc.id} marked complete — file already exists in OSF.`);
        return;
      }
      // reason === "rehydrating"
      await handleRetryFailure(docRef, data, "Collision cache rehydrating");
      return;
    }
  }

  // Attempt the upload
  try {
    const result = await provider.writeSessionFile(
      auth,
      container,
      data.filename,
      fileData,
      { size: Buffer.byteLength(fileData), contentType: "application/json" }
    );

    if (result.success) {
      if (data.claimToken) {
        await confirmClaim(data.experimentID, data.filename, data.claimToken);
      }
      await markCompleted(docRef, data);
      console.log(`Successfully retried upload ${queueDoc.id} (${data.filename})`);
      return;
    }

    if (result.error === "NAME_CONFLICT") {
      if (data.claimToken) {
        await confirmClaim(data.experimentID, data.filename, data.claimToken);
      }
      // File already exists — treat as success (original upload may have worked)
      await markCompleted(docRef, data);
      console.log(`Upload ${queueDoc.id} marked complete — file already exists provider-side.`);
      return;
    }

    await handleRetryFailure(docRef, data, `Provider error ${result.providerStatus}: ${result.providerMessage}`, result.retryAfter);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    await handleRetryFailure(docRef, data, `Upload exception: ${detail}`);
  }
}

async function markCompleted(
  docRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData
) {
  await docRef.update({ status: "completed", completedAt: Timestamp.now() });

  // Clean up Cloud Storage
  try {
    const bucket = storage.bucket();
    await bucket.file(data.storagePath).delete();
  } catch {
    // Ignore — cleanup sweep will catch it
  }
}

async function handleRetryFailure(
  docRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  reason: string,
  retryAfterSeconds?: number | null
) {
  const newRetryCount = (data.retryCount || 0) + 1;

  if (newRetryCount >= data.maxRetries) {
    console.error(`Upload ${docRef.id} permanently failed after ${newRetryCount} retries: ${reason}`);
    await docRef.update({
      status: "failed",
      retryCount: newRetryCount,
      failureReason: reason,
    });
    return;
  }

  // Tier the backoff by the provider error code stored on the queue doc (set
  // by queue-upload.ts at initial queue time). CONTENTION/RATE_LIMITED are
  // "the provider is busy right now" and resolve in seconds, unlike
  // AUTH_EXPIRED / QUOTA_EXCEEDED / UNAVAILABLE (or no code at all), which
  // need human action or an outage to end — so the fast tier gets a
  // minutes-scale base/cap (~2, 4, 8, 16, 30 minutes) instead of the
  // hours-scale one (~2, 4, 8, 16, 24 hours, unchanged).
  const fastTier = isFastRetry(data.providerErrorCode);
  const baseMs = fastTier ? 60 * 1000 : 60 * 60 * 1000;
  const capMs = fastTier ? FAST_MAX_BACKOFF_MS : MAX_BACKOFF_MS;

  // Honor Retry-After header if provided, otherwise use exponential backoff.
  // A Retry-After still wins where present, clamped to this item's tier cap.
  const backoffMs = retryAfterSeconds
    ? Math.min(retryAfterSeconds * 1000, capMs)
    : Math.min(Math.pow(2, newRetryCount) * baseMs, capMs);
  const nextRetryAt = Timestamp.fromMillis(Date.now() + backoffMs);

  console.log(`Upload ${docRef.id} retry ${newRetryCount} failed: ${reason}. Next retry at ${nextRetryAt.toDate().toISOString()}`);

  await docRef.update({
    status: "pending",
    retryCount: newRetryCount,
    nextRetryAt,
  });
}

async function cleanupOldEntries() {
  const cutoff = Timestamp.fromMillis(Date.now() - SEVEN_DAYS_MS);

  const oldEntries = await db
    .collection("uploadQueue")
    .where("createdAt", "<=", cutoff)
    .limit(50)
    .get();

  if (oldEntries.empty) {
    return;
  }

  console.log(`Cleaning up ${oldEntries.size} old queue entries.`);

  const bucket = storage.bucket();

  for (const doc of oldEntries.docs) {
    const data = doc.data();
    try {
      await bucket.file(data.storagePath).delete();
    } catch {
      // File may already be deleted
    }
    await doc.ref.delete();
  }
}
