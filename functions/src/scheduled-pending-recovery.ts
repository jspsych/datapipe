import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, DocumentReference, DocumentData } from "firebase-admin/firestore";
import { db, storage } from "./app.js";
import putFileOSF from "./put-file-osf.js";
import resolveToken from "./resolve-token.js";
import blockMetadata from "./metadata-block.js";
import writeLog from "./write-log.js";
import { readPendingEnvelope, cleanupPending } from "./persist-pending.js";
import { ExperimentData, UserData, MetadataResponse } from "./interfaces.js";

const PENDING_PREFIX = "pending-data/";

// Files older than this are considered orphaned (the original request
// either OOM-crashed or timed out without cleaning up).
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

// Process at most this many files per run to stay within time/memory limits.
const MAX_FILES_PER_RUN = 10;

/**
 * Scheduled function that runs every 15 minutes to recover data that was
 * persisted to Cloud Storage but never uploaded to OSF (e.g., because the
 * original api-data function OOM-crashed).
 *
 * This replays the full processing pipeline: token resolution, metadata
 * processing, and OSF upload. Memory is kept low (256 MiB) because we
 * process one file at a time without concurrent metadata/OSF operations.
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
      await recoverFile(file);
      processed++;
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Unknown error";
      console.error(`Failed to recover ${file.name}: ${detail}`);
    }
  }

  if (processed > 0) {
    console.log(`Recovered ${processed} pending upload(s).`);
  }
}

async function recoverFile(
  file: ReturnType<ReturnType<typeof storage.bucket>["file"]>
) {
  // Read the envelope which contains all the original request data
  let envelope;
  try {
    envelope = await readPendingEnvelope(file.name);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(`Failed to read pending envelope ${file.name}: ${detail}. Deleting corrupt file.`);
    await file.delete();
    return;
  }

  const { experimentID, filename, data, metadataOptions } = envelope;

  // Look up the experiment
  const expDocRef: DocumentReference<DocumentData> = db.collection("experiments").doc(experimentID);
  const expDoc = await expDocRef.get();
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

  // Look up the owner
  const userDoc = await db.doc(`users/${expData.owner}`).get();
  if (!userDoc.exists) {
    console.warn(`Owner ${expData.owner} not found. Deleting orphaned file ${file.name}.`);
    await cleanupPending(file.name);
    return;
  }

  const userData = userDoc.data() as UserData;

  // Resolve the OSF token
  let token: string;
  try {
    const tokenResult = await resolveToken(userData, expData);
    if (!tokenResult.success) {
      console.error(`Token resolution failed for ${experimentID}: ${tokenResult.error}. Will retry next run.`);
      // Don't delete — token may be temporarily invalid
      return;
    }
    token = tokenResult.token;
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(`Token resolution exception for ${experimentID}: ${detail}. Will retry next run.`);
    return;
  }

  // Run metadata processing if the experiment has it enabled
  if (expData.metadataActive) {
    try {
      const metadataDocRef = db.collection("metadata").doc(experimentID);
      const metadataResponse: MetadataResponse = await blockMetadata(
        expData, userData, metadataDocRef, data, metadataOptions || {}
      );
      if (metadataResponse.success === false) {
        console.warn(`Metadata processing failed for recovered ${experimentID}: ${metadataResponse.message}`);
        // Continue with the data upload — metadata failure shouldn't block data recovery
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Unknown error";
      console.warn(`Metadata exception during recovery for ${experimentID}: ${detail}. Continuing with data upload.`);
    }
  }

  // Upload to OSF
  const result = await putFileOSF(expData.osfFilesLink, token, data, filename);

  if (result.success) {
    console.log(`Successfully recovered and uploaded ${filename} for experiment ${experimentID}.`);
    await cleanupPending(file.name);
    await expDocRef.set({ sessions: FieldValue.increment(1) }, { merge: true });
    await writeLog(experimentID, "saveData");
    return;
  }

  if (result.errorCode === 409) {
    // File already exists in OSF — the original upload may have succeeded
    // after persisting but before cleanup. Safe to delete.
    console.log(`File ${filename} already exists in OSF for ${experimentID}. Cleaning up pending copy.`);
    await cleanupPending(file.name);
    return;
  }

  // Other OSF errors — leave the file for next retry
  console.error(
    `OSF upload failed for recovered ${filename} (experiment ${experimentID}): ${result.errorCode} ${result.errorText}. Will retry next run.`
  );
}
