import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db, storage } from "./app.js";
import { readPendingEnvelope, cleanupPending } from "./persist-pending.js";
import { ExperimentData } from "./interfaces.js";
import { uploadPathFor } from "./metadata-derived-files.js";
import {
  encryptPayload,
  ENCRYPTED_CONTENT_TYPE,
  PayloadDecryptionError,
} from "./payload-crypto.js";

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

/**
 * `prefix` exists as a TEST SEAM and defaults to the production behavior of
 * sweeping every pending file. This sweep is deliberately global and
 * destructive — it promotes whatever it finds and then DELETES the pending
 * file — so a test that runs it unscoped against the shared emulator bucket
 * consumes fixtures belonging to whatever other suite happens to be running
 * in parallel. That caused a long-lived, misleading flake: a different
 * unrelated suite failed with "No such object: .../pending-data/..." roughly
 * one run in three, always passing in isolation. Tests must therefore pass a
 * prefix that scopes the sweep to their own experiment namespace.
 */
export async function recoverPendingUploads(prefix: string = PENDING_PREFIX) {
  const bucket = storage.bucket();
  const cutoffTime = new Date(Date.now() - STALE_THRESHOLD_MS);

  // List files under the pending-data/ prefix (or a narrower, test-scoped one)
  const [files] = await bucket.getFiles({
    prefix,
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
    // An UNDECRYPTABLE envelope is not a corrupt one, and the difference is
    // the difference between a bad week and mass data loss. The pre-existing
    // branch below deletes whatever it cannot read, which was safe when the
    // only way to fail was unparseable JSON. It is catastrophic now: rotating
    // TOKEN_ENCRYPTION_KEY would make every pending object undecryptable at
    // once, and this sweep, running every 15 minutes, would delete all of
    // them. So decryption failures are routed to reportUndecryptable, which
    // preserves the ciphertext (a restored key still recovers it), surfaces
    // the file to the researcher, and lets it age out on the normal 7-day
    // schedule instead of being retried forever.
    if (e instanceof PayloadDecryptionError) {
      await reportUndecryptable(file, e.message);
      return;
    }
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

    // osfFilesLink/storageProvider/providerContainer are included only when
    // present -- Firestore rejects undefined field values, and a gdrive
    // experiment has no osfFilesLink just as a legacy OSF experiment has no
    // storageProvider/providerContainer. Same omit-if-undefined convention as
    // queue-upload.ts, whose callers (api-data.ts) already pass these
    // through; this re-queue path must carry them too, or a recovered
    // pending upload for a gdrive experiment falls back to the legacy OSF
    // shape and fails when scheduled-upload-retry.ts processes it.
    const queueDocData: Record<string, unknown> = {
      experimentID,
      owner: expData.owner,
      filename: uploadFilename,
      storagePath,
      dataType: "data",
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
    };

    if (expData.osfFilesLink !== undefined) {
      queueDocData.osfFilesLink = expData.osfFilesLink;
    }
    if (expData.storageProvider !== undefined) {
      queueDocData.storageProvider = expData.storageProvider;
    }
    if (expData.providerContainer !== undefined) {
      queueDocData.providerContainer = expData.providerContainer;
    }

    transaction.set(docRef, queueDocData);

    return true;
  });

  if (!created) {
    console.log(`Queue entry already exists for ${deduplicationKey}. Cleaning up pending file.`);
    await cleanupPending(file.name);
    return;
  }

  // Write data to upload-queue/ storage (where the queue-status API expects
  // it), encrypted at rest. `data` arrives here already DECRYPTED by
  // readPendingEnvelope, so this is a genuine re-encryption under the same key
  // rather than a pass-through of the pending object's bytes -- the two
  // objects have different lifetimes and this one is what the dashboard's
  // download button and the retry worker both read.
  const bucket = storage.bucket();
  const queueFile = bucket.file(storagePath);
  await queueFile.save(encryptPayload(data), {
    contentType: ENCRYPTED_CONTENT_TYPE,
  });

  // Clean up the pending-data/ file
  await cleanupPending(file.name);

  console.log(`Promoted ${filename} (experiment ${experimentID}) to upload queue.`);
}

/**
 * Recover the experiment id and the researcher's filename from a pending
 * object's path. persistPending builds it as
 * `pending-data/<experimentID>/<safeName>_<timestamp>`, where safeName is the
 * filename with `/` and `\` replaced by `_`. That substitution is not
 * reversible, so the filename recovered here can differ from the original in
 * the (rare) subfolder case -- acceptable, because it is used only as a label
 * on a row the researcher is being shown, never as an upload path.
 */
