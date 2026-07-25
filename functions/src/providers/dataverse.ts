import fetch from "node-fetch";
import { decrypt } from "../crypto-utils.js";
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
} from "./types.js";

// The Dataverse container ref shape. Unlike every other provider, Dataverse
// is FEDERATED -- each researcher's dataset lives on whichever installation
// their institution runs (Harvard Dataverse, Borealis, DataverseNL, ...) --
// so `serverUrl` travels on the container as well as on the connection
// (StaticTokenAccountConnection.serverUrl). Storing it on both makes an
// experiment self-describing even if the owner's connection is later
// reconnected against a different installation.
export interface DataverseContainerRef extends ContainerRef {
  provider: "dataverse";
  datasetId: number; // numeric database id
  persistentId: string; // DOI, for researcher-facing links
  serverUrl: string; // which installation this dataset lives on
}

// Paginate LIST DRAFT FILES in chunks of this size (see listFiles below).
const LIST_PAGE_LIMIT = 1000;

// A fixed boundary is fine here — the request body is built and sent in one
// shot, never streamed/concatenated across requests, so there's no need for
// per-call uniqueness. Mirrors gdrive.ts's MULTIPART_BOUNDARY convention.
const MULTIPART_BOUNDARY = "datapipe-dataverse-multipart-boundary";

function authHeaders(auth: ResolvedAuth): Record<string, string> {
  return { "X-Dataverse-key": auth.token };
}

// serverUrl is federated: it can come from the container (an already-created
// dataset knows exactly which installation it lives on) or from auth (the
// researcher's current connection). The container wins when both are present
// since that's the installation the dataset actually lives on; auth is the
// fallback for calls that don't yet have a container (e.g. createDataContainer).
function resolveServerUrl(auth: ResolvedAuth, container?: ContainerRef): string {
  const fromContainer = (container as DataverseContainerRef | undefined)?.serverUrl;
  const serverUrl = fromContainer ?? auth.serverUrl;
  if (!serverUrl) {
    throw new Error("Dataverse serverUrl is missing from both the container and the resolved auth");
  }
  return serverUrl;
}

function isSuccessStatus(status: number): boolean {
  // The docs say ADD FILE returns 201; the Java source returns ok() (200)
  // and the IQSS integration-test suite asserts 200. Accept 200 as the real
  // contract and 201 defensively, in case a future version changes it.
  return status === 200 || status === 201;
}

interface MappedDataverseError {
  error: ProviderErrorCode;
  providerStatus: number;
  providerMessage: string;
  retryAfter: number | null;
}

// Shared error-mapping helper — every write/update/list/download call routes
// its non-2xx response through this. Dataverse never yields a duplicate-name
// conflict (NAME_CONFLICT is never returned): duplicate filenames are
// silently renamed by the server (see writeSessionFile), not rejected.
function mapDataverseError(
  status: number,
  statusText: string,
  body: { status?: string; message?: string } | undefined
): MappedDataverseError {
  const message = body?.message ?? statusText;

  let error: ProviderErrorCode;
  if (status === 401) {
    // Both an invalid token AND permission-denied come back as 401 from
    // Dataverse -- there is no separate 403-for-permissions case to handle
    // here (see the size-limit/lock checks below, which ARE genuine 403/400).
    error = "AUTH_EXPIRED";
  } else if (status === 403 && /dataset lock/i.test(message)) {
    // Exact server text: "Dataset cannot be edited due to dataset lock."
    // This is transient (another edit is in flight) -- UNAVAILABLE routes it
    // into the retry queue instead of surfacing a hard failure.
    error = "UNAVAILABLE";
  } else if (
    status === 400 &&
    (/exceeds the size limit/i.test(message) || /exceeds the remaining storage quota/i.test(message))
  ) {
    error = "QUOTA_EXCEEDED";
  } else if (status === 429) {
    error = "RATE_LIMITED";
  } else {
    error = "UNAVAILABLE";
  }

  // There is no Retry-After header anywhere in Dataverse's source (including
  // on 429s) -- never invent one.
  return { error, providerStatus: status, providerMessage: message, retryAfter: null };
}

