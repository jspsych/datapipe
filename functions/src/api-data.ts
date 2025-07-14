import { onRequest } from "firebase-functions/v2/https";
import { FieldValue, DocumentReference, DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import validateJSON from "./validate-json.js";
import validateCSV from "./validate-csv.js";
import putFileOSF from "./put-file-osf.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import blockMetadata from "./metadata-block.js";
import { ExperimentData, UserData, MetadataResponse, OSFResult, RequestBody } from './interfaces';

export const apiData = onRequest({ cors: true }, async (req, res) => {
  const { experimentID, data, filename, metadataOptions}: RequestBody = req.body;

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

  if (!user_data.osfTokenValid) {
    res.status(400).json(MESSAGES.INVALID_OSF_TOKEN);
    await writeLog(experimentID, "logError", MESSAGES.INVALID_OSF_TOKEN);
    return;
  }

  //METADATA BLOCK START

  //Creates or references a document containing the metadata for the experiment in the metdata collection on Firestore.
  const metadata_doc_ref: DocumentReference<DocumentData> = db.collection("metadata").doc(experimentID);

  const metadataResponse: MetadataResponse = await blockMetadata(exp_data, user_data, metadata_doc_ref, data, metadataOptions);

  if (metadataResponse.success === false)  {
  res.status(400).json(metadataResponse);
  return;
  }

  const metadataMessage: string = metadataResponse.metadataMessage;
  //METADATA BLOCK END

  const result: OSFResult = await putFileOSF(
    exp_data.osfFilesLink,
    user_data.osfToken,
    data,
    filename
  );  

  if (!result.success) {
    if (result.errorCode === 409 && result.errorText === "Conflict") {
      res.status(400).json({...MESSAGES.OSF_FILE_EXISTS, metadataMessage});
      await writeLog(experimentID, "logError", MESSAGES.OSF_FILE_EXISTS);
      return;
    }
    res.status(400).json({...MESSAGES.OSF_UPLOAD_ERROR, metadataMessage});
    await writeLog(experimentID, "logError", MESSAGES.OSF_UPLOAD_ERROR);
    return;
  }

  await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });

  res.status(201).json({...MESSAGES.SUCCESS, metadataMessage});

});
