import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import validateJSON from "./validate-json.js";
import validateCSV from "./validate-csv.js";
import putFileOSF from "./put-file-osf.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import processMetadata from "./metadata-process.js";
import updateMetadata from "./metadata-update.js";
import produceMetadata from "./metadata-production.js";
import updateFileOSF from "./update-file-osf.js";
import downloadMetadata from "./metadata-download.js";

export const apiData = onRequest({ cors: true }, async (req, res) => {
  const { experimentID, data, filename, metadataOptions} = req.body;

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

  //METADATA BLOCK START
  //Creates or references a document containing the metadata for the experiment in the metdata collection on Firestore.
  const metadata_doc_ref = db.collection("metadata").doc(experimentID);

  //Variable to store mode of metadata collection.
  let metadataMessage;

 try {
 
  //Only run if metadata collection is enabled.
  if (exp_data.metadataActive) {

  //All metadata processing is done within a transaction to ensure consistency.
  await db.runTransaction(async (t) => {


    console.log('METADATA BLOCK START')

      //Metadata is produced from the incoming data using the metdata module.
      const incomingMetadata = (await produceMetadata(data, metadataOptions));

      console.log('INCOMING METADATA')

      //Retrieves the metadata from the Firestore metadata document.
      const firestoreMetadataObj = (await t.get(metadata_doc_ref)).data();
      
      const firestoreMetadata = firestoreMetadataObj ? firestoreMetadataObj.metadata : undefined;
    
      //Retrieves the metadata ID from the OSF metadata file. If an ID exists, then a metadata file with name:
      //dataset_description.json exists in the OSF project.
      const osfMetadataId = (await processMetadata(exp_data.osfFilesLink, user_data.osfToken)).metadataId;
        
      //When firestore and OSF both have metadata, updating is done with respect to firestore.
      //When firestore has metadata but OSF does not, updating is done with respect to firestore.
      if ( (osfMetadataId && firestoreMetadata) || (!osfMetadataId && firestoreMetadata) ) {

        // Sets the metadata message.
        if (osfMetadataId) metadataMessage = MESSAGES.METADATA_IN_OSF_AND_FIRESTORE;
        else metadataMessage = MESSAGES.METADATA_IN_FIRESTORE_NOT_IN_OSF;

        console.log(metadataMessage);

        // Incoming metadata is used to update firestore metadata.
        const updatedMetadata = await updateMetadata(firestoreMetadata, incomingMetadata);

        t.update(metadata_doc_ref, {metadata: updatedMetadata}, {merge: true});

        //If a metadata file exists in OSF, it is updated with the above metadata.
        console.log(updatedMetadata) 
        if (osfMetadataId){

          await updateFileOSF(
          exp_data.osfFilesLink,
          user_data.osfToken,
          JSON.stringify(updatedMetadata, null, 2),
          osfMetadataId
        )

        console.log('STRINGIFIED INCOMING')

        console.log(JSON.stringify(updatedMetadata, null, 2))
      
        }
        //If a metadata file does not exist in OSF, it is created with the above metadata.
        else {

          await putFileOSF(
            exp_data.osfFilesLink,
            user_data.osfToken,
            JSON.stringify(updatedMetadata, null, 2),
            `dataset_description.json`
          );
          
        }
      }

      //When OSF has metadata but firestore does not, updating is done with respect to OSF.
      if (osfMetadataId && !firestoreMetadata) {

        metadataMessage = MESSAGES.METADATA_IN_OSF_NOT_IN_FIRESTORE;
        console.log(metadataMessage);


        //Metadata is downloaded from OSF, and is compared to incoming metadata to produce an updated version.
        const osfMetadata = (await downloadMetadata(exp_data.osfFilesLink, user_data.osfToken, osfMetadataId)).metaString;

        const updatedMetadata = await updateMetadata(osfMetadata, incomingMetadata);

        //Up to date metadata is uploaded to firestore.
        t.set(metadata_doc_ref, {metadata: updatedMetadata}, {merge: true});

        //Since metadata exists in OSF, it is updated and not set.
        await updateFileOSF(
          exp_data.osfFilesLink,
          user_data.osfToken,
          JSON.stringify(incomingMetadata, null, 2),
          osfMetadataId
        );

      }

      // When neither OSF nor firestore have metadata, the metadata is created in OSF and firestore.
      if (!osfMetadataId && !firestoreMetadata) {

        metadataMessage = MESSAGES.METADATA_NOT_IN_FIRESTORE_OR_OSF;
        console.log(metadataMessage);


        //Incoming metadata is uploaded to firestore and OSF.

        t.set(metadata_doc_ref, {metadata: incomingMetadata}, {merge: true});

        await putFileOSF( 
            exp_data.osfFilesLink,
            user_data.osfToken,
            JSON.stringify(incomingMetadata, null, 2),
            `dataset_description.json`
          );

        }

      console.log('TRANSACTION SUCCESS! WHOOPEE!');
  });
}
else metadataMessage = MESSAGES.METADATA_NOT_ACTIVE;
 }
catch (error) {
  if (error === 'Invalid metadata format') {
    res.status(400).json({...MESSAGES.INVALD_METADATA_ERROR, ...metadataMessage});
    return;
  }
  if (error.status && error.status !== 201) {
    res.status(400).json({...MESSAGES.OSF_METADATA_UPLOAD_ERROR, ...metadataMessage});
    return;
  }
  //If transaction fails, error is sent with info on what the status of the dataset's metadata was;
  //Helpful for unit testing.
  res.status(400).json({...MESSAGES.METADATA_ERROR,...{message: error.message}, ...metadataMessage});
  return;
}
//METADATA BLOCK END

const result = await putFileOSF(
  exp_data.osfFilesLink,
  user_data.osfToken,
  data,
  filename
);  

if (!result.success) {
  if (result.errorCode === 409 && result.errorText === "Conflict") {
    res.status(400).json({...MESSAGES.OSF_FILE_EXISTS, ...metadataMessage});
    return;
  }
  res.status(400).json({...MESSAGES.OSF_UPLOAD_ERROR, ...metadataMessage});
  return;
}
await exp_doc_ref.set({ sessions: FieldValue.increment(1) }, { merge: true });

  
  res.status(201).json({...MESSAGES.SUCCESS, ...metadataMessage});
});
