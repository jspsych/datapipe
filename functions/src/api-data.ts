import { onRequest } from "firebase-functions/v2/https";
import { randomUUID } from "crypto";
import { FieldValue, DocumentReference, DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import validateJSON from "./validate-json.js";
import validateCSV from "./validate-csv.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import blockMetadata from "./metadata-block.js";
import { DerivedFile, uploadPathFor } from "./metadata-derived-files.js";
import { uploadDerivedFiles, queueDerivedFiles } from "./metadata-derived-upload.js";
import resolveToken from "./resolve-token.js";
import queueUpload from "./queue-upload.js";
import { persistPending, cleanupPending } from "./persist-pending.js";
import { getProviderForExperiment, claimNameFor } from "./providers/index.js";
import { WriteResult, ResolvedAuth } from "./providers/types.js";
import { claimFilename, confirmClaim, CollisionCacheUnavailableError } from "./collision-cache.js";
import { isCompactionInFlight, COMPACTION_HOLD_REASON } from "./compaction-gate.js";
import { ExperimentData, UserData, RequestBody } from './interfaces';

export const apiData = onRequest({ cors: true, memory: "512MiB", concurrency: 1 }, async (req, res) => {
  const { experimentID, data, filename, metadataOptions }: RequestBody = req.body;

  if (!experimentID || !data || !filename) {
    res.status(400).json(MESSAGES.MISSING_PARAMETER);
    return;
  }

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

  // Identity for every log write below. Reading it costs nothing extra --
  // exp_doc is already in hand -- and it is what makes logs/{id} readable by
  // its owner at all (firestore.rules) and groupable by provider.
  const logContext = { owner: exp_data.owner, storageProvider: exp_data.storageProvider };

  // The attempt is counted HERE, after the experiment is known to exist,
  // rather than at the top of the handler. Counting first meant every request
  // carrying a mistyped or invented experiment ID created a log document that
  // has no owner -- unreadable by anyone, and unbounded in number. See
  // write-log.ts.
  await writeLog(experimentID, "saveData", undefined, logContext);

  // Finalization is permanent (docs/finalization-spec.md): once an experiment
  // is finalized, every remaining file has been merged into one archive and
  // the originals deleted. A session accepted after that would sit outside
  // the archive and quietly make the record non-Psych-DS again, so this is
  // checked ahead of (and independent from) the ordinary `active` flag --
  // finalizing does not require a researcher to also turn data collection
  // off, and this message is the one that should surface either way.
  if (exp_data.finalized) {
    res.status(400).json(MESSAGES.EXPERIMENT_FINALIZED);
    await writeLog(experimentID, "logError", MESSAGES.EXPERIMENT_FINALIZED, logContext);
    return;
  }

  if (!exp_data.active) {
    res.status(400).json(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
    await writeLog(experimentID, "logError", MESSAGES.DATA_COLLECTION_NOT_ACTIVE, logContext);
    return;
  }

  if (exp_data.limitSessions) {
    if (exp_data.sessions >= exp_data.maxSessions) {
      res.status(400).json(MESSAGES.SESSION_LIMIT_REACHED);
      await writeLog(experimentID, "logError", MESSAGES.SESSION_LIMIT_REACHED, logContext);
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
      await writeLog(experimentID, "logError", MESSAGES.INVALID_DATA, logContext);
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
    await writeLog(experimentID, "logError", {...MESSAGES.DATA_PERSIST_ERROR, detail}, logContext);
    return;
  }

  const user_doc: DocumentSnapshot = await db.doc(`users/${exp_data.owner}`).get();

  if (!user_doc.exists) {
    res.status(400).json(MESSAGES.INVALID_OWNER);
    await writeLog(experimentID, "logError", MESSAGES.INVALID_OWNER, logContext);
    return;
  }

  const user_data: UserData = user_doc.data() as UserData;

  if (!user_data) {
    res.status(400).json(MESSAGES.USER_DATA_NOT_FOUND);
    await writeLog(experimentID, "logError", MESSAGES.USER_DATA_NOT_FOUND, logContext);
    return;
  }

  let tokenResult: Awaited<ReturnType<typeof resolveToken>>;
  try {
    tokenResult = await resolveToken(user_data, exp_data);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json(MESSAGES.TOKEN_RESOLUTION_ERROR);
    await writeLog(experimentID, "logError", {...MESSAGES.TOKEN_RESOLUTION_ERROR, detail}, logContext);
    return;
  }

  if (!tokenResult.success) {
    const errorMessage = MESSAGES[tokenResult.error as keyof typeof MESSAGES] || MESSAGES.TOKEN_RESOLUTION_ERROR;
    res.status(400).json(errorMessage);
    await writeLog(experimentID, "logError", {...errorMessage, detail: tokenResult.detail}, logContext);
    return;
  }

  const auth: ResolvedAuth = { token: tokenResult.token, serverUrl: tokenResult.serverUrl };

  //METADATA BLOCK START

  let metadataMessage: string = '';
  //Psych-DS files derived from this submission (main data CSV, sidecar CSVs
  //for nested columns, .psychds-ignore), produced by the metadata block and
  //uploaded only after the participant's raw data file lands in OSF.
  let derivedFiles: DerivedFile[] = [];

  if (exp_data.metadataActive) {
    //Creates or references a document containing the metadata for the experiment in the metdata collection on Firestore.
    const metadata_doc_ref: DocumentReference<DocumentData> = db.collection("metadata").doc(experimentID);

    const metadataResponse = await blockMetadata(exp_data, auth, metadata_doc_ref, data, filename, metadataOptions);

    if (metadataResponse.success === false) {
      // The pending-data copy is deliberately kept (not cleaned up) here: the
      // participant's raw data never made it to OSF, so scheduled-pending-recovery
      // salvages it later instead of losing it outright.
      res.status(400).json(metadataResponse);
      await writeLog(experimentID, "logError", {...MESSAGES.METADATA_ERROR, detail: metadataResponse.message}, logContext);
      return;
    }

    metadataMessage = metadataResponse.metadataMessage;
    derivedFiles = metadataResponse.derivedFiles ?? [];
  }

  const derivedTarget = {
    experimentID,
    owner: exp_data.owner,
    storageProvider: exp_data.storageProvider,
    providerContainer: exp_data.providerContainer,
    osfFilesLink: exp_data.osfFilesLink,
  };

  //METADATA BLOCK END

  const { provider, container } = getProviderForExperiment(exp_data);

  //With metadata on, the raw submission is the critical upload and lives at
  //data/raw/<original name> in the Psych-DS layout (the CSVs above are derived
  //from it). Session counting and queue-on-failure key off this file. With
  //metadata off, the layout is unchanged: the raw file goes to the root.
  const uploadFilename = uploadPathFor(exp_data.metadataActive, filename);

  // Collision detection: claim the filename in the Firestore cache
  // immediately before the provider write. The provider's own conflict
  // response (NAME_CONFLICT) stays wired up below as a dual-run backstop.
  //
  // Claimed on the name the PROVIDER will store this file under, derived from
  // uploadFilename by that adapter's own storedNameFor. It used to be claimed
  // on the raw leaf filename, which put claims in a different namespace from
  // the listFiles results a cold cache rehydrates from -- so on a rehydrated
  // cache no claim ever matched, and the providers with no NAME_CONFLICT to
  // fall back on silently overwrote (Zenodo) or duplicated (Dataverse) a
  // participant's data. It also disagreed with the retry worker, which claims
  // on the queued upload path, so a queued retry never re-entered its own
  // pending claim.
  const claimToken = randomUUID();
  const claimName = claimNameFor(provider, uploadFilename);
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
          // uploadFilename, not the raw filename: the retry worker writes
          // whatever it finds here, so queueing the raw leaf would drop a
          // metadataActive submission at the container root instead of under
          // data/raw/ (and claim it in the wrong namespace on the way).
          experimentID, owner: exp_data.owner, filename: uploadFilename, data,
          dataType: "data", osfFilesLink: exp_data.osfFilesLink,
          storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
          errorCode: 0, sessionIncremented: true,
          failureReason: `Collision cache rehydration failed: ${detail}`,
          claimToken,
        });
        await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
        await cleanupPending(pendingPath); // queue-upload has its own copy
        res.status(202).json({...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage});
        // The submission is safe (queue-upload.ts holds an encrypted copy) but
        // is not in the researcher's storage yet. Counted apart from both
        // success and failure so that
        //   failed = saveData - saveDataSucceeded - saveDataQueued
        // holds exactly. See write-log.ts.
        await writeLog(experimentID, "saveDataQueued", undefined, logContext);
        await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail: `Collision cache rehydration failed: ${detail}`}, logContext);
        return;
      } catch {
        res.status(500).json({...MESSAGES.OSF_UPLOAD_EXCEPTION, metadataMessage});
        await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail}, logContext);
        return;
      }
    }
    throw e;
  }

  if (!claimResult.claimed) {
    if (claimResult.reason === "duplicate") {
      await cleanupPending(pendingPath);
      res.status(400).json({...MESSAGES.OSF_FILE_EXISTS, metadataMessage});
      await writeLog(experimentID, "logError", MESSAGES.OSF_FILE_EXISTS, logContext);
      return;
    }

    // reason === "rehydrating" — another request holds the rehydration
    // lease; queue this upload and let the retry land after it expires.
    try {
      await queueUpload({
        // uploadFilename for the same reason as the rehydration-failure path
        // above -- the retry worker writes exactly what is queued here.
        experimentID, owner: exp_data.owner, filename: uploadFilename, data,
        dataType: "data", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        errorCode: 0, sessionIncremented: true,
        failureReason: "Collision cache rehydrating",
        claimToken,
      });
      await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      // Same reasoning as the compaction-gate branch below: without this the
      // session's derived tables are never generated at all. Pre-dates the
      // gate and is far rarer (a rehydration lease lasts 60 seconds), but it
      // is the identical hole.
      await queueDerivedFiles(derivedFiles, derivedTarget, "Collision cache rehydrating");
      res.status(202).json({...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage});
      await writeLog(experimentID, "saveDataQueued", undefined, logContext);
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail: "Collision cache rehydrating"}, logContext);
      return;
    } catch {
      res.status(500).json({...MESSAGES.OSF_UPLOAD_EXCEPTION, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail: "Collision cache rehydrating"}, logContext);
      return;
    }
  }

  // A compaction pass is rearranging this container right now. DataPipe is its
  // only writer, so holding this submission back is what guarantees the pass
  // has room for the archive it is about to upload -- see compaction-gate.ts.
  // The queue is the same durable buffer that absorbs provider outages, and
  // compaction releases these entries as soon as its pass ends.
  if (isCompactionInFlight(exp_data)) {
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename: uploadFilename, data,
        dataType: "data", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        errorCode: 0, sessionIncremented: true,
        failureReason: COMPACTION_HOLD_REASON,
        // CONTENTION is exactly this situation as types.ts defines it --
        // "another write to this same container is already in flight" -- and it
        // puts the entry on the 60-second fast tier, so it drains promptly even
        // if the explicit release is missed.
        providerErrorCode: "CONTENTION",
        claimToken,
      });
      await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      // The derived Psych-DS tables have to be queued too. The retry worker
      // only writes back what is in the queue -- it never re-runs the metadata
      // pipeline -- so queueing the raw file alone means this session's
      // data/<base>_data.csv is never produced at all. The raw file is the
      // source of truth and no submitted data is lost either way, but the
      // dataset ends up missing derived tables for every session the gate
      // diverted, which is a Psych-DS dataset with holes in it. Observed live:
      // 44 loose raw sessions against 10 derived CSVs.
      await queueDerivedFiles(derivedFiles, derivedTarget, COMPACTION_HOLD_REASON, "CONTENTION");
      res.status(202).json({...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage});
      await writeLog(experimentID, "saveDataQueued", undefined, logContext);
      return;
    } catch {
      res.status(500).json({...MESSAGES.OSF_UPLOAD_EXCEPTION, metadataMessage});
      return;
    }
  }

  let result: WriteResult;
  try {
    result = await provider.writeSessionFile(
      auth,
      container,
      uploadFilename,
      data,
      { size: Buffer.byteLength(data), contentType: "application/json" }
    );
  } catch (e) {
    // Network errors, timeouts, etc. — queue for retry. The claim stays
    // pending so the retry can re-enter it with the same token.
    const detail = e instanceof Error ? e.message : "Unknown error";
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename: uploadFilename, data,
        dataType: "data", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        errorCode: 0, sessionIncremented: true,
        failureReason: `Upload exception: ${detail}`,
        claimToken,
      });
      await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      // OSF is unreachable, so queue the derived files alongside the raw data.
      await queueDerivedFiles(derivedFiles, derivedTarget, `Queued alongside data file: ${detail}`);
      res.status(202).json({...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage});
      await writeLog(experimentID, "saveDataQueued", undefined, logContext);
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail}, logContext);
      return;
    } catch {
      res.status(500).json({...MESSAGES.OSF_UPLOAD_EXCEPTION, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_EXCEPTION, detail}, logContext);
      return;
    }
  }

  if (!result.success) {
    if (result.error === "NAME_CONFLICT" && result.providerMessage === "Conflict") {
      // Dual-run disagreement: the cache thought the name was free but OSF
      // says it's taken. OSF is still the backstop — record the
      // disagreement and confirm the claim (the name is now provably taken).
      await confirmClaim(experimentID, claimName, claimToken);
      // Logs are written BEFORE the response here (unlike other branches):
      // the disagreement entry is the dual-run's whole audit trail, and
      // responding first races observers of the log against the write.
      await writeLog(experimentID, "logError", MESSAGES.OSF_FILE_EXISTS, logContext);
      await writeLog(experimentID, "logError", {
        // Carries an `error` code like every other entry so it lands in its
        // own errorsByCode bucket instead of the UNCODED catch-all -- a
        // dual-run disagreement is exactly the kind of thing worth counting
        // per provider. The boolean stays for the existing audit trail.
        error: "COLLISION_CACHE_DISAGREEMENT",
        collisionCacheDisagreement: true,
        direction: "cache-free-provider-conflict",
      }, logContext);
      await cleanupPending(pendingPath);
      res.status(400).json({...MESSAGES.OSF_FILE_EXISTS, metadataMessage});
      return;
    }
    // Queue all other failures for retry. The claim stays pending so the
    // retry can re-enter it with the same token.
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename: uploadFilename, data,
        dataType: "data", osfFilesLink: exp_data.osfFilesLink,
        storageProvider: exp_data.storageProvider, providerContainer: exp_data.providerContainer,
        errorCode: result.providerStatus || 0, providerErrorCode: result.error, sessionIncremented: true,
        failureReason: `Provider error ${result.providerStatus}: ${result.providerMessage}`,
        claimToken,
      });
      await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      // OSF is failing, so queue the derived files alongside the raw data —
      // same provider error code, since it's the same provider write path.
      await queueDerivedFiles(derivedFiles, derivedTarget, `Queued alongside data file: OSF error ${result.providerStatus}`, result.error);
      res.status(202).json({...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage});
      await writeLog(experimentID, "saveDataQueued", undefined, logContext);
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_ERROR, osfStatus: result.providerStatus, osfStatusText: result.providerMessage}, logContext);
      return;
    } catch {
      res.status(400).json({...MESSAGES.OSF_UPLOAD_ERROR, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_ERROR, osfStatus: result.providerStatus, osfStatusText: result.providerMessage}, logContext);
      return;
    }
  }

  // Successful write — confirm the claim (best-effort; a confirm failure
  // must not fail a request that already succeeded against the provider).
  await confirmClaim(experimentID, claimName, claimToken);

  // The participant's file is in the researcher's storage. This is the only
  // place in this handler that is true.
  await writeLog(experimentID, "saveDataSucceeded", undefined, logContext);

  await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });

  // Data successfully uploaded to OSF — clean up the pending copy.
  await cleanupPending(pendingPath);

  // The raw data file is safely in OSF; upload the files derived from it
  // (main data CSV, sidecar CSVs, .psychds-ignore — best-effort: failures are
  // queued for retry and logged, never failing the submission).
  await uploadDerivedFiles(derivedFiles, derivedTarget, auth);

  res.status(201).json({...MESSAGES.SUCCESS, metadataMessage});
});
