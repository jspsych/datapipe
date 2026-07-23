import fetch from "node-fetch";
import {
  StorageProvider,
  ResolvedAuth,
  ContainerRef,
  FileRef,
  FileMeta,
  WriteResult,
  DownloadResult,
  ProviderErrorCode,
} from "./types.js";

// The gdrive container ref shape — only the folderId is meaningful to this
// adapter (the Drive folder an experiment's session files land in).
export interface GdriveContainerRef extends ContainerRef {
  provider: "gdrive";
  folderId: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

// A fixed boundary is fine here — the request body is built and sent in one
// shot, never streamed/concatenated across requests, so there's no need for
// per-call uniqueness.
const MULTIPART_BOUNDARY = "datapipe-gdrive-multipart-boundary";

// GDRIVE_API_BASE is read at CALL time (not module load) so tests — and, in
// production, config changes — can vary it without a process restart.
function getApiBase(): string {
  return process.env.GDRIVE_API_BASE || "https://www.googleapis.com";
}

function authHeaders(auth: ResolvedAuth): Record<string, string> {
  return { Authorization: `Bearer ${auth.token}` };
}

// Google Drive `q` filters are single-quoted strings; escape backslashes and
// embedded single quotes per Drive's query syntax.
function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isSuccessStatus(status: number): boolean {
  return status === 200 || status === 201;
}

interface MappedDriveError {
  error: ProviderErrorCode;
  providerStatus: number;
  providerMessage: string;
  retryAfter: number | null;
}

// Shared error-mapping helper — every write/update/list/download call routes
// its non-2xx response through this. Drive never yields a duplicate-name
// conflict (NAME_CONFLICT): Drive allows multiple files with the same name
// in the same folder, so the collision cache (not the provider) is the only
// duplicate gate for gdrive experiments.
function mapDriveError(
  status: number,
  statusText: string,
  body: { errors?: { reason?: string; message?: string }[] } | undefined,
  retryAfterHeader: string | null
): MappedDriveError {
  const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;

  let error: ProviderErrorCode;
  if (status === 401) {
    error = "AUTH_EXPIRED";
  } else if (status === 403) {
    const reason = body?.errors?.[0]?.reason;
    if (reason === "storageQuotaExceeded") {
      error = "QUOTA_EXCEEDED";
    } else if (
      reason === "userRateLimitExceeded" ||
      reason === "rateLimitExceeded" ||
      reason === "dailyLimitExceeded"
    ) {
      error = "RATE_LIMITED";
    } else {
      error = "AUTH_EXPIRED";
    }
  } else if (status === 429) {
    error = "RATE_LIMITED";
  } else {
    error = "UNAVAILABLE";
  }

  return { error, providerStatus: status, providerMessage: statusText, retryAfter };
}

// Reads the body (only when the status requires inspecting it — the 403
// reason drill-down) and maps the response into the shared error shape.
async function mapErrorResponse(response: {
  status: number;
  statusText: string;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
}): Promise<MappedDriveError> {
  let body: { errors?: { reason?: string; message?: string }[] } | undefined;
  if (response.status === 403) {
    try {
      body = (await response.json()) as { errors?: { reason?: string; message?: string }[] };
    } catch {
      body = undefined;
    }
  }
  const retryAfterHeader = response.headers.get("Retry-After");
  return mapDriveError(response.status, response.statusText, body, retryAfterHeader);
}

// Finds a folder by exact name under a given parent. Returns null if none
// exists yet.
async function findFolder(
  auth: ResolvedAuth,
  name: string,
  parentId: string
): Promise<string | null> {
  const url = new URL(`${getApiBase()}/drive/v3/files`);
  const q = `name='${escapeQueryValue(name)}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
  url.searchParams.set("q", q);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: authHeaders(auth),
  });

  if (!isSuccessStatus(response.status)) {
    const mapped = await mapErrorResponse(response);
    throw new Error(`Google Drive folder lookup failed: ${mapped.providerStatus} ${mapped.providerMessage}`);
  }

  const body = (await response.json()) as { files?: { id: string }[] };
  const files = body.files || [];
  return files.length > 0 ? files[0].id : null;
}

async function createFolder(auth: ResolvedAuth, name: string, parentId: string): Promise<string> {
  const response = await fetch(`${getApiBase()}/drive/v3/files`, {
    method: "POST",
    headers: {
      ...authHeaders(auth),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });

  if (!isSuccessStatus(response.status)) {
    const mapped = await mapErrorResponse(response);
    throw new Error(`Google Drive folder creation failed: ${mapped.providerStatus} ${mapped.providerMessage}`);
  }

  const body = (await response.json()) as { id: string };
  return body.id;
}

async function findOrCreateFolder(auth: ResolvedAuth, name: string, parentId: string): Promise<string> {
  const existingId = await findFolder(auth, name, parentId);
  if (existingId) {
    return existingId;
  }
  return createFolder(auth, name, parentId);
}

// Hand-built multipart/related body: part 1 is the JSON metadata (name +
// parents), part 2 is the raw file payload — no extra dependencies needed
// for this.
function buildMultipartBody(metadata: object, data: string | Buffer, contentType: string): Buffer {
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const preamble =
    `--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const epilogue = `\r\n--${MULTIPART_BOUNDARY}--`;

  return Buffer.concat([Buffer.from(preamble), dataBuffer, Buffer.from(epilogue)]);
}

export const gdriveProvider: StorageProvider = {
  id: "gdrive",
  authMethod: "oauth2",
  capabilities: {
    nativeSubfolders: true,
    supportsRegion: false,
    maxFileSizeBytes: null,
    quotaNote: "Free Google accounts share 15 GB across Drive, Gmail, and Photos",
  },

  async createDataContainer(auth: ResolvedAuth, researcherInput: Record<string, unknown>): Promise<ContainerRef> {
    const name = researcherInput.name as string;

    let rootId = await findFolder(auth, "DataPipe", "root");
    if (!rootId) {
      rootId = await createFolder(auth, "DataPipe", "root");
    }

    // Experiment folders are always created fresh — Drive allows duplicate
    // names, so there's nothing to find-or-create here.
    const folderId = await createFolder(auth, name, rootId);

    return { provider: "gdrive", folderId };
  },

  async writeSessionFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    filename: string,
    data: string | Buffer,
    meta: FileMeta
  ): Promise<WriteResult> {
    const gdriveContainer = container as GdriveContainerRef;

    let parentId = gdriveContainer.folderId;
    let uploadFilename = filename;

    const slashIndex = filename.indexOf("/");
    if (slashIndex !== -1) {
      const subfolderName = filename.slice(0, slashIndex);
      uploadFilename = filename.slice(slashIndex + 1);
      try {
        parentId = await findOrCreateFolder(auth, subfolderName, gdriveContainer.folderId);
      } catch (e) {
        return {
          success: false,
          error: "UNAVAILABLE",
          providerStatus: null,
          providerMessage: e instanceof Error ? e.message : "Unknown error",
          retryAfter: null,
        };
      }
    }

    const body = buildMultipartBody(
      { name: uploadFilename, parents: [parentId] },
      data,
      meta.contentType
    );

    const response = await fetch(`${getApiBase()}/upload/drive/v3/files?uploadType=multipart`, {
      method: "POST",
      headers: {
        ...authHeaders(auth),
        "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
      },
      body,
    });

    if (!isSuccessStatus(response.status)) {
      const mapped = await mapErrorResponse(response);
      return { success: false, ...mapped };
    }

    const responseBody = (await response.json()) as { id?: string; name?: string };
    const storedFilename = responseBody.name ?? uploadFilename;

    return {
      success: true,
      fileRef: { id: responseBody.id, name: storedFilename },
      storedFilename,
    };
  },

