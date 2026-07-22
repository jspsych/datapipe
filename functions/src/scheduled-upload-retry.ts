import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db, storage } from "./app.js";
import { osfProvider } from "./providers/osf.js";
import resolveToken from "./resolve-token.js";
import { ExperimentData, UserData } from "./interfaces.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Scheduled function that runs every hour to retry failed OSF uploads.
 * Processes up to 10 pending items per run, applies exponential backoff,
 * and cleans up entries older than 7 days.
 */
export const scheduledUploadRetry = onSchedule("0 * * * *", async () => {
  await retryPendingUploads();
  await cleanupOldEntries();
});

async function retryPendingUploads() {
  const now = Timestamp.now();

  const pendingItems = await db
    .collection("uploadQueue")
    .where("status", "==", "pending")
    .where("nextRetryAt", "<=", now)
    .orderBy("nextRetryAt", "asc")
    .limit(10)
    .get();

  if (pendingItems.empty) {
    console.log("No pending uploads to retry.");
    return;
  }

  console.log(`Found ${pendingItems.size} pending upload(s) to retry.`);

  // Group by owner to avoid hammering same user's rate limit
  const byOwner = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const doc of pendingItems.docs) {
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

  let token: string;
  try {
    const tokenResult = await resolveToken(userData, expData);
    if (!tokenResult.success) {
      await handleRetryFailure(docRef, data, `Token resolution failed: ${tokenResult.error}`);
      return;
    }
    token = tokenResult.token;
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

  // Attempt the upload
  try {
    const container = { provider: "osf" as const, filesLink: data.osfFilesLink };
    const result = await osfProvider.writeSessionFile(
      { token },
      container,
      data.filename,
      fileData,
      { size: Buffer.byteLength(fileData), contentType: "application/json" }
    );

    if (result.success) {
      await markCompleted(docRef, data);
      console.log(`Successfully retried upload ${queueDoc.id} (${data.filename})`);
      return;
    }

    if (result.error === "NAME_CONFLICT") {
      // File already exists — treat as success (original upload may have worked)
      await markCompleted(docRef, data);
      console.log(`Upload ${queueDoc.id} marked complete — file already exists in OSF.`);
      return;
    }

    await handleRetryFailure(docRef, data, `OSF error ${result.providerStatus}: ${result.providerMessage}`, result.retryAfter);
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

  // Honor Retry-After header if provided, otherwise use exponential backoff
  const backoffMs = retryAfterSeconds
    ? Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS)
    : Math.min(Math.pow(2, newRetryCount) * 60 * 60 * 1000, MAX_BACKOFF_MS);
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
