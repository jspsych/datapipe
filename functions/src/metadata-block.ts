import MESSAGES from "./api-messages.js";
import updateMetadata from "./metadata-update.js";
import produceMetadata from "./metadata-production.js";
import { DocumentReference, DocumentData } from "firebase-admin/firestore";
import { db } from "./app.js";
import resolveToken from "./resolve-token.js";
import { getProviderForExperiment } from "./providers/index.js";
import { FileRef, ProviderErrorCode } from "./providers/types.js";
import { ExperimentData, UserData, Metadata, MetadataResponse } from './interfaces';

// Thrown by performUpdate below when a provider's updateFile call fails
// (either by throwing, in OSF's case, or by returning a failure WriteResult,
// in gdrive's case). Carries the provider's error code, when known, so
// callers can distinguish a self-healable failure (stale ref) from one that
// recreating the file can't fix (auth/quota/rate-limit).
class ProviderUpdateError extends Error {
  code?: ProviderErrorCode;
  constructor(message: string, code?: ProviderErrorCode) {
    super(message);
    this.code = code;
  }
}

// Failure codes for which recreating the metadata file is pointless: an
// auth or quota problem isn't fixed by writing a new file, and self-healing
// on RATE_LIMITED would double the write load exactly when the provider is
// telling us to back off.
const NON_HEALABLE_CODES: ProviderErrorCode[] = ["AUTH_EXPIRED", "RATE_LIMITED", "QUOTA_EXCEEDED"];

export default async function blockMetadata(
    exp_data: ExperimentData,
    user_data: UserData,
    metadata_doc_ref: DocumentReference<DocumentData>,
    data: string,
    metadataOptions: object,
  ) {

let metadataMessage: {metadataMessage: string} = {metadataMessage: ''};

const tokenResult = await resolveToken(user_data, exp_data);
if (!tokenResult.success) {
  return { success: false, metadataMessage: tokenResult.detail };
}
const token = tokenResult.token;

const { provider, container } = getProviderForExperiment(exp_data);

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
        const providerFiles = await provider.listFiles(
          { token },
          container
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

        const response = await provider.writeSessionFile(
          { token },
          container,
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

      // Updates the ref'd metadata file. Throws a ProviderUpdateError on any
      // failure — OSF's updateFile already throws on non-200 responses;
      // gdrive's never throws, so a returned {success:false} is converted
      // into the same ProviderUpdateError shape here so callers can handle
      // both provider styles identically.
      async function performUpdate(fileRef: FileRef, serialized: string) {
        const result = await provider.updateFile(
          { token },
          container,
          fileRef,
          serialized,
          { size: Buffer.byteLength(serialized), contentType: "application/json" }
        );

        if (!result.success) {
          throw new ProviderUpdateError(
            `Error updating metadata file: ${result.providerMessage}`,
            result.error
          );
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
          await performUpdate(metadataFileRef, serialized);
        } catch (e) {
          // A returned failure with a non-healable code (auth/quota/rate
          // limit) must propagate rather than self-heal — recreating the
          // file can't fix any of those, and re-creating under rate-limiting
          // would only make things worse.
          if (e instanceof ProviderUpdateError && e.code && NON_HEALABLE_CODES.includes(e.code)) {
            throw e;
          }
          // Self-heal: the ref is stale (the file was deleted provider-side),
          // or the failure is otherwise recoverable by recreating the file.
          await createMetadataFile(updatedMetadata);
        }
      }
      //When a ref exists but firestore does not have metadata, updating is done with respect to OSF.
      else if (metadataFileRef && !firestoreMetadata) {

        metadataMessage = MESSAGES.METADATA_IN_OSF_NOT_IN_FIRESTORE;

        //Metadata is downloaded from the provider, and is compared to incoming metadata to produce an updated version.
        const downloadResult = await provider.downloadFile({ token }, container, metadataFileRef);

        if (!downloadResult.success) {
          throw new Error(`Error downloading metadata file: ${downloadResult.providerMessage}`);
        }

        let providerMetadata: Metadata;
        try {
          providerMetadata = JSON.parse(downloadResult.content) as Metadata;
        } catch (e) {
          throw new Error(`Error parsing downloaded metadata: ${e instanceof Error ? e.message : "Unknown error"}`);
        }

        const updatedMetadata = await updateMetadata(providerMetadata, incomingMetadata);

        //Up to date metadata is uploaded to firestore.
        t.set(metadata_doc_ref, {metadata: updatedMetadata}, {merge: true});

        //Since metadata exists in the provider, it is updated and not set.
        // No self-heal here (matches pre-existing behavior) — any failure
        // propagates to the outer catch as METADATA_ERROR.
        await performUpdate(metadataFileRef, JSON.stringify(incomingMetadata, null, 2));

      }
      // When no ref exists but firestore has metadata, the metadata file is (re)created in the provider.
      else if (!metadataFileRef && firestoreMetadata) {

        metadataMessage = MESSAGES.METADATA_IN_FIRESTORE_NOT_IN_OSF;

        // Incoming metadata is used to update firestore metadata.
        const updatedMetadata = await updateMetadata(firestoreMetadata, incomingMetadata);

        t.update(metadata_doc_ref, {metadata: updatedMetadata});

        //If a metadata file does not exist in the provider, it is created with the above metadata.
        await createMetadataFile(updatedMetadata);
      }
      // When neither a ref nor firestore metadata exist, the metadata is created in the provider and firestore.
      else {

        metadataMessage = MESSAGES.METADATA_NOT_IN_FIRESTORE_OR_OSF;

        //Incoming metadata is uploaded to firestore and the provider.

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
