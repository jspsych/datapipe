import { storage } from "./app.js";

const PENDING_PREFIX = "pending-data";

/**
 * Persist incoming data to Cloud Storage immediately after validation,
 * before any heavy processing. This ensures data survives OOM crashes.
 * Returns the storage path for later cleanup.
 */
export async function persistPending(
  experimentID: string,
  filename: string,
  data: string
): Promise<string> {
  const timestamp = Date.now();
  const safeName = filename.replace(/[/\\]/g, "_");
  const storagePath = `${PENDING_PREFIX}/${experimentID}/${safeName}_${timestamp}`;
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);
  await file.save(data, { contentType: "text/plain" });
  return storagePath;
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
