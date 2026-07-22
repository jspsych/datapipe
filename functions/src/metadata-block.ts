import MESSAGES from "./api-messages.js";
import updateMetadata from "./metadata-update.js";
import produceMetadata from "./metadata-production.js";
import downloadMetadata from "./metadata-download.js";
import { DocumentReference, DocumentData } from "firebase-admin/firestore";
import { db } from "./app.js";
import { decrypt } from "./crypto-utils.js";
import { refreshAndUpdateUser } from "./refresh-token.js";
import { osfProvider } from "./providers/osf.js";
import { FileRef } from "./providers/types.js";
import { ExperimentData, UserData, Metadata, MetadataResponse } from './interfaces';



export default async function blockMetadata(
    exp_data: ExperimentData,
    user_data: UserData,
    metadata_doc_ref: DocumentReference<DocumentData>,
    data: string,
    metadataOptions: object,
  ) {

let metadataMessage: {metadataMessage: string} = {metadataMessage: ''};

let decryptedOsfToken: string;
if (user_data.usingPersonalToken) {
  decryptedOsfToken = decrypt(user_data.osfToken);
} else {
  if (Date.now() > user_data.authTokenExpires) {
    const refreshResult = await refreshAndUpdateUser(exp_data.owner, decrypt(user_data.refreshToken));
    if (!refreshResult.success) {
      // Fall back to PAT if available
      if (user_data.osfTokenValid && user_data.osfToken) {
        decryptedOsfToken = decrypt(user_data.osfToken);
      } else {
        return { success: false, metadataMessage: "OAuth token refresh failed" };
      }
    } else {
      decryptedOsfToken = refreshResult.accessToken!;
    }
  } else {
    decryptedOsfToken = decrypt(user_data.authToken);
  }
}

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

      // The metadata file's provider ref, tracked on the metadata doc.
      // - undefined: the field has never been written (pre-migration doc, or
      //   no doc at all) — distinct from explicit null.
      // - null: known absent — a prior request already looked and found
      //   nothing, so we must not list the provider folder again.
      // - FileRef: a metadata file is known to exist at this id/name.
      let metadataFileRef: FileRef | null | undefined = firestoreMetadataObj
        ? (firestoreMetadataObj.metadataFileRef as FileRef | null | undefined)
        : undefined;

      // Legacy discovery fallback: only runs once, for docs that predate ref
      // tracking. Afterward the ref (possibly null) is stored so this never
      // runs again for this experiment.
      if (metadataFileRef === undefined) {
        const providerFiles = await osfProvider.listFiles(
          { token: decryptedOsfToken },
          { provider: "osf", filesLink: exp_data.osfFilesLink }
        );

        const found = providerFiles.find((file) => file.name === "dataset_description.json");

        metadataFileRef = found ?? null;

        t.set(metadata_doc_ref, { metadataFileRef }, { merge: true });
      }

      // Creates a fresh dataset_description.json and stores the returned ref
      // on the metadata doc. Used both for the "no ref" branches below and
      // for self-healing a stale ref whose provider-side file is gone.
      async function createMetadataFile(payload: object) {
        const serialized = JSON.stringify(payload, null, 2);

        const response = await osfProvider.writeSessionFile(
          { token: decryptedOsfToken },
          { provider: "osf", filesLink: exp_data.osfFilesLink },
          `dataset_description.json`,
          serialized,
          { size: Buffer.byteLength(serialized), contentType: "application/json" }
        );

        if (!response.success) {
          throw new Error(MESSAGES.OSF_UPLOAD_ERROR.message);
        }

        // Only track a ref we can actually use later. If the provider's 201
        // body was unparseable, fileRef.id is undefined — storing that would
        // either fail the Firestore write or persist an un-updatable ref
        // (whose self-heal re-create would then 409 forever). Leaving the
        // field unset instead lets the next submission's legacy-discovery
        // listing find the file and store a complete ref.
        if (response.fileRef.id) {
          t.set(metadata_doc_ref, { metadataFileRef: response.fileRef }, { merge: true });
        }
      }

      //When a ref and firestore metadata both exist, updating is done with respect to firestore.
      if (metadataFileRef && firestoreMetadata) {

        metadataMessage = MESSAGES.METADATA_IN_OSF_AND_FIRESTORE;

        // Incoming metadata is used to update firestore metadata.
        const updatedMetadata = await updateMetadata(firestoreMetadata, incomingMetadata);

        t.update(metadata_doc_ref, {metadata: updatedMetadata});

        const serialized = JSON.stringify(updatedMetadata, null, 2);

        try {
          //The ref'd metadata file is updated with the above metadata.
          await osfProvider.updateFile(
            { token: decryptedOsfToken },
            { provider: "osf", filesLink: exp_data.osfFilesLink },
            metadataFileRef,
            serialized,
            { size: Buffer.byteLength(serialized), contentType: "application/json" }
          );
        } catch (e) {
          // Self-heal: the ref is stale (the file was deleted provider-side).
          // Create a fresh metadata file and store its new ref rather than
          // failing the whole request.
          await createMetadataFile(updatedMetadata);
        }
      }
      //When a ref exists but firestore does not have metadata, updating is done with respect to OSF.
      else if (metadataFileRef && !firestoreMetadata) {

        metadataMessage = MESSAGES.METADATA_IN_OSF_NOT_IN_FIRESTORE;

        //Metadata is downloaded from OSF, and is compared to incoming metadata to produce an updated version.
        // ********[IMPORTANT]***********
        // Since Metadata is in OSF as evidenced by the ref, it is downloaded, and the type is asserted.
        const downloadResponse = await downloadMetadata(exp_data.osfFilesLink, decryptedOsfToken, metadataFileRef.id as string);

        const osfMetadata: Metadata  = downloadResponse.metadata;

        const updatedMetadata = await updateMetadata(osfMetadata, incomingMetadata);

        //Up to date metadata is uploaded to firestore.
        t.set(metadata_doc_ref, {metadata: updatedMetadata}, {merge: true});

        //Since metadata exists in OSF, it is updated and not set.
        await osfProvider.updateFile(
          { token: decryptedOsfToken },
          { provider: "osf", filesLink: exp_data.osfFilesLink },
          metadataFileRef,
          JSON.stringify(incomingMetadata, null, 2),
          { size: Buffer.byteLength(JSON.stringify(incomingMetadata, null, 2)), contentType: "application/json" }
        );

      }
      // When no ref exists but firestore has metadata, the metadata file is (re)created in OSF.
      else if (!metadataFileRef && firestoreMetadata) {

        metadataMessage = MESSAGES.METADATA_IN_FIRESTORE_NOT_IN_OSF;

        // Incoming metadata is used to update firestore metadata.
        const updatedMetadata = await updateMetadata(firestoreMetadata, incomingMetadata);

        t.update(metadata_doc_ref, {metadata: updatedMetadata});

        //If a metadata file does not exist in OSF, it is created with the above metadata.
        await createMetadataFile(updatedMetadata);
      }
      // When neither a ref nor firestore metadata exist, the metadata is created in OSF and firestore.
      else {

        metadataMessage = MESSAGES.METADATA_NOT_IN_FIRESTORE_OR_OSF;

        //Incoming metadata is uploaded to firestore and OSF.

        t.set(metadata_doc_ref, {metadata: incomingMetadata}, {merge: true});

        await createMetadataFile(incomingMetadata);

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

  console.error("Metadata block error:", errorMessage);

  const metadataResponse: MetadataResponse = {success: false, ...MESSAGES.METADATA_ERROR, message: errorMessage, ...metadataMessage};
  return metadataResponse;
//METADATA BLOCK END
  };
}