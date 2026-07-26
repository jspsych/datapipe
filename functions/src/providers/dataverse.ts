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
  } else if (status === 400 && /failed to add file/i.test(message) && !/same content/i.test(message)) {
    // Live-verified against demo.dataverse.org, 2026-07-26: Dataverse accepts
    // exactly ONE concurrent write per dataset and rejects every other
    // in-flight write with this generic 400 in ~250ms. It clears in seconds
    // (sequential writes are flawless), so this is CONTENTION, not an
    // outage -- the queue retries it on a fast tier instead of the
    // hours-scale backoff UNAVAILABLE gets.
    //
    // The "same content" exclusion is essential. Dataverse ALSO rejects
    // byte-identical content with `This file has the same content as X that
    // is in the dataset. \nFailed to add file to dataset.`, which matches
    // "failed to add file" too but is NOT transient -- retrying it fast would
    // spin uselessly. That case is deliberately excluded here and falls
    // through to UNAVAILABLE below, unchanged.
    //
    // Open question, not fixed here: if a write actually succeeded
    // server-side but the response was lost (timeout, dropped connection),
    // the retry re-uploads identical content and gets THIS same-content 400.
    // Treating that as a failure can mark an upload that already SUCCEEDED
    // as failed. Worth a separate look -- see also WriteResult's lack of an
    // idempotent "already there" signal for this case.
    error = "CONTENTION";
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

// tabIngest (writeSessionFile's suppression of Dataverse's CSV->.tab
// archival rewrite) was added in Dataverse 5.11 (released 13 June 2022). On
// an older installation the parameter is silently ignored -- no error
// anywhere -- and researchers' CSVs get transformed with no signal that it
// happened. This compares the (major, minor) of a version string against
// (5, 11), ignoring patch/suffix.
//
// PARSING IS DELIBERATELY LENIENT, not strict semver -- verified live against
// real installations, 2026-07-26:
//   - demo.dataverse.org      -> "6.11"
//   - dataverse.harvard.edu   -> "6.10.1"
//   - borealisdata.ca         -> "v6.8.2-SP"  (leading "v", trailing "-SP")
// /^v?(\d+)\.(\d+)/ tolerates all three; anything that doesn't match at
// least major.minor returns null (unparseable) rather than throwing.
export function supportsTabIngest(rawVersion: string): boolean | null {
  const match = /^v?(\d+)\.(\d+)/.exec(rawVersion);
  if (!match) {
    return null;
  }
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  if (major !== 5) {
    return major > 5;
  }
  return minor >= 11;
}

// How far ahead of a token's expiry setupWarnings starts telling researchers
// to recreate + reconnect. 60 days: long enough to act on for a study that
// might otherwise run unattended for months, short enough that the warning
// doesn't fire a whole year early.
const TOKEN_EXPIRY_WARNING_MS = 60 * 24 * 60 * 60 * 1000;

// Extracts the expiry timestamp Dataverse embeds in an ENGLISH SENTENCE --
// there is no structured field anywhere in GET /api/users/token. Verified
// live, 2026-07-26: {"status":"OK","data":{"message":"Token <uuid> expires
// on 2027-07-26 14:14:52.317"}}. The server source is literally
// `ok(String.format("Token %s expires on %s", token.getTokenString(),
// token.getExpireTime()))` -- so this is parsing prose, not a contract.
//
// Two deliberate trade-offs, both accepted:
//  1. The timestamp is Java `Timestamp.toString()` format: "yyyy-MM-dd
//     HH:mm:ss.SSS" -- a SPACE, not "T", and NO TIMEZONE. It's the server's
//     local time, which we have no way to know, so the result can be off by
//     up to a day. That's fine for a 60-day-ahead warning and must never be
//     presented as precise.
//  2. Parsing a date out of prose is inherently brittle -- if a future
//     Dataverse version rewords this message, this silently returns null
//     rather than throwing. That's an accepted fail-open trade-off: an
//     unparseable expiry means no expiry warning, not a broken connect/setup
//     flow.
export function parseTokenExpiry(message: string): number | null {
  const match = /expires on\s+(.+?)\s*$/.exec(message);
  if (!match) {
    return null;
  }
  // Normalize Java's space-separated, timezone-less format into something
  // Date can parse: "2027-07-26 14:14:52.317" -> "2027-07-26T14:14:52.317".
  const isoish = match[1].replace(" ", "T");
  const ms = new Date(isoish).getTime();
  return Number.isFinite(ms) ? ms : null;
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

  containerInput: [
    { name: "collectionAlias", label: "Collection alias", required: true, placeholder: "my-lab" },
    { name: "authorName", label: "Author name", required: true, placeholder: "Lastname, Firstname" },
    { name: "contactEmail", label: "Contact email", required: true, placeholder: "you@example.edu" },
    { name: "description", label: "Description", required: true, inputType: "textarea" },
    { name: "subject", label: "Subject", required: false, placeholder: "Social Sciences" },
  ],

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

  // Reads the token's expiry from the one endpoint that reports it, GET
  // /api/users/token. Never throws -- a non-200, unexpected body shape, or a
  // message parseTokenExpiry can't parse all just mean "unknown expiry",
  // which callers (connect-provider.ts, setupWarnings below) treat as null,
  // not an error.
  async staticTokenExpiry(auth: ResolvedAuth): Promise<number | null> {
    try {
      const serverUrl = resolveServerUrl(auth);
      const response = await fetch(`${serverUrl}/api/users/token`, {
        method: "GET",
        headers: authHeaders(auth),
      });

      if (response.status !== 200) {
        console.warn(`dataverse staticTokenExpiry: /api/users/token returned ${response.status}`);
        return null;
      }

      const body = (await response.json()) as { data?: { message?: string } };
      const message = body.data?.message;
      if (!message) {
        console.warn("dataverse staticTokenExpiry: unexpected /api/users/token response shape");
        return null;
      }

      return parseTokenExpiry(message);
    } catch (e) {
      console.warn(
        "dataverse staticTokenExpiry: failed to check token expiry:",
        e instanceof Error ? e.message : "Unknown error"
      );
      return null;
    }
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
    //
    // Accept 200 OR 201 via isSuccessStatus. The guides say dataset creation
    // returns 200, but demo.dataverse.org actually returns 201 Created --
    // verified live, 2026-07-26. (The docs are wrong in BOTH directions here:
    // they also claim /add returns 201 when it really returns 200.) Hardcoding
    // 200 made every real dataset creation throw.
    if (!isSuccessStatus(response.status)) {
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

  // Checked at experiment SETUP time (provider-setup-warnings.ts), not on
  // every write -- a one-time, non-blocking advisory so a researcher on an
  // old installation finds out now, rather than discovering months later
  // that every CSV they thought was raw got converted to Dataverse's
  // archival .tab format. Runs the version check and the expiry check
  // independently so BOTH warnings can be returned together (e.g. an old,
  // soon-to-expire installation) -- one check failing/failing-open must
  // never suppress the other's warning.
  async setupWarnings(auth: ResolvedAuth): Promise<string[]> {
    const warnings: string[] = [];

    try {
      const serverUrl = resolveServerUrl(auth);

      // GET /api/info/version is UNAUTHENTICATED on every Dataverse
      // installation -- verified live -- but the key is sent anyway for
      // consistency with every other call this adapter makes; the server
      // just ignores it here.
      const response = await fetch(`${serverUrl}/api/info/version`, {
        method: "GET",
        headers: authHeaders(auth),
      });

      if (response.status !== 200) {
        console.warn(
          `dataverse setupWarnings: /api/info/version returned ${response.status}, failing open (no warning)`
        );
      } else {
        const body = (await response.json()) as { status?: string; data?: { version?: string } };
        const version = body.data?.version;
        if (body.status !== "OK" || !version) {
          console.warn(
            "dataverse setupWarnings: unexpected /api/info/version response shape, failing open (no warning)"
          );
        } else {
          const supported = supportsTabIngest(version);
          if (supported === null) {
            console.warn(
              `dataverse setupWarnings: could not parse version "${version}", failing open (no warning)`
            );
          } else if (!supported) {
            warnings.push(
              `This Dataverse installation reports version ${version}, which predates Dataverse 5.11. ` +
                "Tabular-ingest suppression is unavailable on installations older than 5.11, so CSV files " +
                "uploaded to this dataset will be converted to Dataverse's archival .tab format. JSON data is unaffected."
            );
          }
        }
      }
    } catch (e) {
      // FAIL OPEN, DELIBERATELY. This runs every time a researcher sets up
      // an experiment against this provider, not once -- so a transient
      // network blip (or resolveServerUrl throwing because neither auth nor
      // a container carries a serverUrl) must not cry wolf at every
      // researcher who happens to hit it. The trade-off this accepts: an
      // installation that is genuinely unreachable (down, firewalled,
      // misconfigured URL) gets NO warning either, indistinguishable here
      // from one that's healthy and modern.
      console.warn(
        "dataverse setupWarnings: failed to check installation version, failing open (no warning):",
        e instanceof Error ? e.message : "Unknown error"
      );
    }

    // Expiry is fetched LIVE via staticTokenExpiry rather than read from the
    // stored tokenExpiresAt -- a researcher who recreates their token on the
    // Dataverse installation moves the expiry out by another year, and the
    // stored value (set once, at connect time) would otherwise be stale and
    // pessimistically warn about an expiry that no longer applies.
    // Non-null assertion: staticTokenExpiry is defined a few lines up on this
    // same object literal -- it's only optional in the StorageProvider
    // interface for providers that don't implement it at all.
    const expiresAt = await dataverseProvider.staticTokenExpiry!(auth);
    if (expiresAt !== null) {
      const now = Date.now();
      if (expiresAt < now) {
        warnings.push(
          "The API token for this Dataverse installation has expired and must be recreated and reconnected " +
            "before data can be saved to this experiment."
        );
      } else if (expiresAt - now < TOKEN_EXPIRY_WARNING_MS) {
        const expiryDate = new Date(expiresAt).toISOString().slice(0, 10);
        warnings.push(
          `The API token for this Dataverse installation expires on ${expiryDate}. It must be recreated and ` +
            "reconnected before then, or data can no longer be saved to this experiment. Dataverse does not " +
            "surface this expiry anywhere in its own UI."
        );
      }
    }

    return warnings;
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
