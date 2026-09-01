import fetch from "node-fetch";
import { decrypt } from "../crypto-utils.js";
import { db } from "../app.js";
import { refreshGdriveToken } from "./gdrive-oauth.js";
import { UserData } from "../interfaces.js";
import {
  StorageProvider,
  ResolvedAuth,
  ContainerRef,
  FileRef,
  FileMeta,
  WriteResult,
  DownloadResult,
  ProviderErrorCode,
  TokenResult,
  OAuthConfig,
} from "./types.js";

// The gdrive container ref shape — only the folderId is meaningful to this
// adapter (the Drive folder an experiment's session files land in).
export interface GdriveContainerRef extends ContainerRef {
  provider: "gdrive";
  folderId: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

const GDRIVE_DEFAULT_WINDOW_MS = 10 * 60 * 1000;

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

// Raised by the folder helpers so a failure part-way through a nested path
// keeps its CLASSIFICATION, not just its text.
//
// findFolder/createFolder both compute a MappedDriveError and then used to
// stringify it into a plain Error, so writeSessionFile's segment walk could
// only report a generic UNAVAILABLE. That is user-facing: QueuePanel.js shows
// "your storage provider connection may need to be refreshed" for
// AUTH_EXPIRED and "temporarily unavailable" for UNAVAILABLE, so a researcher
// with an expired Drive token was told to wait for an outage that would never
// clear. It only misfired on NESTED paths -- i.e. every metadataActive
// experiment, which writes to data/raw/... -- while the same expired token on
// a flat filename classified correctly, which is why it went unnoticed.
class DriveFolderError extends Error {
  readonly mapped: MappedDriveError;
  constructor(message: string, mapped: MappedDriveError) {
    super(message);
    this.name = "DriveFolderError";
    this.mapped = mapped;
  }
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
  // Shared Drives require these on every list/query call, or folders that
  // live in a shared drive are invisible to the query.
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: authHeaders(auth),
  });

  if (!isSuccessStatus(response.status)) {
    const mapped = await mapErrorResponse(response);
    throw new DriveFolderError(
      `Google Drive folder lookup failed: ${mapped.providerStatus} ${mapped.providerMessage}`,
      mapped
    );
  }

  const body = (await response.json()) as { files?: { id: string }[] };
  const files = body.files || [];
  if (files.length === 0) {
    return null;
  }

  // Lowest id wins, deterministically, rather than "whatever Drive listed
  // first". Drive allows duplicate folder names and does not document an
  // ordering here, so with duplicates present two concurrent writers could
  // otherwise pick DIFFERENT folders and keep fragmenting the tree. Sorting
  // makes every caller converge on one, which is what stops a race from
  // compounding once it has happened. Preventing it in the first place is
  // createDataContainer's job (see the eager folder creation there).
  return files.map((file) => file.id).sort()[0];
}

