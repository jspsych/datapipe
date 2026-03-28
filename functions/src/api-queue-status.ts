import { onRequest } from "firebase-functions/v2/https";
import archiver from "archiver";
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

    const queueData = queueDoc.data()!;
    const storagePath = queueData.storagePath;
    const filename = queueData.filename;
    const dataType = queueData.dataType;

    try {
      const bucket = storage.bucket();
      const file = bucket.file(storagePath);
      const [contents] = await file.download();
      const raw = contents.toString("utf-8");

      if (dataType === "base64") {
        const split = raw.split(",");
        const base64Data = split.length > 1 ? split[1] : raw;
        const buffer = Buffer.from(base64Data, "base64");

        // Infer content type from filename extension
        const ext = filename.split(".").pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp", wav: "audio/wav",
          mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm",
          pdf: "application/pdf",
        };
        const contentType = mimeTypes[ext || ""] || "application/octet-stream";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.status(200).send(buffer);
      } else {
        const ext = filename.split(".").pop()?.toLowerCase();
        const contentType = ext === "json" ? "application/json" : "text/csv";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.status(200).send(raw);
      }
    } catch {
      res.status(500).json({ error: "Failed to download file" });
    }
    return;
  }

  const downloadAll = req.query.downloadAll as string | undefined;

  if (downloadAll === "true") {
    const queueDocs = await db
      .collection("uploadQueue")
      .where("experimentID", "==", experimentID)
      .where("status", "in", ["pending", "processing", "failed"])
      .get();

    if (queueDocs.empty) {
      res.status(404).json({ error: "No queued files found" });
      return;
    }

    try {
      const bucket = storage.bucket();
      const archive = archiver("zip", { zlib: { level: 5 } });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${experimentID}-queued-files.zip"`);
      archive.pipe(res);

      for (const doc of queueDocs.docs) {
        const data = doc.data();
        const file = bucket.file(data.storagePath);
        const [contents] = await file.download();
        const raw = contents.toString("utf-8");

        if (data.dataType === "base64") {
          const split = raw.split(",");
          const base64Data = split.length > 1 ? split[1] : raw;
          archive.append(Buffer.from(base64Data, "base64"), { name: data.filename });
        } else {
          archive.append(raw, { name: data.filename });
        }
      }

      await archive.finalize();
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to create ZIP archive" });
      }
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
