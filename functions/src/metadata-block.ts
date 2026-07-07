import MESSAGES from "./api-messages.js";
import processMetadata from "./metadata-process.js";
import updateMetadata from "./metadata-update.js";
import produceMetadata from "./metadata-production.js";
import updateFileOSF from "./update-file-osf.js";
import downloadMetadata from "./metadata-download.js";
import { DocumentReference, DocumentData } from "firebase-admin/firestore";
import putFileOSF from "./put-file-osf.js";
import { db } from "./app.js";
import buildDerivedFiles, { DerivedFile } from "./metadata-derived-files.js";
import { queueDerivedFiles } from "./metadata-derived-upload.js";
import { ExperimentData, Metadata, MetadataResponse } from './interfaces';

// Discriminated on `success` so the compiler guarantees derivedFiles can only
// ride on a success — a failure response structurally cannot carry them, so
// callers (api-data's 400 path) can send it verbatim with no risk of leaking a
// half-built derived-file set.
type MetadataSuccess = Omit<MetadataResponse, 'success'> & { success: true; derivedFiles?: DerivedFile[] };
type MetadataFailure = Omit<MetadataResponse, 'success'> & { success: false };
export type MetadataBlockResult = MetadataSuccess | MetadataFailure;

export default async function blockMetadata(
    exp_data: ExperimentData,
    osfToken: string,
    metadata_doc_ref: DocumentReference<DocumentData>,
    data: string,
    filename: string,
    metadataOptions: object,
  ): Promise<MetadataBlockResult> {

let metadataMessage: {metadataMessage: string} = {metadataMessage: ''};

try {

  //Only run if metadata collection is enabled.
  if (!exp_data.metadataActive) {
    metadataMessage = MESSAGES.METADATA_NOT_ACTIVE;
    const metadataResponse: MetadataSuccess = {success: true, ...metadataMessage};
    return metadataResponse;
  }

  //Metadata is produced from the incoming data using the metadata module.
  const produced = await produceMetadata(data, metadataOptions);
  const incomingMetadata: Metadata = produced.metadata;

  //The full Psych-DS file set derived from this submission (main data CSV,
  //sidecar CSVs for nested columns, .psychds-ignore), mirroring the CLI's
  //per-file output. Built here; uploaded by the caller only after the
  //participant's raw data file itself lands in OSF under data/raw/, so
  //derived files can never precede the data they are derived from.
  const derivedFiles: DerivedFile[] = buildDerivedFiles(filename, produced);

  //Retrieves the metadata ID from the OSF metadata file. If an ID exists, then a metadata file with name:
  //dataset_description.json exists in the OSF project.
  const osfMetadataId: string | undefined = (await processMetadata(exp_data.osfFilesLink, osfToken)).metadataId;

  //Non-transactional pre-read to decide whether the OSF copy of the metadata
  //needs downloading as the merge base (the bootstrap case: Firestore empty,
  //OSF populated). Done outside the transaction below since Firestore retries
  //a transaction callback on contention, which would otherwise repeat this
  //network call on every retry.
  const preReadFirestoreMetadata: Metadata | undefined = (await metadata_doc_ref.get()).data()?.metadata;

  //Record which of the four states we are in before the download below (which
  //can throw) so error responses still report the state, same as a successful
  //response would.
  if (preReadFirestoreMetadata) {
    metadataMessage = osfMetadataId ? MESSAGES.METADATA_IN_OSF_AND_FIRESTORE : MESSAGES.METADATA_IN_FIRESTORE_NOT_IN_OSF;
  } else {
    metadataMessage = osfMetadataId ? MESSAGES.METADATA_IN_OSF_NOT_IN_FIRESTORE : MESSAGES.METADATA_NOT_IN_FIRESTORE_OR_OSF;
  }

  let osfMetadata: Metadata | undefined;
  if (!preReadFirestoreMetadata && osfMetadataId) {
    osfMetadata = (await downloadMetadata(exp_data.osfFilesLink, osfToken, osfMetadataId)).metadata;
  }

  //The transaction is Firestore-only: read the metadata doc, merge, write it
  //back. All OSF network I/O happened above, so a transaction retry (e.g. a
  //concurrent submission populating Firestore between the pre-read and here)
  //can never repeat an OSF call — firestoreMetadata is re-read here, so that
  //race still resolves correctly via firestoreMetadata ?? osfMetadata.
  const updatedMetadata = await db.runTransaction(async (t) => {
    const firestoreMetadata: Metadata | undefined = (await t.get(metadata_doc_ref)).data()?.metadata;

    //Record which of the four states we are in. This is set before any
    //failure point below so that error responses still report the state.
    if (firestoreMetadata) {
      metadataMessage = osfMetadataId ? MESSAGES.METADATA_IN_OSF_AND_FIRESTORE : MESSAGES.METADATA_IN_FIRESTORE_NOT_IN_OSF;
    } else {
      metadataMessage = osfMetadataId ? MESSAGES.METADATA_IN_OSF_NOT_IN_FIRESTORE : MESSAGES.METADATA_NOT_IN_FIRESTORE_OR_OSF;
    }

    //When Firestore has metadata, updating is done with respect to Firestore.
    //When only OSF has metadata, the downloaded OSF copy is the base instead.
    //When neither has metadata, the incoming metadata is used as-is.
    const baseMetadata: Metadata | undefined = firestoreMetadata ?? osfMetadata;
    const updated = baseMetadata ? await updateMetadata(baseMetadata, incomingMetadata) : incomingMetadata;

    t.set(metadata_doc_ref, {metadata: updated}, {merge: true});

    return updated;
  });

  //Firestore is now up to date; mirror the merged metadata to OSF. The mirror
  //is best-effort: Firestore is the source of truth and every submission
  //re-merges and re-mirrors, so a failure here must not reject the
  //participant's data — it is queued for retry (create) or left for the next
  //submission to repair (update).
  const metadataFileContents = JSON.stringify(updatedMetadata, null, 2);
  const queueTarget = {
    experimentID: metadata_doc_ref.id,
    owner: exp_data.owner,
    osfFilesLink: exp_data.osfFilesLink,
  };

  //If a metadata file exists in OSF, it is updated. Otherwise it is created.
  if (osfMetadataId) {
    try {
      await updateFileOSF(
        exp_data.osfFilesLink,
        osfToken,
        metadataFileContents,
        osfMetadataId
      );
    } catch {
      //Result intentionally unchecked and NOT queued: the uploadQueue only
      //PUTs (create), which is guaranteed to 409 against a file that already
      //exists — queueing here would just leave a dead entry the retry worker
      //marks completed without ever applying the update. Firestore is the
      //source of truth and every submission re-merges and re-mirrors, so the
      //next submission repairs OSF instead.
    }
  } else {
    try {
      const response = await putFileOSF(
        exp_data.osfFilesLink,
        osfToken,
        metadataFileContents,
        `dataset_description.json`
      );

      //A 409 means a concurrent submission created the file first; the next
      //submission will fold this one's merge (already in Firestore) into it.
      if (!response.success && response.errorCode !== 409) {
        await queueDerivedFiles([{ filename: "dataset_description.json", content: metadataFileContents }],
          queueTarget, `dataset_description OSF error ${response.errorCode}: ${response.errorText}`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      await queueDerivedFiles([{ filename: "dataset_description.json", content: metadataFileContents }],
        queueTarget, `dataset_description upload exception: ${detail}`);
    }
  }

  const metadataResponse: MetadataSuccess = {success: true, ...metadataMessage, derivedFiles};
  return metadataResponse;
}
catch (error) {
  let errorMessage: string;

  if (error instanceof Error){
    errorMessage = error.message;
  }
  else errorMessage = 'An unknown error occurred';

  console.error("Metadata block error:", errorMessage);

  const metadataResponse: MetadataFailure = {success: false, ...MESSAGES.METADATA_ERROR, message: errorMessage, ...metadataMessage};
  return metadataResponse;
//METADATA BLOCK END
  };
}
