import MESSAGES from "./api-messages.js";
import processMetadata from "./metadata-process.js";
import updateMetadata from "./metadata-update.js";
import produceMetadata from "./metadata-production.js";
import updateFileOSF from "./update-file-osf.js";
import downloadMetadata from "./metadata-download.js";
import { DocumentReference, DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import putFileOSF from "./put-file-osf.js";
import { db } from "./app.js";
import { ExperimentData, UserData, Metadata, MetadataResponse } from './interfaces';



export default async function blockMetadata(
    exp_data: ExperimentData,
    user_data: UserData,
    metadata_doc_ref: DocumentReference<DocumentData>,
    data: string,
    metadataOptions: object,
  ) {

let metadataMessage: {metadataMessage: string} = {metadataMessage: ''};

try {
 
  //Only run if metadata collection is enabled.
  if (exp_data.metadataActive) {

  //All metadata processing is done within a transaction to ensure consistency.
  await db.runTransaction(async (t) => {

      //Metadata is produced from the incoming data using the metdata module.
      const incomingMetadata: Metadata = (await produceMetadata(data, metadataOptions));

      //Retrieves the metadata from the Firestore metadata document.
      const firestoreMetadataObj: DocumentData | undefined = (await t.get(metadata_doc_ref)).data();
      
      const firestoreMetadata: Metadata | undefined = firestoreMetadataObj ? firestoreMetadataObj.metadata : undefined;
    
      //Retrieves the metadata ID from the OSF metadata file. If an ID exists, then a metadata file with name:
      //dataset_description.json exists in the OSF project.
      const osfMetadataId: string | undefined = (await processMetadata(exp_data.osfFilesLink, user_data.osfToken)).metadataId;
        
      //When firestore and OSF both have metadata, updating is done with respect to firestore.
      //When firestore has metadata but OSF does not, updating is done with respect to firestore.
      if ( (osfMetadataId && firestoreMetadata) || (!osfMetadataId && firestoreMetadata) ) {

        // Sets the metadata message.
        if (osfMetadataId) metadataMessage = MESSAGES.METADATA_IN_OSF_AND_FIRESTORE;
        else metadataMessage = MESSAGES.METADATA_IN_FIRESTORE_NOT_IN_OSF;

        // Incoming metadata is used to update firestore metadata.
        const updatedMetadata = await updateMetadata(firestoreMetadata, incomingMetadata);

        t.update(metadata_doc_ref, {metadata: updatedMetadata});

        //If a metadata file exists in OSF, it is updated with the above metadata.        
        if (osfMetadataId){
          await updateFileOSF(
          exp_data.osfFilesLink,
          user_data.osfToken,
          JSON.stringify(updatedMetadata, null, 2),
          osfMetadataId
        )

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

        //Metadata is downloaded from OSF, and is compared to incoming metadata to produce an updated version.
        // ********[IMPORTANT]***********
        // Since Metadata is in OSF as evidenced by the metadata ID, it is downloaded, and the type is asserted.
        const downloadResponse = await downloadMetadata(exp_data.osfFilesLink, user_data.osfToken, osfMetadataId);

        const osfMetadata: Metadata  = downloadResponse.metadata;

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

        //Incoming metadata is uploaded to firestore and OSF.

        t.set(metadata_doc_ref, {metadata: incomingMetadata}, {merge: true});

        await putFileOSF( 
            exp_data.osfFilesLink,
            user_data.osfToken,
            JSON.stringify(incomingMetadata, null, 2),
            `dataset_description.json`
          );

        }
  });
  
  const metadataResponse: MetadataResponse = {success: true, ...metadataMessage};
  return metadataResponse;
}
else {
    metadataMessage = MESSAGES.METADATA_NOT_ACTIVE;
    const metadataResponse: MetadataResponse = {success: true, ...metadataMessage};
    return metadataResponse;
 }
}
catch (error) {
  let errorMessage: string;

  if (error instanceof Error){
    errorMessage = error.message;
  }     
  else errorMessage = 'An unknown error occurred';

  const metadataResponse: MetadataResponse = {success: false, ...MESSAGES.METADATA_ERROR, message: errorMessage, ...metadataMessage};
  return metadataResponse;
//METADATA BLOCK END
  };
}