import fetch from "node-fetch";
import putFileOSF from "../put-file-osf.js";
import updateFileOSF from "../update-file-osf.js";
import { OSFFile } from "../interfaces.js";
import {
  StorageProvider,
  ResolvedAuth,
  ContainerRef,
  FileRef,
  FileMeta,
  WriteResult,
  ProviderErrorCode,
} from "./types.js";

// The OSF container ref shape — only the filesLink is meaningful to this adapter.
export interface OSFContainerRef extends ContainerRef {
  provider: "osf";
  filesLink: string;
}

function mapStatus(errorCode: number | null): ProviderErrorCode {
  switch (errorCode) {
    case 409:
      return "NAME_CONFLICT";
    case 401:
    case 403:
      return "AUTH_EXPIRED";
    case 429:
      return "RATE_LIMITED";
    case 507:
      return "QUOTA_EXCEEDED";
    default:
      return "UNAVAILABLE";
  }
}

export const osfProvider: StorageProvider = {
  id: "osf",
  authMethod: "oauth2",
  capabilities: {
    nativeSubfolders: true,
    supportsRegion: true,
    maxFileSizeBytes: null,
    quotaNote: null,
  },

  async createDataContainer(): Promise<ContainerRef> {
    throw new Error("osfProvider.createDataContainer is not implemented");
  },

  async writeSessionFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    filename: string,
    data: string | Buffer,
    _meta: FileMeta
  ): Promise<WriteResult> {
    const osfContainer = container as OSFContainerRef;

    const result = await putFileOSF(osfContainer.filesLink, auth.token, data, filename);

    if (result.success) {
      const storedFilename = result.fileName ?? filename;
      return {
        success: true,
        fileRef: { name: storedFilename, id: result.fileId },
        storedFilename,
      };
    }

    return {
      success: false,
      error: mapStatus(result.errorCode),
      providerStatus: result.errorCode,
      providerMessage: result.errorText,
      retryAfter: result.retryAfter,
    };
  },

  async updateFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    existingFileRef: FileRef,
    data: string | Buffer,
    _meta: FileMeta
  ): Promise<WriteResult> {
    const osfContainer = container as OSFContainerRef;

    // updateFileOSF throws on non-200 responses — let the throw propagate,
    // callers rely on this behavior.
    await updateFileOSF(osfContainer.filesLink, auth.token, data as string, existingFileRef.id as string);

    return {
      success: true,
      fileRef: existingFileRef,
      storedFilename: existingFileRef.name,
    };
  },

  async listFiles(auth: ResolvedAuth, container: ContainerRef): Promise<FileRef[]> {
    const osfContainer = container as OSFContainerRef;

    const osfResult = await fetch(`${osfContainer.filesLink}?meta=`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
    });

    const folder = (await osfResult.json()) as { data: OSFFile[] };
    const listOfFiles: OSFFile[] = folder["data"];

    return listOfFiles
      .filter((file) => file.attributes.kind === "file")
      .map((file) => ({ name: file.attributes.name, id: file.id }));
  },
};