  async updateFile(
    auth: ResolvedAuth,
    _container: ContainerRef,
    existingFileRef: FileRef,
    data: string | Buffer,
    meta: FileMeta
  ): Promise<WriteResult> {
    const response = await fetch(
      `${getApiBase()}/upload/drive/v3/files/${existingFileRef.id}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(auth),
          "Content-Type": meta.contentType,
        },
        body: data,
      }
    );

    if (!isSuccessStatus(response.status)) {
      const mapped = await mapErrorResponse(response);
      return { success: false, ...mapped };
    }

    return {
      success: true,
      fileRef: existingFileRef,
      storedFilename: existingFileRef.name,
    };
  },

  async listFiles(auth: ResolvedAuth, container: ContainerRef): Promise<FileRef[]> {
    const gdriveContainer = container as GdriveContainerRef;
    const q = `'${gdriveContainer.folderId}' in parents and trashed=false`;

    const results: FileRef[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${getApiBase()}/drive/v3/files`);
      url.searchParams.set("q", q);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType)");
      url.searchParams.set("pageSize", "1000");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: authHeaders(auth),
      });

      // A failed listing MUST throw, never return a partial/empty result:
      // collision-cache rehydration treats the returned list as the complete
      // set of existing filenames, and Drive has no 409 backstop — silently
      // returning [] here would warm the cache empty and let duplicates
      // through. The throw surfaces as CollisionCacheUnavailableError.
      if (!isSuccessStatus(response.status)) {
        const mapped = await mapErrorResponse(response);
        throw new Error(
          `Google Drive listing failed: ${mapped.providerStatus} ${mapped.providerMessage}`
        );
      }

      const body = (await response.json()) as {
        nextPageToken?: string;
        files?: { id: string; name: string; mimeType: string }[];
      };

      for (const file of body.files || []) {
        if (file.mimeType === FOLDER_MIME) {
          continue;
        }
        results.push({ id: file.id, name: file.name });
      }

      pageToken = body.nextPageToken;
    } while (pageToken);

    return results;
  },

  async downloadFile(
    auth: ResolvedAuth,
    _container: ContainerRef,
    fileRef: FileRef
  ): Promise<DownloadResult> {
    const response = await fetch(`${getApiBase()}/drive/v3/files/${fileRef.id}?alt=media`, {
      method: "GET",
      headers: authHeaders(auth),
    });

    if (!isSuccessStatus(response.status)) {
      const mapped = await mapErrorResponse(response);
      return {
        success: false,
        error: mapped.error,
        providerStatus: mapped.providerStatus,
        providerMessage: mapped.providerMessage,
      };
    }

    const content = await response.text();
    return { success: true, content };
  },
};
