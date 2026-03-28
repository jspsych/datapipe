import { onRequest } from "firebase-functions/v2/https";
import { db, auth, storage } from "./app.js";

export const apiQueueStatus = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Verify Firebase Auth token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let uid: string;
  try {
    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    uid = decodedToken.uid;
  } catch {
    res.status(401).json({ error: "Invalid authentication token" });
    return;
  }

  const experimentID = req.query.experimentID as string;
  if (!experimentID) {
    res.status(400).json({ error: "experimentID query parameter is required" });
    return;
  }

  // Verify the user owns this experiment
  const expDoc = await db.doc(`experiments/${experimentID}`).get();
  if (!expDoc.exists || expDoc.data()?.owner !== uid) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const download = req.query.download as string | undefined;

  if (download) {
    // Return a signed download URL for a specific queue entry
    const queueDoc = await db.doc(`uploadQueue/${download}`).get();
    if (!queueDoc.exists || queueDoc.data()?.experimentID !== experimentID) {
      res.status(404).json({ error: "Queue entry not found" });
      return;
    }

    const storagePath = queueDoc.data()?.storagePath;
    try {
      const bucket = storage.bucket();
      const file = bucket.file(storagePath);
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      });
      res.status(200).json({ url });
    } catch {
      res.status(500).json({ error: "Failed to generate download URL" });
    }
    return;
  }

  // List queue entries for this experiment
  const queueItems = await db
    .collection("uploadQueue")
    .where("experimentID", "==", experimentID)
    .where("status", "in", ["pending", "processing", "failed"])
    .orderBy("createdAt", "desc")
    .get();

  const entries = queueItems.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      filename: data.filename,
      dataType: data.dataType,
      status: data.status,
      errorCode: data.errorCode,
      retryCount: data.retryCount,
      maxRetries: data.maxRetries,
      createdAt: data.createdAt?.toDate().toISOString(),
      lastAttemptAt: data.lastAttemptAt?.toDate().toISOString() || null,
      nextRetryAt: data.nextRetryAt?.toDate().toISOString() || null,
      failureReason: data.failureReason,
    };
  });

  res.status(200).json({ entries, count: entries.length });
});
