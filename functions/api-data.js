import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import validateJSON from "./validate-json.js";
import validateCSV from "./validate-csv.js";
import putFileOSF from "./put-file-osf.js";
import putFileGoogleDrive from "./put-file-google-drive.js";
import { getGoogleDriveAccessToken } from "./google-drive-auth.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";

export const apiData = onRequest(async (req, res) => {


  // Handle GET request to list experiments (for debugging)
  if (req.method === 'GET') {
    try {
      const experimentsSnapshot = await db.collection('experiments').get();
      const experiments = [];
      experimentsSnapshot.forEach(doc => {
        experiments.push({
          id: doc.id,
          title: doc.data().title,
          owner: doc.data().owner
        });
      });
      res.status(200).json({ experiments });
      return;
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch experiments', message: error.message });
      return;
    }
  }

  // Handle PUT request to update experiment settings
  if (req.method === 'PUT') {
    try {
      const { experimentID, updates } = req.body;
      if (!experimentID || !updates) {
        res.status(400).json({ error: 'Missing experimentID or updates' });
        return;
      }
      
      const expDocRef = db.collection("experiments").doc(experimentID);
      await expDocRef.update(updates);
      
      res.status(200).json({ message: 'Experiment updated successfully' });
      return;
    } catch (error) {
      res.status(500).json({ error: 'Failed to update experiment', message: error.message });
      return;
    }
  }

  // Handle POST request (existing logic)
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
  
  // Check if user has either OSF or Google Drive configured
  const hasOSF = user_data.osfTokenValid;
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
      data,
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
        data,
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

  await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });

  res.status(201).json(MESSAGES.SUCCESS);
});
