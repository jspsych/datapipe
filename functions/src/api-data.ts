import { onRequest } from "firebase-functions/v2/https";
import { FieldValue, DocumentReference, DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import validateJSON from "./validate-json.js";
import validateCSV from "./validate-csv.js";
import putFileOSF from "./put-file-osf.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import blockMetadata from "./metadata-block.js";
import { DerivedFile, uploadPathFor } from "./metadata-derived-files.js";
import { uploadDerivedFiles, queueDerivedFiles } from "./metadata-derived-upload.js";
import resolveToken from "./resolve-token.js";
import queueUpload from "./queue-upload.js";
import { persistPending, cleanupPending } from "./persist-pending.js";
import { ExperimentData, UserData, OSFResult, RequestBody } from './interfaces';

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
  //Psych-DS files derived from this submission (main data CSV, sidecar CSVs
  //for nested columns, .psychds-ignore), produced by the metadata block and
  //uploaded only after the participant's raw data file lands in OSF.
  let derivedFiles: DerivedFile[] = [];

  if (exp_data.metadataActive) {
    //Creates or references a document containing the metadata for the experiment in the metdata collection on Firestore.
    const metadata_doc_ref: DocumentReference<DocumentData> = db.collection("metadata").doc(experimentID);

    const metadataResponse = await blockMetadata(exp_data, token, metadata_doc_ref, data, filename, metadataOptions);

    if (metadataResponse.success === false) {
      await cleanupPending(pendingPath);
      res.status(400).json({...metadataResponse, derivedFiles: undefined});
      await writeLog(experimentID, "logError", {...MESSAGES.METADATA_ERROR, detail: metadataResponse.message});
      return;
    }

    metadataMessage = metadataResponse.metadataMessage;
    derivedFiles = metadataResponse.derivedFiles ?? [];
  }

  const derivedTarget = { experimentID, owner: exp_data.owner, osfFilesLink: exp_data.osfFilesLink };

  //METADATA BLOCK END

  //With metadata on, the raw submission is the critical upload and lives at
  //data/raw/<original name> in the Psych-DS layout (the CSVs above are derived
  //from it). Session counting and queue-on-failure key off this file. With
  //metadata off, the layout is unchanged: the raw file goes to the root.
  const uploadFilename = uploadPathFor(exp_data.metadataActive, filename);

  let result: OSFResult;
  try {
    result = await putFileOSF(
      exp_data.osfFilesLink,
      token,
      data,
      uploadFilename
    );
  } catch (e) {
    // Network errors, timeouts, etc. — queue for retry
    const detail = e instanceof Error ? e.message : "Unknown error";
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename: uploadFilename, data,
        dataType: "data", osfFilesLink: exp_data.osfFilesLink,
        errorCode: 0, sessionIncremented: true,
        failureReason: `Upload exception: ${detail}`,
      });
      await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      // OSF is unreachable, so queue the derived files alongside the raw data.
      await queueDerivedFiles(derivedFiles, derivedTarget, `Queued alongside data file: ${detail}`);
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
    if (result.errorCode === 409 && result.errorText === "Conflict") {
      res.status(400).json({...MESSAGES.OSF_FILE_EXISTS, metadataMessage});
      await writeLog(experimentID, "logError", MESSAGES.OSF_FILE_EXISTS);
      return;
    }
    // Queue all other failures for retry
    try {
      await queueUpload({
        experimentID, owner: exp_data.owner, filename: uploadFilename, data,
        dataType: "data", osfFilesLink: exp_data.osfFilesLink,
        errorCode: result.errorCode || 0, sessionIncremented: true,
        failureReason: `OSF error ${result.errorCode}: ${result.errorText}`,
      });
      await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });
      await cleanupPending(pendingPath); // queue-upload has its own copy
      // OSF is failing, so queue the derived files alongside the raw data.
      await queueDerivedFiles(derivedFiles, derivedTarget, `Queued alongside data file: OSF error ${result.errorCode}`);
      res.status(202).json({...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_ERROR, osfStatus: result.errorCode, osfStatusText: result.errorText});
      return;
    } catch {
      res.status(400).json({...MESSAGES.OSF_UPLOAD_ERROR, metadataMessage});
      await writeLog(experimentID, "logError", {...MESSAGES.OSF_UPLOAD_ERROR, osfStatus: result.errorCode, osfStatusText: result.errorText});
      return;
    }
  }

  await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });

  // Data successfully uploaded to OSF — clean up the pending copy.
  await cleanupPending(pendingPath);

  // The raw data file is safely in OSF; upload the files derived from it
  // (main data CSV, sidecar CSVs, .psychds-ignore — best-effort: failures are
  // queued for retry and logged, never failing the submission).
  await uploadDerivedFiles(derivedFiles, derivedTarget, token);

  res.status(201).json({...MESSAGES.SUCCESS, metadataMessage});
});
