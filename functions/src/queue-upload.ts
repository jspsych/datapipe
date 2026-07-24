import { Timestamp } from "firebase-admin/firestore";
import { db, storage } from "./app.js";
import { StorageProviderId, ContainerRef } from "./providers/types.js";

interface QueueUploadParams {
  experimentID: string;
  owner: string;
  filename: string;
  data: string;
  dataType: "data" | "base64";
  // Optional — undefined for provider-migrated (e.g. gdrive) experiments,
  // which carry storageProvider/providerContainer instead.
  osfFilesLink?: string;
  errorCode: number;
  sessionIncremented: boolean;
  failureReason?: string;
  claimToken?: string;
  // Provider-migration fields (additive; absent for legacy OSF experiments —
  // omitted from the Firestore write below rather than stored as undefined,
  // since Firestore rejects undefined field values).
  storageProvider?: StorageProviderId;
  providerContainer?: ContainerRef;
}

const MAX_RETRIES = 5;

export default async function queueUpload(params: QueueUploadParams): Promise<string> {
  const deduplicationKey = `${params.experimentID}:${params.filename}`;
  const docId = deduplicationKey.replace(/[/\\]/g, "_");

  const docRef = db.collection("uploadQueue").doc(docId);

  const now = Timestamp.now();
  const nextRetryAt = Timestamp.fromMillis(now.toMillis() + 60 * 60 * 1000); // 1 hour

  // If the doc already exists: a "processing" entry is actively being
  // uploaded, so leave it alone (retry worker owns the storage payload right
  // now). A "pending" entry has the same dedup key by construction — it's the
  // same logical submission having failed before — so refresh its Cloud
  // Storage payload with the latest content and let the existing Firestore
  // doc/status/retry schedule stand, rather than queueing a doc the retry
  // worker can never see because a newer call with fresher data returned
  // early here without ever writing it. Completed/failed docs fall through
  // and get freshly re-queued below.
  const existingDoc = await docRef.get();
  if (existingDoc.exists) {
    const status = existingDoc.data()?.status;
    if (status === "processing") {
      return docId;
    }
    if (status === "pending") {
      const storagePath = `upload-queue/${docId}`;
      const bucket = storage.bucket();
      const file = bucket.file(storagePath);
      await file.save(params.data, { contentType: "text/plain" });
      // The read above is not atomic with this save: the retry worker could
      // claim (pending -> processing) or finish (-> completed/failed, which
      // deletes the storage object) the doc in between. Re-read to confirm.
      // Still pending/processing: the worker either hasn't started or now owns
      // the doc and will read the payload we just wrote — either way we're
      // done. Otherwise the doc finished out from under us and our fresh
      // payload is orphaned, so fall through to re-queue a clean pending doc.
      const recheck = await docRef.get();
      const recheckStatus = recheck.exists ? recheck.data()?.status : undefined;
      if (recheckStatus === "pending" || recheckStatus === "processing") {
        return docId;
      }
    }
  }

  // Write data to Cloud Storage
  const storagePath = `upload-queue/${docId}`;
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);
  await file.save(params.data, { contentType: "text/plain" });

  // Write metadata to Firestore. osfFilesLink/storageProvider/providerContainer
  // are included only when present — Firestore rejects undefined field
  // values, and a gdrive experiment has no osfFilesLink just as a legacy OSF
  // experiment has no storageProvider/providerContainer.
  const queueDocData: Record<string, unknown> = {
    experimentID: params.experimentID,
    owner: params.owner,
    filename: params.filename,
    storagePath,
    dataType: params.dataType,
    status: "pending",
    errorCode: params.errorCode,
    retryCount: 0,
    maxRetries: MAX_RETRIES,
    createdAt: now,
    lastAttemptAt: null,
    nextRetryAt,
    completedAt: null,
    failureReason: params.failureReason || null,
    deduplicationKey,
    sessionIncremented: params.sessionIncremented,
    claimToken: params.claimToken || null,
  };

  if (params.osfFilesLink !== undefined) {
    queueDocData.osfFilesLink = params.osfFilesLink;
  }
  if (params.storageProvider !== undefined) {
    queueDocData.storageProvider = params.storageProvider;
  }
  if (params.providerContainer !== undefined) {
    queueDocData.providerContainer = params.providerContainer;
  }

  await docRef.set(queueDocData);

  return docId;
}
