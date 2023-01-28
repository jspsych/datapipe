import * as functions from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import cors from "cors";
import validateJSON from "./validate-json.js";
import validateCSV from "./validate-csv.js";
import putFileOSF from "./put-file-osf.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";

const corsHandler = cors({ origin: true });

export const apiData = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    const { experimentID, data, filename } = req.body;

    if (!experimentID || !data || !filename) {
      res.status(400).json(MESSAGES.MISSING_PARAMETER);
      return;
    }

    await writeLog(experimentID, "saveData");

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    const exp_doc = await exp_doc_ref.get();

    if (!exp_doc.exists) {
      res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
      return;
    }

    const exp_data = exp_doc.data();
    if (!exp_data.active) {
      res.status(400).json(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
      return;
    }

    if (exp_data.limitSessions) {
      if (exp_data.sessions >= exp_data.maxSessions) {
        res.status(400).json(MESSAGES.SESSION_LIMIT_REACHED);
        return;
      }
    }

    if (exp_data.useValidation) {
      let valid = false;
      if (exp_data.allowJSON) {
        const validJSON = validateJSON(data, exp_data.requiredFields);
        if (validJSON) {
          valid = true;
        }
      }
      if (exp_data.allowCSV && !valid) {
        const validCSV = validateCSV(data, exp_data.requiredFields);
        if (validCSV) {
          valid = true;
        }
      }
      if (!valid) {
        res.status(400).json(MESSAGES.INVALID_DATA);
        return;
      }
    }

    const user_doc = await db.doc(`users/${exp_data.owner}`).get();

    if (!user_doc.exists) {
      res.status(400).json(MESSAGES.INVALID_OWNER);
      return;
    }

    const user_data = user_doc.data();
    if (!user_data.osfTokenValid) {
      res.status(400).json(MESSAGES.INVALID_OSF_TOKEN);
      return;
    }

    const result = await putFileOSF(
      exp_data.osfFilesLink,
      user_data.osfToken,
      data,
      filename
    );

    if (!result.success) {
      if (result.errorCode === 409 && result.errorText === "Conflict") {
        res.status(400).json(MESSAGES.OSF_FILE_EXISTS);
        return;
      }
      res.status(400).json(MESSAGES.OSF_UPLOAD_ERROR);
      return;
    }

    await exp_doc_ref.set(
      { sessions: FieldValue.increment(1) },
      { merge: true }
    );

    res.status(201).json(MESSAGES.SUCCESS);
  });
});