// Reads the body defensively (Dataverse error bodies are JSON
// {"status":"ERROR","message":"..."}, but tolerate non-JSON) and maps the
// response into the shared error shape.
async function mapErrorResponse(response: {
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}): Promise<MappedDataverseError> {
  let body: { status?: string; message?: string } | undefined;
  try {
    body = (await response.json()) as { status?: string; message?: string };
  } catch {
    body = undefined;
  }
  return mapDataverseError(response.status, response.statusText, body);
}

// Hand-built multipart/form-data body with exactly two parts, field names
// "file" and "jsonData" -- mirrors gdrive.ts's buildMultipartBody convention.
function buildMultipartBody(
  jsonData: object,
  filename: string,
  data: string | Buffer,
  contentType: string
): Buffer {
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const preamble =
    `--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const middle =
    `\r\n--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="jsonData"\r\n\r\n` +
    `${JSON.stringify(jsonData)}\r\n`;
  const epilogue = `--${MULTIPART_BOUNDARY}--`;

  return Buffer.concat([Buffer.from(preamble), dataBuffer, Buffer.from(middle), Buffer.from(epilogue)]);
}

interface AddFileResponseBody {
  status?: string;
  data?: {
    files?: {
      label?: string;
      directoryLabel?: string;
      dataFile?: { id?: number; filename?: string; contentType?: string; filesize?: number };
    }[];
  };
}

export const dataverseProvider: StorageProvider = {
  id: "dataverse",
  authMethod: "static-token",
  capabilities: {
    nativeSubfolders: true,
    supportsRegion: false,
    // Per-installation and NOT readable through any public Dataverse
    // endpoint -- each institution's server sets its own cap, and there is
    // no API that surfaces it, so this stays null (descriptive only; never a
    // correctness gate -- see types.ts).
    maxFileSizeBytes: null,
    quotaNote: "File size and storage limits are set by the researcher's hosting Dataverse installation",
  },

  async resolveToken(userData: UserData, _owner: string): Promise<TokenResult> {
    // _owner is unused: Dataverse is a static-token provider with no refresh
    // token to rotate, so there is no persist-back step the way gdrive's
    // resolveToken has (it calls refreshGdriveToken(owner, ...)).
    const dataverse = userData.connectedAccounts?.dataverse;

    if (!dataverse) {
      return {
        success: false,
        error: "PROVIDER_NOT_CONNECTED",
        detail: "No connected Dataverse account for this experiment's owner",
      };
    }

    // Dataverse API tokens expire (commonly yearly, installation-configurable)
    // and there is no refresh token to rotate -- unlike gdrive/OSF, an
    // expired Dataverse token can only be fixed by the researcher generating
    // a fresh one on their installation and reconnecting.
    if (dataverse.tokenExpiresAt && dataverse.tokenExpiresAt < Date.now()) {
      return {
        success: false,
        error: "PROVIDER_TOKEN_EXPIRED",
        detail: "The Dataverse API token for this experiment's owner has expired",
      };
    }

    return { success: true, token: decrypt(dataverse.encryptedToken), serverUrl: dataverse.serverUrl };
  },

  async validateStaticToken(auth: ResolvedAuth): Promise<boolean> {
    const serverUrl = resolveServerUrl(auth);
    const response = await fetch(`${serverUrl}/api/users/:me`, {
      method: "GET",
      headers: authHeaders(auth),
    });
    // Never throw on a non-200 -- a bad/expired token is simply "not valid",
    // not an exceptional condition.
    return response.status === 200;
  },

  async createDataContainer(auth: ResolvedAuth, researcherInput: Record<string, unknown>): Promise<ContainerRef> {
    const serverUrl = resolveServerUrl(auth);
    const collectionAlias = researcherInput.collectionAlias as string;
    const title = researcherInput.title as string;
    const authorName = researcherInput.authorName as string;
    const contactEmail = researcherInput.contactEmail as string;
    const description = researcherInput.description as string;
    const subject = (researcherInput.subject as string) ?? "Social Sciences";

    const body = {
      datasetVersion: {
        metadataBlocks: {
          citation: {
            displayName: "Citation Metadata",
            fields: [
              { typeName: "title", typeClass: "primitive", multiple: false, value: title },
              {
                typeName: "author",
                typeClass: "compound",
                multiple: true,
                value: [
                  {
                    authorName: {
                      typeName: "authorName",
                      typeClass: "primitive",
                      multiple: false,
                      value: authorName,
                    },
                  },
                ],
              },
              {
                typeName: "datasetContact",
                typeClass: "compound",
                multiple: true,
                value: [
                  {
                    datasetContactEmail: {
                      typeName: "datasetContactEmail",
                      typeClass: "primitive",
                      multiple: false,
                      value: contactEmail,
                    },
                  },
                ],
              },
              {
                typeName: "dsDescription",
                typeClass: "compound",
                multiple: true,
                value: [
                  {
                    dsDescriptionValue: {
                      typeName: "dsDescriptionValue",
                      typeClass: "primitive",
                      multiple: false,
                      value: description,
                    },
                  },
                ],
              },
              { typeName: "subject", typeClass: "controlledVocabulary", multiple: true, value: [subject] },
            ],
          },
        },
      },
    };

    const response = await fetch(`${serverUrl}/api/dataverses/${collectionAlias}/datasets`, {
      method: "POST",
      headers: {
        ...authHeaders(auth),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // createDataContainer has no error union in the StorageProvider
    // interface (matches osf/gdrive) -- signal failure by throwing, same as
    // gdrive's folder-creation failures.
    if (response.status !== 200) {
      const mapped = await mapErrorResponse(response);
      throw new Error(`Dataverse dataset creation failed: ${mapped.providerStatus} ${mapped.providerMessage}`);
    }

    const responseBody = (await response.json()) as { data?: { id?: number; persistentId?: string } };
    const datasetId = responseBody.data?.id as number;
    const persistentId = responseBody.data?.persistentId as string;

    return { provider: "dataverse", datasetId, persistentId, serverUrl };
  },

  async writeSessionFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    filename: string,
    data: string | Buffer,
    meta: FileMeta
  ): Promise<WriteResult> {
    const dataverseContainer = container as DataverseContainerRef;
    const serverUrl = resolveServerUrl(auth, dataverseContainer);

    // A filename may carry a multi-level path prefix (e.g.
    // "data/raw/abc123.json"). Dataverse's native subfolder mechanism is a
    // single flat `directoryLabel` string, not pre-created nested folders
    // like Drive -- so unlike gdrive.ts, there is no findOrCreateFolder walk
    // here. The leading segments just join back together with "/".
    const segments = filename.split("/");
    const uploadFilename = segments.pop() as string;
    const directoryLabel = segments.length > 0 ? segments.join("/") : undefined;

    const jsonData: Record<string, unknown> = {
      // Always the STRING "false" -- every official example uses the string,
      // and if this is omitted Dataverse defaults to TRUE and silently
      // converts CSVs into archival .tab files, mangling researchers' data.
      tabIngest: "false",
    };
    if (directoryLabel) {
      jsonData.directoryLabel = directoryLabel;
    }

    const body = buildMultipartBody(jsonData, uploadFilename, data, meta.contentType);

    const response = await fetch(`${serverUrl}/api/datasets/${dataverseContainer.datasetId}/add`, {
      method: "POST",
      headers: {
        ...authHeaders(auth),
        "Content-Type": `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
      },
      body,
    });

    if (!isSuccessStatus(response.status)) {
      const mapped = await mapErrorResponse(response);
      return { success: false, ...mapped };
    }

    const responseBody = (await response.json()) as AddFileResponseBody;
    const uploaded = responseBody.data?.files?.[0];

    // Dataverse SILENTLY RENAMES duplicate filenames (uploading README.md
    // twice yields label "README-1.md") -- storedFilename MUST come from the
    // response's `label`, never assumed to equal the requested name. This is
    // exactly the case WriteResult.storedFilename exists to detect. Dataverse
    // can never produce a NAME_CONFLICT, so there's no error path for it.
    const storedFilename = uploaded?.label as string;

    return {
      success: true,
      fileRef: { name: storedFilename, id: String(uploaded?.dataFile?.id) },
      storedFilename,
    };
  },

  // Implemented as DELETE then re-add, because Dataverse's
  // `/api/files/{id}/replace` endpoint is NOT available on a never-published
  // draft dataset, and DataPipe deliberately keeps datasets in draft
  // indefinitely (docs/provider-migration-design.md). This is therefore
  // NON-ATOMIC -- there is a brief window where the file does not exist --
  // the same caveat the design doc already documents for Figshare's
  // updateFile (delete + re-upload there too). If the delete fails, this
  // returns a failure WriteResult rather than proceeding to re-add, so a
  // failed delete can never silently duplicate the file under a new id.
  async updateFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    existingFileRef: FileRef,
    data: string | Buffer,
    meta: FileMeta
  ): Promise<WriteResult> {
    const serverUrl = resolveServerUrl(auth, container as DataverseContainerRef);

    const deleteResponse = await fetch(`${serverUrl}/api/files/${existingFileRef.id}`, {
      method: "DELETE",
      headers: authHeaders(auth),
    });

    if (!isSuccessStatus(deleteResponse.status)) {
      const mapped = await mapErrorResponse(deleteResponse);
      return { success: false, ...mapped };
    }

    return dataverseProvider.writeSessionFile(auth, container, existingFileRef.name, data, meta);
  },

  async listFiles(auth: ResolvedAuth, container: ContainerRef): Promise<FileRef[]> {
    const dataverseContainer = container as DataverseContainerRef;
    const serverUrl = resolveServerUrl(auth, dataverseContainer);

    // Paginate internally (the StorageProvider interface requires a full
    // listing): page with a limit of 1000, looping until every result has
    // been collected. Guards against an infinite loop if totalCount is
    // missing or a page comes back empty before totalCount is reached.
    const results: FileRef[] = [];
    let offset = 0;
    let totalCount: number | undefined;

    while (totalCount === undefined || results.length < totalCount) {
      const url = new URL(`${serverUrl}/api/datasets/${dataverseContainer.datasetId}/versions/:draft/files`);
      url.searchParams.set("limit", String(LIST_PAGE_LIMIT));
      url.searchParams.set("offset", String(offset));

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: authHeaders(auth),
      });

      if (!isSuccessStatus(response.status)) {
        const mapped = await mapErrorResponse(response);
        throw new Error(`Dataverse listing failed: ${mapped.providerStatus} ${mapped.providerMessage}`);
      }

      const body = (await response.json()) as {
        totalCount?: number;
        data?: { label?: string; directoryLabel?: string; dataFile?: { id?: number } }[];
      };
      totalCount = body.totalCount;

      const page = body.data || [];
      if (page.length === 0) {
        // Guard against an infinite loop when totalCount is missing/wrong
        // and the server has nothing left to give us.
        break;
      }

      for (const file of page) {
        // Re-join directoryLabel with label so `name` round-trips with the
        // path-prefixed filename writeSessionFile takes ("data/raw/x.json"
        // -> directoryLabel "data/raw" + label "x.json"). Returning the bare
        // label would break two things: updateFile re-adds under
        // existingFileRef.name and would drop the file back to the dataset
        // root, and the collision cache claims prefixed filenames, so
        // rehydration would fail to match an existing file and let a
        // duplicate through -- which Dataverse then silently renames rather
        // than rejecting. Two files sharing a label in different directories
        // would also collapse together here.
        const name = file.directoryLabel
          ? `${file.directoryLabel}/${file.label}`
          : (file.label as string);
        results.push({ name, id: String(file.dataFile?.id) });
      }

      offset += page.length;
    }

    return results;
  },

  async downloadFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    fileRef: FileRef
  ): Promise<DownloadResult> {
    const serverUrl = resolveServerUrl(auth, container as DataverseContainerRef);

    const response = await fetch(`${serverUrl}/api/access/datafile/${fileRef.id}`, {
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
