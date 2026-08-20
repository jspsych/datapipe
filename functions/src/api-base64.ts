import { onRequest } from "firebase-functions/v2/https";
import { randomUUID } from "crypto";
import { DocumentReference, DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import isBase64 from "is-base64";
import MESSAGES from "./api-messages.js";
import resolveToken from "./resolve-token.js";
import queueUpload from "./queue-upload.js";
import { persistPending, cleanupPending } from "./persist-pending.js";
import { getProviderForExperiment, claimNameFor } from "./providers/index.js";
import { WriteResult, ResolvedAuth } from "./providers/types.js";
import { claimFilename, confirmClaim, CollisionCacheUnavailableError } from "./collision-cache.js";
import { isCompactionInFlight, COMPACTION_HOLD_REASON } from "./compaction-gate.js";
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

  // Finalization is permanent (docs/finalization-spec.md) -- see the matching
  // comment in api-data.ts for why this is checked ahead of, and independent
  // from, the ordinary activeBase64 flag.
  if (exp_data.finalized) {
    res.status(400).json(MESSAGES.EXPERIMENT_FINALIZED);
    await writeLog(experimentID, "logError", MESSAGES.EXPERIMENT_FINALIZED);
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

  const auth: ResolvedAuth = { token: tokenResult.token, serverUrl: tokenResult.serverUrl };

  const { provider, container } = getProviderForExperiment(exp_data);

  // Collision detection: claim the filename in the Firestore cache
  // immediately before the provider write. The provider's own conflict
  // response (NAME_CONFLICT) stays wired up below as a dual-run backstop.
  // Claimed on the name the PROVIDER will store this file under (see the
  // matching comment in api-data.ts). base64 uploads are not laid out under
  // data/raw/, so the requested path is `filename` itself -- but it still has
  // to go through the adapter's storedNameFor, since Zenodo flattens slashes
  // and Drive keeps only the leaf, and a claim in either of those namespaces
  // has to match what listFiles reports when the cache rehydrates.
  const claimToken = randomUUID();
  const claimName = claimNameFor(provider, filename);
  let claimResult: Awaited<ReturnType<typeof claimFilename>>;
  try {
    claimResult = await claimFilename(experimentID, claimName, claimToken, () =>
      provider.listFiles(auth, container)
    );
  } catch (e) {
    if (e instanceof CollisionCacheUnavailableError) {
      const detail = e.message;
      try {
        await queueUpload({
          experimentID, owner: exp_data.owner, filename, data,
          dataType: "base64", osfFilesLink: exp_data.osfFilesLink,
          storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
          errorCode: 0, sessionIncremented: false,
          failureReason: `Collision cache rehydration failed: ${detail}`,
          claimToken,
        });
        await cleanupPending(pendingPath); // queue-upload has its own copy
        res.status(202).json(MESSAGES.OSF_UPLOAD_QUEUED);
        await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail: `Collision cache rehydration failed: ${detail}`});
        return;
      } catch {
        res.status(500).json(MESSAGES.OSF_UPLOAD_EXCEPTION);
        await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail});
        return;
      }
    }
    throw e;
  }

  if (!claimResult.claimed) {
    if (claimResult.reason === "duplicate") {
      await cleanupPending(pendingPath);
      res.status(400).json(MESSAGES.OSF_FILE_EXISTS);
      await writeLog(experimentID, "logError", MESSAGES.OSF_FILE_EXISTS);
      return;
    }

    // reason === "rehydrating" — another request holds the rehydration
    // lease; queue this upload and let the retry land after it expires.
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename, data,
        dataType: "base64", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        errorCode: 0, sessionIncremented: false,
        failureReason: "Collision cache rehydrating",
        claimToken,
      });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      res.status(202).json(MESSAGES.OSF_UPLOAD_QUEUED);
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail: "Collision cache rehydrating"});
      return;
    } catch {
      res.status(500).json(MESSAGES.OSF_UPLOAD_EXCEPTION);
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail: "Collision cache rehydrating"});
      return;
    }
  }
  // A compaction pass is rearranging this container right now. Holding this
  // submission back is what guarantees the pass has room for the archive it is
  // about to upload -- see compaction-gate.ts. The queue is the same durable
  // buffer that absorbs provider outages, and compaction releases these
  // entries as soon as its pass ends.
  if (isCompactionInFlight(exp_data)) {
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename, data,
        dataType: "base64", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        // false, matching every other queue branch here: a base64 upload is a
        // supplementary media file, not a session.
        errorCode: 0, sessionIncremented: false,
        failureReason: COMPACTION_HOLD_REASON,
        // CONTENTION is precisely this case as types.ts defines it, and puts
        // the entry on the 60-second fast tier.
        providerErrorCode: "CONTENTION",
        claimToken,
      });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      res.status(202).json(MESSAGES.OSF_UPLOAD_QUEUED);
      return;
    } catch {
      res.status(500).json(MESSAGES.OSF_UPLOAD_EXCEPTION);
      return;
    }
  }


  let result: WriteResult;
  try {
    result = await provider.writeSessionFile(
      auth,
      container,
      filename,
      buffer,
      { size: buffer.length, contentType: "application/octet-stream" }
    );
  } catch (e) {
    // Network errors, timeouts, etc. — queue for retry. The claim stays
    // pending so the retry can re-enter it with the same token.
    const detail = e instanceof Error ? e.message : "Unknown error";
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename, data,
        dataType: "base64", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        errorCode: 0, sessionIncremented: false,
        failureReason: `Upload exception: ${detail}`,
        claimToken,
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
      // Dual-run disagreement: the cache thought the name was free but OSF
      // says it's taken. OSF is still the backstop — record the
      // disagreement and confirm the claim (the name is now provably taken).
      await confirmClaim(experimentID, claimName, claimToken);
      // Logs before response — see the matching comment in api-data.ts:
      // responding first races observers of the log against the write.
      await writeLog(experimentID, "logError", MESSAGES.OSF_FILE_EXISTS);
      await writeLog(experimentID, "logError", {
        collisionCacheDisagreement: true,
        direction: "cache-free-provider-conflict",
      });
      await cleanupPending(pendingPath);
      res.status(400).json(MESSAGES.OSF_FILE_EXISTS);
      return;
    }
    // Queue all other failures for retry. The claim stays pending so the
    // retry can re-enter it with the same token.
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename, data,
        dataType: "base64", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        errorCode: result.providerStatus || 0, providerErrorCode: result.error, sessionIncremented: false,
        failureReason: `Provider error ${result.providerStatus}: ${result.providerMessage}`,
        claimToken,
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

  // Successful write — confirm the claim (best-effort; a confirm failure
  // must not fail a request that already succeeded against the provider).
  await confirmClaim(experimentID, claimName, claimToken);

  // Data successfully uploaded to OSF — clean up the pending copy.
  await cleanupPending(pendingPath);

  res.status(201).json(MESSAGES.SUCCESS);
});