function describePendingObject(
  objectName: string
): { experimentID: string; filename: string; leaf: string } | null {
  const parts = objectName.split("/");
  if (parts.length < 3 || parts[0] !== "pending-data") return null;
  const experimentID = parts[1];
  const leaf = parts.slice(2).join("/");
  if (!experimentID || !leaf) return null;
  return { experimentID, filename: leaf.replace(/_\d+$/, "") || leaf, leaf };
}

/**
 * Handle a pending object that carries the encryption marker but will not
 * decrypt (rotated key, damaged object).
 *
 * Three properties are required here, and none of them is what the corrupt-file
 * branch does:
 *
 *  - NOT SILENT. The ciphertext is moved into the upload queue as a
 *    permanently failed entry, so it appears in the dashboard's QueuePanel
 *    with a reason, instead of vanishing with only a log line behind it.
 *  - NOT AN INFINITE RETRY. The entry is written `failed`, and the retry
 *    worker only ever queries `status == "pending"`, so it is never attempted
 *    again -- nothing about an undecryptable object improves on the fifth
 *    look. The pending object is then removed, so this 15-minute sweep does
 *    not keep rediscovering it (and does not let it crowd out recoverable
 *    files, since a run processes at most MAX_FILES_PER_RUN).
 *  - NOT DESTRUCTIVE. The bytes are copied verbatim -- still ciphertext, never
 *    re-encrypted -- so if the operator restores the previous key the payload
 *    is recoverable for the rest of its normal 7-day window, after which
 *    cleanupOldEntries removes doc and object together like any other entry.
 *
 * The failureReason reuses the exact "Failed to read cached data" prefix the
 * retry worker emits for the same condition, so QueuePanel's existing copy for
 * it applies without a frontend change, and so both routes to this situation
 * read identically to a researcher.
 */
async function reportUndecryptable(
  file: ReturnType<ReturnType<typeof storage.bucket>["file"]>,
  detail: string
): Promise<void> {
  const described = describePendingObject(file.name);
  if (!described) {
    // Unreachable by construction: persistPending is the only writer under
    // this prefix. If it ever happens there is no experiment to attribute the
    // object to and so no researcher to show it to, and leaving it would make
    // the sweep rediscover it every 15 minutes forever.
    console.error(
      `Undecryptable pending object ${file.name} has an unrecognized path shape; deleting. ${detail}`
    );
    await cleanupPending(file.name);
    return;
  }

  const { experimentID, filename, leaf } = described;

  const expDoc = await db.collection("experiments").doc(experimentID).get();
  const owner = expDoc.exists ? (expDoc.data() as ExperimentData).owner : undefined;
  if (!owner) {
    console.error(
      `Undecryptable pending object ${file.name} belongs to missing experiment ${experimentID}; deleting. ${detail}`
    );
    await cleanupPending(file.name);
    return;
  }

  // Namespaced so it can never collide with a real submission's deduplication
  // key, which means this write can never clobber a live pending/processing
  // entry and needs no transaction. It is also stable for a given object, so a
  // re-run after a failed cleanup simply rewrites the same doc.
  const deduplicationKey = `${experimentID}:undecryptable:${leaf}`;
  const docId = deduplicationKey.replace(/[/\\]/g, "_");
  const storagePath = `upload-queue/${docId}`;

  const [ciphertext] = await file.download();
  await storage.bucket().file(storagePath).save(ciphertext, {
    contentType: ENCRYPTED_CONTENT_TYPE,
  });

  const now = Timestamp.now();
  await db.collection("uploadQueue").doc(docId).set({
    experimentID,
    owner,
    filename,
    storagePath,
    dataType: "data",
    status: "failed",
    errorCode: 0,
    retryCount: MAX_RETRIES,
    maxRetries: MAX_RETRIES,
    createdAt: now,
    lastAttemptAt: now,
    nextRetryAt: null,
    completedAt: null,
    failureReason: `Failed to read cached data: ${detail}`,
    deduplicationKey,
    sessionIncremented: false,
    // Null rather than absent so QueuePanel falls through to failureReason
    // instead of describing a provider failure that never happened.
    providerErrorCode: null,
  });

  await cleanupPending(file.name);

  console.error(
    `Undecryptable pending object ${file.name} reported as failed queue entry ${docId}. ${detail}`
  );
}
