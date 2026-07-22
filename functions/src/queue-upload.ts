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

  // Use set with merge:false — if the doc already exists (pending/processing),
  // the storage write is idempotent and the Firestore write overwrites with fresh data.
  // If it was completed/failed, we re-queue it.
  const existingDoc = await docRef.get();
  if (existingDoc.exists) {
    const status = existingDoc.data()?.status;
    if (status === "pending" || status === "processing") {
      return docId;
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
