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
}

const MAX_RETRIES = 5;

export default async function queueUpload(params: QueueUploadParams): Promise<string> {
  const deduplicationKey = `${params.experimentID}:${params.filename}`;

  // Check for existing pending/processing entry with same key
  const existing = await db
    .collection("uploadQueue")
    .where("deduplicationKey", "==", deduplicationKey)
    .where("status", "in", ["pending", "processing"])
    .limit(1)
    .get();

  if (!existing.empty) {
    return existing.docs[0].id;
  }

  const now = Timestamp.now();
  const nextRetryAt = Timestamp.fromMillis(now.toMillis() + 60 * 60 * 1000); // 1 hour

  const docRef = db.collection("uploadQueue").doc();

  // Write data to Cloud Storage
  const storagePath = `upload-queue/${docRef.id}`;
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
    failureReason: null,
    deduplicationKey,
    sessionIncremented: params.sessionIncremented,
  });

  return docRef.id;
}
