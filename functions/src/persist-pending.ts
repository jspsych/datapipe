import { storage } from "./app.js";
import {
  encryptPayload,
  decryptPayload,
  ENCRYPTED_CONTENT_TYPE,
} from "./payload-crypto.js";

const PENDING_PREFIX = "pending-data";

interface PendingEnvelope {
  experimentID: string;
  filename: string;
  data: string;
  metadataOptions?: object;
}

/**
 * Persist incoming request data to Cloud Storage immediately after validation,
 * before any heavy processing. This ensures data survives OOM crashes.
 * Stores the full request envelope (data + metadataOptions) so the recovery
 * function can replay the complete processing pipeline including metadata.
 * Returns the storage path for later cleanup.
 */
export async function persistPending(
  experimentID: string,
  filename: string,
  data: string,
  metadataOptions?: object
): Promise<string> {
  const timestamp = Date.now();
  const safeName = filename.replace(/[/\\]/g, "_");
  const storagePath = `${PENDING_PREFIX}/${experimentID}/${safeName}_${timestamp}`;

  const envelope: PendingEnvelope = { experimentID, filename, data, metadataOptions };

  const bucket = storage.bucket();
  const file = bucket.file(storagePath);
  // Encrypted at rest: this object holds a participant's raw submission for up
  // to 7 days. See payload-crypto.ts.
  await file.save(encryptPayload(JSON.stringify(envelope)), {
    contentType: ENCRYPTED_CONTENT_TYPE,
  });
  return storagePath;
}

/**
 * Read a pending envelope from Cloud Storage.
 *
 * Objects written before payload encryption shipped are plaintext JSON and
 * pass straight through decryptPayload(); marked objects are decrypted. A
 * marked object that will not authenticate throws PayloadDecryptionError,
 * which promoteToQueue in scheduled-pending-recovery.ts handles SEPARATELY
 * from a corrupt envelope -- it must not be deleted as garbage.
 */
export async function readPendingEnvelope(storagePath: string): Promise<PendingEnvelope> {
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);
  const [contents] = await file.download();
  return JSON.parse(decryptPayload(contents).toString("utf-8")) as PendingEnvelope;
}

/**
 * Remove the pending data file after successful processing.
 */
export async function cleanupPending(storagePath: string): Promise<void> {
  try {
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);
    await file.delete();
  } catch {
    // Non-critical: if cleanup fails, the file will remain in storage
    // but won't cause any issues. A scheduled cleanup can handle stragglers.
  }
}
