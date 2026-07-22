import { onRequest } from "firebase-functions/v2/https";
import { randomUUID } from "crypto";
import { FieldValue, DocumentReference, DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import validateJSON from "./validate-json.js";
import validateCSV from "./validate-csv.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import blockMetadata from "./metadata-block.js";
import resolveToken from "./resolve-token.js";
import queueUpload from "./queue-upload.js";
import { persistPending, cleanupPending } from "./persist-pending.js";
import { getProviderForExperiment } from "./providers/index.js";
import { WriteResult } from "./providers/types.js";
import { claimFilename, confirmClaim, CollisionCacheUnavailableError } from "./collision-cache.js";
import { ExperimentData, UserData, MetadataResponse, RequestBody } from './interfaces';

export const apiData = onRequest({ cors: true, memory: "512MiB", concurrency: 1 }, async (req, res) => {
  const { experimentID, data, filename, metadataOptions }: RequestBody = req.body;

  if (!experimentID || !data || !filename) {
    res.status(400).json(MESSAGES.MISSING_PARAMETER);
    return;
  }

  await writeLog(experimentID, "saveData");

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

  if (!exp_data.active) {
    res.status(400).json(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
    await writeLog(experimentID, "logError", MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
    return;
  }

  if (exp_data.limitSessions) {
    if (exp_data.sessions >= exp_data.maxSessions) {
      res.status(400).json(MESSAGES.SESSION_LIMIT_REACHED);
      await writeLog(experimentID, "logError", MESSAGES.SESSION_LIMIT_REACHED);
      return;
    }
  }

  if (exp_data.useValidation) {
    let valid: boolean = false;
    if (exp_data.allowJSON) {
      const validJSON: boolean = validateJSON(data, exp_data.requiredFields);
      if (validJSON) {
        valid = true;
      }
    }
    if (exp_data.allowCSV && !valid) {
      const validCSV: boolean = validateCSV(data, exp_data.requiredFields);
      if (validCSV) {
        valid = true;
      }
    }
    if (!valid) {
      res.status(400).json(MESSAGES.INVALID_DATA);
      await writeLog(experimentID, "logError", MESSAGES.INVALID_DATA);
      return;
    }
  }

  // Persist data to Cloud Storage immediately after validation.
  // This ensures the data survives even if the function OOM-crashes
  // during heavy processing (metadata, OSF upload).
  let pendingPath: string;
  try {
    pendingPath = await persistPending(experimentID, filename, data, metadataOptions);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json(MESSAGES.DATA_PERSIST_ERROR);
    await writeLog(experimentID, "logError", {...MESSAGES.DATA_PERSIST_ERROR, detail});
    return;
  }

  const user_doc: DocumentSnapshot = await db.doc(`users/${exp_data.owner}`).get();

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

  //METADATA BLOCK START

  let metadataMessage: string = '';

  if (exp_data.metadataActive) {
    //Creates or references a document containing the metadata for the experiment in the metdata collection on Firestore.
    const metadata_doc_ref: DocumentReference<DocumentData> = db.collection("metadata").doc(experimentID);

    const metadataResponse: MetadataResponse = await blockMetadata(exp_data, user_data, metadata_doc_ref, data, metadataOptions);

    if (metadataResponse.success === false) {
      await cleanupPending(pendingPath);
      res.status(400).json(metadataResponse);
      await writeLog(experimentID, "logError", {...MESSAGES.METADATA_ERROR, detail: metadataResponse.message});
      return;
    }

    metadataMessage = metadataResponse.metadataMessage;
  }

  //METADATA BLOCK END

  const { provider, container } = getProviderForExperiment(exp_data);

  // Collision detection: claim the filename in the Firestore cache
  // immediately before the provider write. The provider's own conflict
  // response (NAME_CONFLICT) stays wired up below as a dual-run backstop.
  const claimToken = randomUUID();
  let claimResult: Awaited<ReturnType<typeof claimFilename>>;
  try {
    claimResult = await claimFilename(experimentID, filename, claimToken, () =>
      provider.listFiles({ token }, container)
    );
  } catch (e) {
    if (e instanceof CollisionCacheUnavailableError) {
      const detail = e.message;
      try {
        await queueUpload({
          experimentID, owner: exp_data.owner, filename, data,
          dataType: "data", osfFilesLink: exp_data.osfFilesLink,
          storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
          errorCode: 0, sessionIncremented: true,
          failureReason: `Collision cache rehydration failed: ${detail}`,
          claimToken,
        });
        await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
        await cleanupPending(pendingPath); // queue-upload has its own copy
        res.status(202).json({...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage});
        await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail: `Collision cache rehydration failed: ${detail}`});
        return;
      } catch {
        res.status(500).json({...MESSAGES.OSF_UPLOAD_EXCEPTION, metadataMessage});
        await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail});
        return;
      }
    }
    throw e;
  }

  if (!claimResult.claimed) {
    if (claimResult.reason === "duplicate") {
      res.status(400).json({...MESSAGES.OSF_FILE_EXISTS, metadataMessage});
      await writeLog(experimentID, "logError", MESSAGES.OSF_FILE_EXISTS);
      return;
    }

    // reason === "rehydrating" — another request holds the rehydration
    // lease; queue this upload and let the retry land after it expires.
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename, data,
        dataType: "data", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        errorCode: 0, sessionIncremented: true,
        failureReason: "Collision cache rehydrating",
        claimToken,
      });
      await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      res.status(202).json({...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail: "Collision cache rehydrating"});
      return;
    } catch {
      res.status(500).json({...MESSAGES.OSF_UPLOAD_EXCEPTION, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail: "Collision cache rehydrating"});
      return;
    }
  }

  let result: WriteResult;
  try {
    result = await provider.writeSessionFile(
      { token },
      container,
      filename,
      data,
      { size: Buffer.byteLength(data), contentType: "application/json" }
    );
  } catch (e) {
    // Network errors, timeouts, etc. — queue for retry. The claim stays
    // pending so the retry can re-enter it with the same token.
    const detail = e instanceof Error ? e.message : "Unknown error";
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename, data,
        dataType: "data", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        errorCode: 0, sessionIncremented: true,
        failureReason: `Upload exception: ${detail}`,
        claimToken,
      });
      await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      res.status(202).json({...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail});
      return;
    } catch {
      res.status(500).json({...MESSAGES.OSF_UPLOAD_EXCEPTION, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail});
      return;
    }
  }

  if (!result.success) {
    if (result.error === "NAME_CONFLICT" && result.providerMessage === "Conflict") {
      // Dual-run disagreement: the cache thought the name was free but OSF
      // says it's taken. OSF is still the backstop — record the
      // disagreement and confirm the claim (the name is now provably taken).
      await confirmClaim(experimentID, filename, claimToken);
      res.status(400).json({...MESSAGES.OSF_FILE_EXISTS, metadataMessage});
      await writeLog(experimentID, "logError", MESSAGES.OSF_FILE_EXISTS);
      await writeLog(experimentID, "logError", {
        collisionCacheDisagreement: true,
        direction: "cache-free-provider-conflict",
      });
      return;
    }
    // Queue all other failures for retry. The claim stays pending so the
    // retry can re-enter it with the same token.
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename, data,
        dataType: "data", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        errorCode: result.providerStatus || 0, sessionIncremented: true,
        failureReason: `OSF error ${result.providerStatus}: ${result.providerMessage}`,
        claimToken,
      });
      await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      res.status(202).json({...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_ERROR, osfStatus: result.providerStatus, osfStatusText: result.providerMessage});
      return;
    } catch {
      res.status(400).json({...MESSAGES.OSF_UPLOAD_ERROR, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_ERROR, osfStatus: result.providerStatus, osfStatusText: result.providerMessage});
      return;
    }
  }

  // Successful write — confirm the claim (best-effort; a confirm failure
  // must not fail a request that already succeeded against the provider).
  await confirmClaim(experimentID, filename, claimToken);

  await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });

  // Data successfully uploaded to OSF — clean up the pending copy.
  await cleanupPending(pendingPath);

  res.status(201).json({...MESSAGES.SUCCESS, metadataMessage});
});