async function createFolder(auth: ResolvedAuth, name: string, parentId: string): Promise<string> {
  const response = await fetch(`${getApiBase()}/drive/v3/files?supportsAllDrives=true`, {
    method: "POST",
    headers: {
      ...authHeaders(auth),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });

  if (!isSuccessStatus(response.status)) {
    const mapped = await mapErrorResponse(response);
    throw new DriveFolderError(
      `Google Drive folder creation failed: ${mapped.providerStatus} ${mapped.providerMessage}`,
      mapped
    );
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
    // Drive's per-folder limit (500k) is far beyond any experiment, and the
    // real constraint is bytes, not files -- see quotaNote.
    maxFileCount: null,
    quotaNote: "Free Google accounts share 15 GB across Drive, Gmail, and Photos",
  },

  // Supplied by the Google Picker (a bespoke UI), not a rendered text field --
  // hence inputType "hidden" rather than "text".
  containerInput: [
    { name: "parentId", label: "Parent folder", required: false, inputType: "hidden" },
  ],

  // A method rather than a static object so env vars are read at CALL time,
  // not module load -- same reason as getApiBase() above.
  oauthConfig(): OAuthConfig {
    return {
      authorizeUrl:
        process.env.GDRIVE_AUTHORIZE_URL || "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: process.env.GDRIVE_TOKEN_URL || "https://oauth2.googleapis.com/token",
      clientId: process.env.GDRIVE_CLIENT_ID as string,
      clientSecret: process.env.GDRIVE_CLIENT_SECRET as string,
      redirectUri: process.env.GDRIVE_REDIRECT_URI as string,
      scope: "https://www.googleapis.com/auth/drive.file",
      // Without these, Google won't issue a refresh_token on the consent
      // grant — a half-connected account (access token, no refresh token)
      // is treated as a hard failure downstream.
      extraAuthParams: { access_type: "offline", prompt: "consent" },
    };
  },

  async resolveToken(user_data: UserData, owner: string): Promise<TokenResult> {
    const gdrive = user_data.connectedAccounts?.gdrive;

    if (!gdrive) {
      return {
        success: false,
        error: "PROVIDER_NOT_CONNECTED",
        detail: "No connected Google Drive account for this experiment's owner",
      };
    }

    if (gdrive.tokenExpiresAt > Date.now()) {
      return { success: true, token: decrypt(gdrive.encryptedToken) };
    }

    const refreshResult = await refreshGdriveToken(owner, gdrive);

    if (!refreshResult.success) {
      return { success: false, error: refreshResult.error, detail: refreshResult.detail };
    }

    return { success: true, token: refreshResult.accessToken };
  },

  /**
   * Proactively refreshes gdrive access tokens for users whose token expires
   * within `windowMs` (default 10 minutes). Mirrors the OSF pass's cadence
   * convention, but on a much shorter window since gdrive access tokens are
   * short-lived (~1 hour) rather than the ~1-month OSF refresh-token window.
   *
   * Failures are logged and skipped — a single user's refresh failure must
   * never abort the whole pass, and (in 4b) there is no user-visible state
   * change on failure: the connection is simply left as-is.
   */
  async refreshExpiringTokens(windowMs: number = GDRIVE_DEFAULT_WINDOW_MS): Promise<void> {
    const expirationThreshold = Date.now() + windowMs;

    const usersSnapshot = await db
      .collection("users")
      .where("connectedAccounts.gdrive.tokenExpiresAt", "<", expirationThreshold)
      .get();

    if (usersSnapshot.empty) {
      return;
    }

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data() as UserData;
      const gdrive = userData.connectedAccounts?.gdrive;
      const userId = userDoc.id;

      if (!gdrive) {
        continue;
      }

      try {
        const result = await refreshGdriveToken(userId, gdrive);
        if (!result.success) {
          console.error(`Failed to refresh gdrive token for user ${userId}: ${result.detail}`);
        }
      } catch (error) {
        console.error(`Error refreshing gdrive token for user ${userId}:`, error);
      }
    }
  },

  async createDataContainer(auth: ResolvedAuth, researcherInput: Record<string, unknown>): Promise<ContainerRef> {
    const name = researcherInput.name as string;
    const parentId = researcherInput.parentId as string | undefined;

    // A researcher-chosen parent (via the Picker) bypasses the DataPipe-root
    // convention entirely -- the experiment folder is created directly under
    // whatever folder they picked. Absent a parentId, fall back to today's
    // behavior: find-or-create a shared "DataPipe" folder at root and nest
    // the experiment folder under that.
    let targetParentId: string;
    if (parentId) {
      targetParentId = parentId;
    } else {
      let rootId = await findFolder(auth, "DataPipe", "root");
      if (!rootId) {
        rootId = await createFolder(auth, "DataPipe", "root");
      }
      targetParentId = rootId;
    }

    // Experiment folders are always created fresh — Drive allows duplicate
    // names, so there's nothing to find-or-create here.
    const folderId = await createFolder(auth, name, targetParentId);

    // Create the Psych-DS folder chain NOW, so the write path only ever finds
    // it. findOrCreateFolder is find-then-create with no atomicity, and Drive
    // offers no create-if-absent, so a burst of first-time submissions to a
    // brand-new nested path races and produces sibling folders with the same
    // name. Confirmed live rather than theorised: 8 concurrent writes to one
    // new path produced 8 folders (spike gate H, 2026-08-21).
    //
    // That is exactly the designed-for load -- requirement 6 is 30-100
    // students inside a minute, and on a fresh metadataActive experiment those
    // are all first-time writes to data/raw/. No data is lost (listFiles
    // recurses and collects by leaf name) but the researcher's Drive folder
    // ends up with the tree duplicated, which is not a valid Psych-DS layout.
    //
    // Created unconditionally rather than only for metadataActive experiments:
    // metadata can be switched on at any time, long after the container
    // exists, and two empty folders cost far less than the race they remove.
    // Best-effort -- a failure here must not fail experiment creation, since
    // the write path can still create them itself.
    try {
      const dataId = await findOrCreateFolder(auth, "data", folderId);
      await findOrCreateFolder(auth, "raw", dataId);
    } catch (e) {
      console.warn(
        `gdrive: could not pre-create the data/raw folders for ${folderId}; the write path will create them on demand:`,
        e instanceof Error ? e.message : e
      );
    }

    return { provider: "gdrive", folderId };
  },

  // No storedNameFor: Drive stores a path prefix as real nested FOLDERS, and
  // listFiles below reports every file under its full path relative to the
  // container root, so the name a write is claimed under is already the name
  // the listing reports. Identity is correct, which is what omitting this
  // means (see StorageProvider.storedNameFor).
  //
  // It used to return the bare leaf, deliberately over-claiming so that two
  // folders could not hide a duplicate from a leaf-only listing. Now that the
  // listing carries folder context the over-claim is pure loss -- it rejected
  // legitimate submissions that differed only by folder. See listFiles.

  async writeSessionFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    filename: string,
    data: string | Buffer,
    meta: FileMeta
  ): Promise<WriteResult> {
    const gdriveContainer = container as GdriveContainerRef;

    // A filename may carry a multi-level path prefix (e.g.
    // "data/raw/abc123.json"). Walk every segment, finding-or-creating each
    // folder level in turn, so nested Psych-DS paths land in the matching
    // nested Drive folders instead of only the first level.
    const segments = filename.split("/");
    const uploadFilename = segments.pop() as string;

    let parentId = gdriveContainer.folderId;
    try {
      for (const segment of segments) {
        parentId = await findOrCreateFolder(auth, segment, parentId);
      }
    } catch (e) {
      // A provider failure keeps whatever mapErrorResponse decided; only a
      // genuinely non-provider throw (a network error, a bug) falls back to
      // UNAVAILABLE. See DriveFolderError.
      if (e instanceof DriveFolderError) {
        return { success: false, ...e.mapped };
      }
      return {
        success: false,
        error: "UNAVAILABLE",
        providerStatus: null,
        providerMessage: e instanceof Error ? e.message : "Unknown error",
        retryAfter: null,
      };
    }

    const body = buildMultipartBody(
      { name: uploadFilename, parents: [parentId] },
      data,
      meta.contentType
    );

    const response = await fetch(`${getApiBase()}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`, {
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
      // fileRef.name intentionally mirrors the raw response (possibly
      // undefined) rather than falling back to storedFilename — callers
      // compare storedFilename against the requested name to detect a silent
      // rename, and a fabricated fileRef.name would defeat that.
      fileRef: { id: responseBody.id, name: responseBody.name as string },
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
      `${getApiBase()}/upload/drive/v3/files/${existingFileRef.id}?uploadType=media&supportsAllDrives=true`,
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

    // Recurses into subfolders (BFS) so collision-cache rehydration finds raw
    // files stored under nested Psych-DS paths (e.g. data/raw/). Every FILE
    // entry is reported under its full path RELATIVE TO THE CONTAINER ROOT,
    // matching what storedNameFor claims for the same write.
    //
    // This used to report the bare leaf instead, which over-claimed: on Drive
    // the cache is the only duplicate gate (Drive never returns
    // NAME_CONFLICT), so two submissions differing only in their folder --
    // "condition-A/abc.json" and "condition-B/abc.json" with metadata OFF --
    // hashed to one claim and the second participant's data was rejected as a
    // duplicate. Metadata-ON experiments were unaffected, because
    // metadata-derived-files.ts flattens researcher subfolders into the leaf
    // before the path is built.
    //
    // A failed listing at ANY level MUST throw (never return a partial/empty
    // result): collision-cache rehydration treats the returned list as the
    // complete set of existing filenames, and Drive has no 409 backstop --
    // silently returning a partial list here would warm the cache incomplete
    // and let duplicates through. The throw surfaces as
    // CollisionCacheUnavailableError.
    const results: FileRef[] = [];
    const foldersToVisit: { id: string; prefix: string }[] = [
      { id: gdriveContainer.folderId, prefix: "" },
    ];

    while (foldersToVisit.length > 0) {
      const { id: folderId, prefix } = foldersToVisit.shift() as { id: string; prefix: string };
      const q = `'${folderId}' in parents and trashed=false`;
      let pageToken: string | undefined;

      do {
        const url = new URL(`${getApiBase()}/drive/v3/files`);
        url.searchParams.set("q", q);
        url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType)");
        url.searchParams.set("pageSize", "1000");
        // Shared Drives require these on every list/query call, or folders
        // that live in a shared drive are invisible to the query.
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");
        if (pageToken) {
          url.searchParams.set("pageToken", pageToken);
        }

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: authHeaders(auth),
        });

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
          const path = prefix ? `${prefix}/${file.name}` : file.name;
          if (file.mimeType === FOLDER_MIME) {
            foldersToVisit.push({ id: file.id, prefix: path });
            continue;
          }
          results.push({ id: file.id, name: path });
        }

        pageToken = body.nextPageToken;
      } while (pageToken);
    }

    return results;
  },

  async downloadFile(
    auth: ResolvedAuth,
    _container: ContainerRef,
    fileRef: FileRef
  ): Promise<DownloadResult> {
    const response = await fetch(`${getApiBase()}/drive/v3/files/${fileRef.id}?alt=media&supportsAllDrives=true`, {
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
