import putFileOSF from "./put-file-osf.js";
import queueUpload from "./queue-upload.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import { DerivedFile } from "./metadata-derived-files.js";

export interface DerivedUploadTarget {
  experimentID: string;
  owner: string;
  osfFilesLink: string;
}

/**
 * Uploads derived Psych-DS files (main data CSV, sidecar CSVs, .psychds-ignore)
 * to OSF, best-effort: the participant's raw data file is already safely in
 * OSF by the time this runs, and every derived file is reproducible from it,
 * so a failure is queued for retry (the same uploadQueue the data files use)
 * and logged — it never fails the submission.
 * A 409 means an earlier attempt already landed the file; nothing to do.
 */
export async function uploadDerivedFiles(
  files: DerivedFile[],
  target: DerivedUploadTarget,
  osfToken: string,
): Promise<void> {
  for (const file of files) {
    try {
      const result = await putFileOSF(target.osfFilesLink, osfToken, file.content, file.filename);
      if (result.success || result.errorCode === 409) continue;
      await queueDerivedFiles([file], target, `Derived file OSF error ${result.errorCode}: ${result.errorText}`);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Unknown error";
      await queueDerivedFiles([file], target, `Derived file upload exception: ${detail}`);
    }
  }
}

/**
 * Queues derived files for retried upload without attempting one first — used
 * when the raw data file itself just failed to reach OSF (it was queued, so
 * OSF is known to be unavailable). sessionIncremented is true because only
 * the raw data file accounts for the session count.
 */
export async function queueDerivedFiles(
  files: DerivedFile[],
  target: DerivedUploadTarget,
  failureReason: string,
): Promise<void> {
  for (const file of files) {
    try {
      await queueUpload({
        experimentID: target.experimentID,
        owner: target.owner,
        filename: file.filename,
        data: file.content,
        dataType: "data",
        osfFilesLink: target.osfFilesLink,
        errorCode: 0,
        sessionIncremented: true,
        failureReason,
      });
      await writeLog(target.experimentID, "logError", {...MESSAGES.OSF_UPLOAD_QUEUED, detail: `derived file ${file.filename}: ${failureReason}`});
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Unknown error";
      await writeLog(target.experimentID, "logError", {...MESSAGES.OSF_UPLOAD_ERROR, detail: `derived file ${file.filename} could not be queued: ${detail}`});
    }
  }
}
