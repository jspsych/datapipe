import { onRequest } from "firebase-functions/v2/https";
import { DocumentReference, DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import putFileOSF from "./put-file-osf.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import isBase64 from "is-base64";
import MESSAGES from "./api-messages.js";
import { ExperimentData, UserData } from './interfaces';

export const apiBase64 = onRequest({ cors: true }, async (req, res) => {
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

  let token: string = "";
  if (user_data.usingPersonalToken) {
    if (!user_data.osfTokenValid) {
      res.status(400).json(MESSAGES.INVALID_OSF_TOKEN);
      await writeLog(experimentID, "logError", MESSAGES.INVALID_OSF_TOKEN);
      return;
    }
    else {
      token = user_data.osfToken;
    }
  }

  if (!user_data.usingPersonalToken) {
    if (Date.now() > user_data.refreshTokenExpires) {
      res.status(400).json(MESSAGES.INVALID_REFRESH_TOKEN);
      await writeLog(experimentID, "logError", MESSAGES.INVALID_REFRESH_TOKEN);
      return;
    }

    if (Date.now() > user_data.authTokenExpires) {
      const params = new URLSearchParams({
        code: user_data.refreshToken,
        client_id: process.env.NEXT_PUBLIC_CLIENT_ID as string,
        client_secret: process.env.CLIENT_SECRET as string,
        grant_type: "refresh_token"
      })

      const tokenResponse = await fetch('https://accounts.osf.io/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString()
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        console.error('Token exchange failed:', errorData);
        res.status(400).json({ 
          error: 'Authorization token regeneration failed',
          details: errorData,
          status: tokenResponse.status
        });
        return;
      }

      const tokenData = await tokenResponse.json();

      await db.doc(`users/${exp_data.owner}`).update({
        authToken: tokenData.access_token,
        authTokenExpires: Date.now() + tokenData.expires_in * 1000
      });

      token = tokenData.access_token;
    } else {
      token = user_data.authToken;
    }
  }

  const result = await putFileOSF(
    exp_data.osfFilesLink,
    token,
    buffer,
    filename
  );

  if (!result.success) {
    if (result.errorCode === 409 && result.errorText === "Conflict") {
      res.status(400).json(MESSAGES.OSF_FILE_EXISTS);
      await writeLog(experimentID, "logError", MESSAGES.OSF_FILE_EXISTS);
      return;
    }
    res.status(400).json(MESSAGES.OSF_UPLOAD_ERROR);
    await writeLog(experimentID, "logError", MESSAGES.OSF_UPLOAD_ERROR);
    return;
  }

  res.status(201).json(MESSAGES.SUCCESS);
});
