import * as functions from "firebase-functions";
import cors from "cors";
import putFileOSF from "./put-file-osf.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import isBase64 from "is-base64";
import MESSAGES from "./api-messages.js";

const corsHandler = cors({ origin: true });

export const apiBase64 = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    const { experimentID, data, filename } = req.body;

    if (!experimentID || !data || !filename) {
      res.status(400).json(MESSAGES.MISSING_PARAMETER);
      return;
    }

    await writeLog(experimentID, "saveBase64Data");

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    const exp_doc = await exp_doc_ref.get();

    if (!exp_doc.exists) {
      res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
      return;
    }

    const exp_data = exp_doc.data();
    if (!exp_data.activeBase64) {
      res.status(400).json(MESSAGES.BASE64DATA_COLLECTION_NOT_ACTIVE);
      return;
    }

    if(!isBase64(data)){
      res.status(400).json(MESSAGES.INVALID_BASE64_DATA);
      return;
    }
    
    let buffer;
    try {
      buffer = Buffer.from(data, "base64");
    } catch (e) {
      res.status(400).json(MESSAGES.INVALID_BASE64_DATA);
      return;
    }

    const user_doc = await db.doc(`users/${exp_data.owner}`).get();
    if (!user_doc.exists) {
      res.status(400).json(MESSAGES.INVALID_OWNER);
      return;
    }

    const user_data = user_doc.data();
    if (!user_data.osfToken) {
      res.status(400).json(MESSAGES.INVALID_OSF_TOKEN);
      return;
    }

    const result = await putFileOSF(
      exp_data.osfFilesLink,
      user_data.osfToken,
      buffer,
      filename
    );

    if (!result.success) {
      if (result.errorCode === 409 && result.errorText === "Conflict") {
        res
          .status(400)
          .send("Error uploading file to OSF: File already exists");
      } else {
        res.status(400).send("Error uploading file to OSF");
      }
      return;
    }

    res.status(201).json(MESSAGES.SUCCESS);
  });
});
