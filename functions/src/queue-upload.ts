import { Timestamp } from "firebase-admin/firestore";
import { db, storage } from "./app.js";

interface QueueUploadParams {
  experimentID: string;
  owner: string;
  filename: string;
  data: string;
  dataType: "data" | "base64";
  osfFilesLink: string;
  errorCode: number;
  sessionIncremented: boolean;
  failureReason?: string;
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

  // Write metadata to Firestore
  await docRef.set({
    experimentID: params.experimentID,
    owner: params.owner,
    filename: params.filename,
    storagePath,
    dataType: params.dataType,
    osfFilesLink: params.osfFilesLink,
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
  });

  return docId;
}
