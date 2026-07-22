import { onRequest } from "firebase-functions/v2/https";
import { DocumentReference, DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import isBase64 from "is-base64";
import MESSAGES from "./api-messages.js";
import resolveToken from "./resolve-token.js";
import queueUpload from "./queue-upload.js";
import { persistPending, cleanupPending } from "./persist-pending.js";
import { getProviderForExperiment } from "./providers/index.js";
import { WriteResult } from "./providers/types.js";
import { ExperimentData, UserData } from './interfaces';

export const apiBase64 = onRequest({ cors: true, memory: "512MiB", concurrency: 1 }, async (req, res) => {
  const { experimentID, data, filename } = req.body;

  if (!experimentID || !data || !filename) {
    res.status(400).json(MESSAGES.MISSING_PARAMETER);
    return;
  }

  await writeLog(experimentID, "saveBase64Data");

  const exp_doc_ref: DocumentReference<DocumentData> = db.collection("experiments").doc(experimentID);
  const exp_doc: DocumentSnapshot = await exp_doc_ref.get();

  if (!exp_doc.exists) {
    res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
    await writeLog(experimentID, "logError", MESSAGES.EXPERIMENT_NOT_FOUND);
    return;
  }

  const exp_data: ExperimentData = exp_doc.data() as ExperimentData;

  if (!exp_data) {
    res.status(400).json(MESSAGES.EXPERIMENT_DATA_NOT_FOUND);
    await writeLog(experimentID, "logError", MESSAGES.EXPERIMENT_DATA_NOT_FOUND);
    return;
  }

  if (!exp_data.activeBase64) {
    res.status(400).json(MESSAGES.BASE64DATA_COLLECTION_NOT_ACTIVE);
    await writeLog(experimentID, "logError", MESSAGES.BASE64DATA_COLLECTION_NOT_ACTIVE);
    return;
  }

  if (!isBase64(data, {allowMime: true})) {
    res.status(400).json(MESSAGES.INVALID_BASE64_DATA);
    await writeLog(experimentID, "logError", MESSAGES.INVALID_BASE64_DATA);
    return;
  }

  let buffer: Buffer;

  try {
    // this safely removes the mime type from the base64 data
    const split_data = data.split(",");
    if (split_data.length > 1) {
      buffer = Buffer.from(split_data[1], "base64");
    } else {
      buffer = Buffer.from(data, "base64");
    }
  } catch (e) {
    res.status(400).json(MESSAGES.INVALID_BASE64_DATA);
    await writeLog(experimentID, "logError", MESSAGES.INVALID_BASE64_DATA);
    return;
  }

  // Persist data to Cloud Storage immediately after validation.
  // This ensures the data survives even if the function OOM-crashes
  // during heavy processing (OSF upload).
  let pendingPath: string;
  try {
    pendingPath = await persistPending(experimentID, filename, data);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json(MESSAGES.DATA_PERSIST_ERROR);
    await writeLog(experimentID, "logError", {...MESSAGES.DATA_PERSIST_ERROR, detail});
    return;
  }

  const user_doc = await db.doc(`users/${exp_data.owner}`).get();
  if (!user_doc.exists) {
    res.status(400).json(MESSAGES.INVALID_OWNER);
    await writeLog(experimentID, "logError", MESSAGES.INVALID_OWNER);
    return;
  }

  const user_data: UserData = user_doc.data() as UserData;

  if (!user_data) {
    res.status(400).json(MESSAGES.USER_DATA_NOT_FOUND);
    await writeLog(experimentID, "logError", MESSAGES.USER_DATA_NOT_FOUND);
    return;
  }

  let tokenResult: Awaited<ReturnType<typeof resolveToken>>;
  try {
    tokenResult = await resolveToken(user_data, exp_data);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json(MESSAGES.TOKEN_RESOLUTION_ERROR);
    await writeLog(experimentID, "logError", {...MESSAGES.TOKEN_RESOLUTION_ERROR, detail});
    return;
  }

  if (!tokenResult.success) {
    const errorMessage = MESSAGES[tokenResult.error as keyof typeof MESSAGES] || MESSAGES.TOKEN_RESOLUTION_ERROR;
    res.status(400).json(errorMessage);
    await writeLog(experimentID, "logError", {...errorMessage, detail: tokenResult.detail});
    return;
  }

  const token = tokenResult.token;

  const { provider, container } = getProviderForExperiment(exp_data);

  let result: WriteResult;
  try {
    result = await provider.writeSessionFile(
      { token },
      container,
      filename,
      buffer,
      { size: buffer.length, contentType: "application/octet-stream" }
    );
  } catch (e) {
    // Network errors, timeouts, etc. — queue for retry
    const detail = e instanceof Error ? e.message : "Unknown error";
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename, data,
        dataType: "base64", osfFilesLink: exp_data.osfFilesLink,
        errorCode: 0, sessionIncremented: false,
        failureReason: `Upload exception: ${detail}`,
      });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      res.status(202).json(MESSAGES.OSF_UPLOAD_QUEUED);
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail});
      return;
    } catch {
      res.status(500).json(MESSAGES.OSF_UPLOAD_EXCEPTION);
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail});
      return;
    }
  }

  if (!result.success) {
    if (result.error === "NAME_CONFLICT" && result.providerMessage === "Conflict") {
      res.status(400).json(MESSAGES.OSF_FILE_EXISTS);
      await writeLog(experimentID, "logError", MESSAGES.OSF_FILE_EXISTS);
      return;
    }
    // Queue all other failures for retry
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename, data,
        dataType: "base64", osfFilesLink: exp_data.osfFilesLink,
        errorCode: result.providerStatus || 0, sessionIncremented: false,
        failureReason: `OSF error ${result.providerStatus}: ${result.providerMessage}`,
      });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      res.status(202).json(MESSAGES.OSF_UPLOAD_QUEUED);
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_ERROR, osfStatus: result.providerStatus, osfStatusText: result.providerMessage});
      return;
    } catch {
      res.status(400).json(MESSAGES.OSF_UPLOAD_ERROR);
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_ERROR, osfStatus: result.providerStatus, osfStatusText: result.providerMessage});
      return;
    }
  }

  // Data successfully uploaded to OSF — clean up the pending copy.
  await cleanupPending(pendingPath);

  res.status(201).json(MESSAGES.SUCCESS);
});
