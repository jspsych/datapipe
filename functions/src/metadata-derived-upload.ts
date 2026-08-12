import { getProvider } from "./providers/index.js";
import { StorageProviderId, ContainerRef, ResolvedAuth, ProviderErrorCode } from "./providers/types.js";
import queueUpload from "./queue-upload.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import { DerivedFile } from "./metadata-derived-files.js";

export interface DerivedUploadTarget {
  experimentID: string;
  owner: string;
  // undefined ⇒ legacy OSF experiment (predates the provider-migration schema).
  storageProvider?: StorageProviderId;
  providerContainer?: ContainerRef;
  // Legacy fallback: only meaningful when storageProvider is absent.
  osfFilesLink?: string;
}

// Resolves the provider + container the same way scheduled-upload-retry.ts
// does: provider-migration fields when present, otherwise the legacy OSF
// shape built from osfFilesLink.
function resolveProviderAndContainer(target: DerivedUploadTarget) {
  const providerId = (target.storageProvider as StorageProviderId) || "osf";
  const provider = getProvider(providerId);
  const container: ContainerRef = target.providerContainer
    ? (target.providerContainer as ContainerRef)
    : { provider: "osf", filesLink: target.osfFilesLink };
  return { provider, container };
}

function contentTypeFor(filename: string): string {
  if (filename.endsWith(".csv")) return "text/csv";
  if (filename.endsWith(".json")) return "application/json";
  return "text/plain";
}

/**
 * Uploads derived Psych-DS files (main data CSV, sidecar CSVs, .psychds-ignore)
 * through the experiment's storage provider, best-effort: the participant's
 * raw data file is already safely stored by the time this runs, and every
 * derived file is reproducible from it, so a failure is queued for retry (the
 * same uploadQueue the data files use) and logged — it never fails the
 * submission.
 * A NAME_CONFLICT means an earlier attempt already landed the file; nothing
 * to do. Each file's writeSessionFile walks its own path — no shared
 * up-front folder resolution — concurrent folder-create races are handled
 * inside the provider adapters themselves.
 */
export async function uploadDerivedFiles(
  files: DerivedFile[],
  target: DerivedUploadTarget,
  auth: ResolvedAuth,
): Promise<void> {
  const { provider, container } = resolveProviderAndContainer(target);

  await Promise.allSettled(files.map(async (file) => {
    try {
      const result = await provider.writeSessionFile(
        auth,
        container,
        file.filename,
        file.content,
        { size: Buffer.byteLength(file.content), contentType: contentTypeFor(file.filename) }
      );
      if (result.success) return;
      if (result.error === "NAME_CONFLICT") return;
      await queueDerivedFiles([file], target, `Derived file provider error ${result.providerStatus}: ${result.providerMessage}`, result.error);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Unknown error";
      await queueDerivedFiles([file], target, `Derived file upload exception: ${detail}`);
    }
  }));
}

/**
 * Queues derived files for retried upload without attempting one first — used
 * when the raw data file itself just failed to reach the provider (it was
 * queued, so the provider is known to be unavailable). sessionIncremented is
 * true because only the raw data file accounts for the session count.
 * providerErrorCode is optional — only present when this is being called
 * after an actual provider WriteResult failure (either the derived file's own
 * attempt in uploadDerivedFiles, or the raw data file's failure in
 * api-data.ts); absent for the exception-path callers that never got a
 * WriteResult at all, which correctly fall back to the slow retry tier.
 */
export async function queueDerivedFiles(
  files: DerivedFile[],
  target: DerivedUploadTarget,
  failureReason: string,
  providerErrorCode?: ProviderErrorCode,
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
        storageProvider: target.storageProvider,
        providerContainer: target.providerContainer,
        errorCode: 0,
        providerErrorCode,
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
