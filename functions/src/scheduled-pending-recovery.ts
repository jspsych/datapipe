import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db, storage } from "./app.js";
import { readPendingEnvelope, cleanupPending } from "./persist-pending.js";
import { ExperimentData } from "./interfaces.js";
import { uploadPathFor } from "./metadata-derived-files.js";

const PENDING_PREFIX = "pending-data/";

// Files older than this are considered orphaned (the original request
// either OOM-crashed or timed out without cleaning up).
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

// Process at most this many files per run to stay within time/memory limits.
const MAX_FILES_PER_RUN = 10;

const MAX_RETRIES = 5;

/**
 * Scheduled function that runs every 15 minutes to recover data that was
 * persisted to Cloud Storage but never uploaded to OSF (e.g., because the
 * original api-data function OOM-crashed).
 *
 * Instead of attempting the OSF upload directly, this function promotes
 * orphaned pending files into the existing uploadQueue system. This means:
 * - The data immediately appears in the researcher's dashboard QueuePanel
 * - The existing scheduled-upload-retry handles retries with exponential backoff
 * - The researcher can download the data manually if all retries fail
 * - No duplicate retry infrastructure is needed
 */
export const scheduledPendingRecovery = onSchedule(
  { schedule: "*/15 * * * *", memory: "256MiB" },
  async () => {
    await recoverPendingUploads();
  }
);

async function recoverPendingUploads() {
  const bucket = storage.bucket();
  const cutoffTime = new Date(Date.now() - STALE_THRESHOLD_MS);

  // List files under pending-data/ prefix
  const [files] = await bucket.getFiles({
    prefix: PENDING_PREFIX,
    maxResults: MAX_FILES_PER_RUN * 2, // fetch extra in case some are too recent
  });

  if (files.length === 0) {
    return;
  }

  let processed = 0;

  for (const file of files) {
    if (processed >= MAX_FILES_PER_RUN) break;

    // Check file age via metadata
    const [metadata] = await file.getMetadata();
    const createdAt = new Date(metadata.timeCreated as string);

    if (createdAt > cutoffTime) {
      // File is recent — the original request may still be processing
      continue;
    }

    console.log(`Recovering pending data: ${file.name}`);

    try {
      await promoteToQueue(file);
      processed++;
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Unknown error";
      console.error(`Failed to recover ${file.name}: ${detail}`);
    }
  }

  if (processed > 0) {
    console.log(`Promoted ${processed} pending file(s) to upload queue.`);
  }
}

/**
 * Promote an orphaned pending file into the uploadQueue system.
 *
 * 1. Read the pending envelope to get experiment/filename/data
 * 2. Look up the experiment to get the owner and osfFilesLink
 * 3. Copy the data to upload-queue/ storage (where queue-status API expects it)
 * 4. Create an uploadQueue Firestore document
 * 5. Clean up the pending-data/ file
 */
export async function promoteToQueue(
  file: ReturnType<ReturnType<typeof storage.bucket>["file"]>
) {
  // Read the envelope
  let envelope;
  try {
    envelope = await readPendingEnvelope(file.name);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(`Failed to read pending envelope ${file.name}: ${detail}. Deleting corrupt file.`);
    await file.delete();
    return;
  }

  const { experimentID, filename, data } = envelope;

  // Look up the experiment to get owner and osfFilesLink
  const expDoc = await db.collection("experiments").doc(experimentID).get();
  if (!expDoc.exists) {
    console.warn(`Experiment ${experimentID} not found. Deleting orphaned file ${file.name}.`);
    await cleanupPending(file.name);
    return;
  }

  const expData = expDoc.data() as ExperimentData;

  if (!expData.owner) {
    console.warn(`Experiment ${experimentID} has no owner. Deleting orphaned file ${file.name}.`);
    await cleanupPending(file.name);
    return;
  }

  // Layout-aware upload path: metadata-active experiments store their raw
  // file at data/raw/, same as api-data.ts's live-submission path. Recovered
  // sessions get no metadata/derived files regenerated here (recovery has no
  // metadata pipeline and the raw file is the source of truth; the next live
  // submission re-merges Firestore metadata into dataset_description.json
  // anyway) — full parity would be separate work.
  const uploadFilename = uploadPathFor(expData.metadataActive, filename);

  // Check for deduplication and atomically create the queue entry via transaction.
  // This prevents duplicate entries if two recovery runs overlap. Keyed off
  // uploadFilename (not the envelope's original filename) so this matches the
  // key api-data.ts uses for the same eventual OSF path — otherwise a crash
  // between queueUpload and cleanupPending could upload the same submission
  // twice, once under each filename.
  const deduplicationKey = `${experimentID}:${uploadFilename}`;
  const docId = deduplicationKey.replace(/[/\\]/g, "_");
  const docRef = db.collection("uploadQueue").doc(docId);

  const storagePath = `upload-queue/${docId}`;

  const created = await db.runTransaction(async (transaction) => {
    const existingDoc = await transaction.get(docRef);
    if (existingDoc.exists) {
      const status = existingDoc.data()?.status;
      if (status === "pending" || status === "processing") {
        return false; // Already queued
      }
    }

    const now = Timestamp.now();
    const nextRetryAt = Timestamp.fromMillis(now.toMillis() + 60 * 1000); // 1 minute — retry soon

    transaction.set(docRef, {
      experimentID,
      owner: expData.owner,
      filename: uploadFilename,
      storagePath,
      dataType: "data",
      osfFilesLink: expData.osfFilesLink,
      status: "pending",
      errorCode: 0,
      retryCount: 0,
      maxRetries: MAX_RETRIES,
      createdAt: now,
      lastAttemptAt: null,
      nextRetryAt,
      completedAt: null,
      failureReason: "Recovered from interrupted upload (server restart or memory limit)",
      deduplicationKey,
      sessionIncremented: false,
    });

    return true;
  });

  if (!created) {
    console.log(`Queue entry already exists for ${deduplicationKey}. Cleaning up pending file.`);
    await cleanupPending(file.name);
    return;
  }

  // Write data to upload-queue/ storage (where the queue-status API expects it)
  const bucket = storage.bucket();
  const queueFile = bucket.file(storagePath);
  await queueFile.save(data, { contentType: "text/plain" });

  // Clean up the pending-data/ file
  await cleanupPending(file.name);

  console.log(`Promoted ${filename} (experiment ${experimentID}) to upload queue.`);
}
