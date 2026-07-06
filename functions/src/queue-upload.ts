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
