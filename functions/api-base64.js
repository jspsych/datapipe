import { onRequest } from "firebase-functions/v2/https";
import putFileOSF from "./put-file-osf.js";
import putFileGoogleDrive from "./put-file-google-drive.js";
import { getGoogleDriveAccessToken } from "./google-drive-auth.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import isBase64 from "is-base64";
import MESSAGES from "./api-messages.js";

export const apiBase64 = onRequest({ cors: true },async (req, res) => {

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

    if (!isBase64(data, {allowMime: true})) {
      res.status(400).json(MESSAGES.INVALID_BASE64_DATA);
      return;
    }

    let buffer;
    try {
      // this safely removes the mime type from the base64 data
      const split_data = data.split(",");
      if(split_data.length > 1){
        buffer = Buffer.from(split_data[1], "base64");
      } else {
        buffer = Buffer.from(data, "base64");
      }
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
    
    // Check if user has either OSF or Google Drive configured
    const hasOSF = user_data.osfToken;
    const hasGoogleDrive = user_data.googleDriveEnabled && user_data.googleDriveFolderId && user_data.googleDriveRefreshToken;
    
    if (!hasOSF && !hasGoogleDrive) {
      res.status(400).json(MESSAGES.INVALID_OSF_TOKEN);
      return;
    }

    let exportSuccess = false;
    let exportError = null;

    // Try OSF export if configured
    if (hasOSF && exp_data.osfFilesLink) {
      const osfResult = await putFileOSF(
        exp_data.osfFilesLink,
        user_data.osfToken,
        buffer,
        filename
      );

      if (osfResult.success) {
        exportSuccess = true;
      } else {
        exportError = osfResult;
      }
    }

    // Try Google Drive export if configured
    if (hasGoogleDrive) {
      try {
        // Get fresh access token
        const tokenData = await getGoogleDriveAccessToken(user_data.googleDriveRefreshToken);
        
        const googleDriveResult = await putFileGoogleDrive(
          user_data.googleDriveFolderId,
          filename,
          buffer.toString('base64'), // Convert buffer to base64 string for Google Drive
          tokenData.access_token
        );

        if (googleDriveResult.success) {
          // Update user's access token and expiry
          await user_doc.ref.update({
            googleDriveAccessToken: tokenData.access_token,
            googleDriveTokenExpiry: new Date(Date.now() + tokenData.expires_in * 1000),
          });
          
          // If OSF failed but Google Drive succeeded, we still consider it a success
          if (!exportSuccess) {
            exportSuccess = true;
            exportError = null;
          }
        }
      } catch (error) {
        console.error("Google Drive export error:", error);
        // Don't fail the entire request if Google Drive fails
      }
    }

    if (!exportSuccess) {
      if (exportError && exportError.errorCode === 409 && exportError.errorText === "Conflict") {
        res.status(400).json(MESSAGES.OSF_FILE_EXISTS);
        return;
      }
      res.status(400).json(MESSAGES.OSF_UPLOAD_ERROR);
      return;
    }

    res.status(201).json(MESSAGES.SUCCESS);
  });
