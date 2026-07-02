import putFileOSF from "./put-file-osf.js";
import queueUpload from "./queue-upload.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import { SidecarFile } from "./metadata-sidecars.js";

export interface SidecarUploadTarget {
  experimentID: string;
  owner: string;
  osfFilesLink: string;
}

/**
 * Uploads sidecar CSVs to OSF, best-effort: the participant's data file is
 * already safely in OSF by the time this runs, and sidecars are derivable
 * from it, so a sidecar failure is queued for retry (the same uploadQueue
 * the data files use) and logged — it never fails the submission.
 * A 409 means an earlier attempt already landed the file; nothing to do.
 */
export async function uploadSidecars(
  sidecars: SidecarFile[],
  target: SidecarUploadTarget,
  osfToken: string,
): Promise<void> {
  for (const sidecar of sidecars) {
    try {
      const result = await putFileOSF(target.osfFilesLink, osfToken, sidecar.content, sidecar.filename);
      if (result.success || result.errorCode === 409) continue;
      await queueSidecars([sidecar], target, `Sidecar OSF error ${result.errorCode}: ${result.errorText}`);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Unknown error";
      await queueSidecars([sidecar], target, `Sidecar upload exception: ${detail}`);
    }
  }
}

/**
 * Queues sidecar CSVs for retried upload without attempting one first — used
 * when the main data file itself just failed to reach OSF (it was queued, so
 * OSF is known to be unavailable). sessionIncremented is true because only
 * the main data file accounts for the session count.
 */
export async function queueSidecars(
  sidecars: SidecarFile[],
  target: SidecarUploadTarget,
  failureReason: string,
): Promise<void> {
  for (const sidecar of sidecars) {
    try {
      await queueUpload({
        experimentID: target.experimentID,
        owner: target.owner,
        filename: sidecar.filename,
        data: sidecar.content,
        dataType: "data",
        osfFilesLink: target.osfFilesLink,
        errorCode: 0,
        sessionIncremented: true,
        failureReason,
      });
      await writeLog(target.experimentID, "logError", {...MESSAGES.OSF_UPLOAD_QUEUED, detail: `sidecar ${sidecar.filename}: ${failureReason}`});
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Unknown error";
      await writeLog(target.experimentID, "logError", {...MESSAGES.OSF_UPLOAD_ERROR, detail: `sidecar ${sidecar.filename} could not be queued: ${detail}`});
    }
  }
}
