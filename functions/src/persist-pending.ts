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
  // Envelopes persisted before 2026-09-15 may still carry a metadataOptions
  // field (the now-removed unauthenticated write channel — see
  // docs/provider-migration-design.md). It is not declared here and readers
  // must not act on it; JSON.parse leaves it on the parsed object regardless,
  // but nothing destructures it, so it is silently ignored until it ages out
  // under the normal retention window.
  //
  // What kind of string `data` is: "data" for a JSON/CSV submission (api-data.ts),
  // "base64" for a base64-encoded media upload (api-base64.ts). Read by
  // scheduled-pending-recovery.ts's promoteToQueue so a recovered entry takes
  // the same branch in scheduled-upload-retry.ts that the live path would have
  // -- without it, a recovered base64 upload gets written to the provider as
  // literal base64 ASCII text instead of the decoded binary (see
  // scheduled-upload-retry.ts's dataType branch). Optional, and missing is
  // treated as "data": envelopes persisted before this field existed carry no
  // marker and were always plain data/CSV submissions (base64 uploads are the
  // newer path), so that default keeps them promoting correctly.
  dataType?: "data" | "base64";
}

/**
 * Persist incoming request data to Cloud Storage immediately after validation,
 * before any heavy processing. This ensures data survives OOM crashes.
 * Stores the full request envelope so the recovery function can replay the
 * complete processing pipeline including metadata.
 * Returns the storage path for later cleanup.
 */
export async function persistPending(
  experimentID: string,
  filename: string,
  data: string,
  dataType?: "data" | "base64"
): Promise<string> {
  const timestamp = Date.now();
  const safeName = filename.replace(/[/\\]/g, "_");
  const storagePath = `${PENDING_PREFIX}/${experimentID}/${safeName}_${timestamp}`;

  const envelope: PendingEnvelope = { experimentID, filename, data, dataType };

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

/**
 * Label a pending object with WHY it was kept, for scheduled-pending-
 * recovery.ts's promoteToQueue to read back later via `file.getMetadata()`.
 * Today the only reason is "metadata-failure" (api-data.ts's METADATA_ERROR
 * branch), but the parameter is a string union rather than a boolean so a
 * second reason can be added without renaming anything.
 *
 * Same best-effort shape as cleanupPending above, and for the same kind of
 * reason: this is a label for a later reader, not part of the request's own
 * correctness. api-data.ts calls this AFTER it has already responded 400 and
 * written the log entry for a refusal it has fully handled -- a
 * setMetadata failure here must never turn that handled refusal into a 500,
 * and the fallback if the label never lands is simply the generic recovery
 * reason scheduled-pending-recovery.ts already writes for every other
 * orphaned pending object.
 */
export async function markPendingKept(
  storagePath: string,
  reason: "metadata-failure"
): Promise<void> {
  try {
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);
    await file.setMetadata({ metadata: { keptReason: reason } });
  } catch {
    // Non-critical: see doc comment above. Worst case, promoteToQueue falls
    // back to the generic recovery reason it already writes.
  }
}
