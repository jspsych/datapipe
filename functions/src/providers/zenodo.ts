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

// ---------------------------------------------------------------------------
// WHICH ZENODO API THIS TARGETS, AND WHY
//
// Zenodo now runs on InvenioRDM, and BOTH API generations are live -- verified
// 2026-07-27 against zenodo.org and sandbox.zenodo.org:
//   GET /api/deposit/depositions  -> 403 (route exists, requires auth)
//   GET /api/records              -> 200
//
// This adapter targets the LEGACY DEPOSIT API (/api/deposit/depositions) plus
// its "new files API" bucket endpoint, for two reasons:
//
//  1. It is what Zenodo's own current developer documentation describes
//     (developers.zenodo.org). The InvenioRDM-native drafts API is documented
//     upstream at inveniordm.docs.cern.ch, not by Zenodo.
//  2. Cost per session write. A bucket PUT is ONE request per file. The
//     InvenioRDM-native flow is three (POST .../draft/files to initialize the
//     key, PUT .../content, POST .../commit). Against Zenodo's documented
//     100 requests/minute for authenticated users that is the difference
//     between ~100 and ~33 sessions/minute of first-try throughput -- and
//     100/minute is the stated requirement.
//
// The risk this accepts: the legacy API is a compatibility layer over
// InvenioRDM and could eventually be retired. Every HTTP call in this file
// therefore goes through the small helpers below (depositUrl/bucketUrl/
// zenodoFetch) rather than being inlined, so a future move to the native
// drafts API is contained to those helpers plus writeSessionFile/listFiles.
// ---------------------------------------------------------------------------

// The Zenodo container ref shape. `bucketUrl` is handed to us by Zenodo on
// deposition creation and is the target for every file byte that moves --
// storing it avoids re-fetching the deposition before each write, which would
// double the request cost of the whole point of using this API (see above).
export interface ZenodoContainerRef extends ContainerRef {
  provider: "zenodo";
  depositionId: number;
  bucketUrl: string;
  serverUrl: string;
}

// Zenodo is NOT federated -- unlike Dataverse there is exactly one production
// installation plus one sandbox. serverUrl exists only to let researchers (and
// the live spike) point at the sandbox, so it is an ALLOWLIST, not free-form
// input. connect-provider.ts's isAllowedServerUrl already blocks the obvious
// SSRF shapes, but that gate is generic and would happily accept any public
// https host; there is no legitimate third Zenodo, so anything else is
// rejected here rather than trusted.
const ALLOWED_HOSTS = new Set(["zenodo.org", "sandbox.zenodo.org"]);

export function isAllowedZenodoServer(serverUrl: string): boolean {
  try {
    return ALLOWED_HOSTS.has(new URL(serverUrl).hostname);
  } catch {
    return false;
  }
}

// 50 GB, both per file and per record (help.zenodo.org). Descriptive only --
// capabilities are never a correctness gate (see types.ts).
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 * 1024;

function authHeaders(auth: ResolvedAuth): Record<string, string> {
  // Header rather than Zenodo's supported ?access_token= query parameter, so
  // the credential never lands in a URL that could reach a log or an error
  // message.
  return { Authorization: `Bearer ${auth.token}` };
}

// serverUrl can come from the container (a deposition knows which installation
// it lives on) or from auth (the researcher's connection), container winning --
// same precedence as dataverse.ts's resolveServerUrl, for the same reason:
// calls made before a container exists (createDataContainer,
// validateStaticToken) only have auth.
function resolveServerUrl(auth: ResolvedAuth, container?: ContainerRef): string {
  const fromContainer = (container as ZenodoContainerRef | undefined)?.serverUrl;
  const serverUrl = fromContainer ?? auth.serverUrl;
  if (!serverUrl) {
    throw new Error("Zenodo serverUrl is missing from both the container and the resolved auth");
  }
  if (!isAllowedZenodoServer(serverUrl)) {
    throw new Error(`Not a recognized Zenodo installation: ${serverUrl}`);
  }
  return serverUrl;
}

// bucketUrl is a full URL taken from a Zenodo API RESPONSE, and everything
// this adapter uploads and downloads goes to it. Even though it originates
// from an already-allowlisted host, it is re-checked against the container's
// own serverUrl before use: a stored container ref is Firestore data, and this
// keeps a tampered or corrupted providerContainer from redirecting writes (and
// downloadFile's echoed response body) somewhere else entirely.
function resolveBucketUrl(container: ZenodoContainerRef, serverUrl: string): string {
  const { bucketUrl } = container;
  if (!bucketUrl) {
    throw new Error("Zenodo container is missing its bucketUrl");
  }
  let parsed: URL;
  try {
    parsed = new URL(bucketUrl);
  } catch {
    throw new Error(`Zenodo container has a malformed bucketUrl: ${bucketUrl}`);
  }
  if (parsed.origin !== new URL(serverUrl).origin) {
    throw new Error(`Zenodo bucketUrl origin does not match the container's server: ${bucketUrl}`);
  }
  return bucketUrl.replace(/\/+$/, "");
}

// ZENODO'S KEYSPACE IS FLAT. A slash cannot appear in a file key by any route,
// and this was established live rather than assumed (sandbox, 2026-08-11):
//
//   - bucket PUT with literal slashes  -> 404 (URL addresses a path that
//     does not exist)
//   - bucket PUT with the key %2F-encoded -> 404 (the router decodes it back
//     to a slash before matching)
//   - legacy multipart POST with name="data/raw/probe.json" -> 201, but
//     STORED AS "data_raw_probe.json". Zenodo silently rewrites it.
//
// That last one is why the flattening happens here, deliberately, instead of
// being left to the service: a silent server-side rename is exactly the class
// of bug that broke Dataverse's directoryLabel handling, because the collision
// cache matches names EXACTLY and would stop recognising the rehydrated name.
// Flattening to "_" reproduces Zenodo's own rewrite, so the key we ask for is
// the key we get.
//
// DataPipe does produce slashed paths in normal operation -- metadataActive
// experiments upload to data/raw/<name> and data/<base>_data.csv
// (metadata-derived-files.ts) -- so this path is load-bearing, not defensive.
// The Psych-DS directory structure is therefore NOT representable as Zenodo
// file keys; it is preserved inside the compaction archive instead, where the
// paths are ours to choose. See docs/provider-migration-design.md.
//
// Idempotent: names read back from Zenodo never contain slashes, so callers
// that pass an already-stored name (updateFile, downloadFile) are unaffected.
function toZenodoKey(name: string): string {
  return name.replace(/[/\\]+/g, "_");
}

function encodeKey(key: string): string {
  return encodeURIComponent(toZenodoKey(key));
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

interface MappedZenodoError {
  error: ProviderErrorCode;
  providerStatus: number;
  providerMessage: string;
  retryAfter: number | null;
}

// Zenodo error bodies are JSON: {"status": 400, "message": "...", "errors": [...]}.
function mapZenodoError(
  status: number,
  statusText: string,
  body: { message?: string; errors?: { field?: string; message?: string }[] } | undefined,
  retryAfterHeader?: string | null
): MappedZenodoError {
  // Field-level errors carry the useful detail (e.g. which metadata field was
  // rejected); the top-level message is often just "Validation error."
  const fieldDetail = body?.errors
    ?.map((e) => [e.field, e.message].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
  const message = [body?.message ?? statusText, fieldDetail].filter(Boolean).join(" — ");

  let error: ProviderErrorCode;
  if (status === 401) {
    error = "AUTH_EXPIRED";
  } else if (status === 403) {
    // Zenodo returns 403 both for an invalid/revoked token and for a token
    // whose scopes are insufficient (a PAT created without deposit:write).
    // Neither is retryable and both are fixed the same way -- reconnect with a
    // correctly scoped token -- so both map here.
    error = "AUTH_EXPIRED";
  } else if (status === 413 || status === 507) {
    error = "QUOTA_EXCEEDED";
  } else if (status === 400 && /quota|too large|exceed|size limit|max amount/i.test(message)) {
    // Zenodo signals both of its hard caps as a plain 400 with prose, so the
    // status alone cannot distinguish "you are out of room" (terminal, and the
    // trigger for compaction) from "transient server problem" (retry). The
    // literal 100-file-cap message, captured live at file 101 (sandbox,
    // spike gate E, 2026-08-11), is:
    //
    //   "Uploading selected files will result in exceeding the max amount
    //    per record."
    //
    // Note "exceeding", not "exceeds" -- the original pattern matched only the
    // latter and sent this to UNAVAILABLE, which the queue would have retried
    // indefinitely against a record that can never accept another file. Both
    // "exceed" (covering either inflection) and "max amount" are matched now.
    error = "QUOTA_EXCEEDED";
  } else if (status === 429) {
    error = "RATE_LIMITED";
  } else {
    error = "UNAVAILABLE";
  }

  // Only honor a Retry-After that is actually present and numeric. Invenio
  // signals rate limiting primarily through X-RateLimit-Reset (an absolute
  // epoch, not a delay) and Retry-After is not guaranteed -- so an absent or
  // unparseable header yields null and the queue's own exponential backoff
  // takes over, rather than inventing a delay.
  let retryAfter: number | null = null;
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      retryAfter = seconds;
    }
  }

  return { error, providerStatus: status, providerMessage: message, retryAfter };
}

async function mapErrorResponse(response: {
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  headers?: { get: (name: string) => string | null };
}): Promise<MappedZenodoError> {
  let body: { message?: string; errors?: { field?: string; message?: string }[] } | undefined;
  try {
    body = (await response.json()) as { message?: string; errors?: { field?: string; message?: string }[] };
  } catch {
    body = undefined;
  }
  return mapZenodoError(response.status, response.statusText, body, response.headers?.get("retry-after"));
}

interface DepositionResponse {
  id?: number;
  links?: { bucket?: string; html?: string };
}

// Bucket PUT response (Invenio files-REST object shape).
interface BucketPutResponse {
  key?: string;
  size?: number;
  checksum?: string;
  version_id?: string;
}

interface DepositionFileResponse {
  id?: string;
  filename?: string;
  key?: string;
  checksum?: string;
  filesize?: number;
}

export const zenodoProvider: StorageProvider = {
  id: "zenodo",
  authMethod: "static-token",
  capabilities: {
    // Zenodo file keys are a flat namespace -- there is no folder concept in
    // either API generation. The framework's filename-prefix fallback applies.
    nativeSubfolders: false,
    supportsRegion: false,
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    quotaNote:
      "Zenodo allows up to 100 files and 50 GB per record. DataPipe compacts completed sessions into archives to stay under the file limit.",
  },

  containerInput: [
    { name: "creatorName", label: "Creator name", required: true, placeholder: "Lastname, Firstname" },
    { name: "description", label: "Description", required: true, inputType: "textarea" },
    { name: "affiliation", label: "Affiliation", required: false, placeholder: "Your institution" },
  ],

  async resolveToken(userData: UserData, _owner: string): Promise<TokenResult> {
    // _owner is unused: Zenodo is a static-token provider with no refresh token
    // to rotate, so there is no persist-back step (cf. gdrive's resolveToken,
    // which calls refreshGdriveToken(owner, ...)).
    const zenodo = userData.connectedAccounts?.zenodo;

    if (!zenodo) {
      return {
        success: false,
        error: "PROVIDER_NOT_CONNECTED",
        detail: "No connected Zenodo account for this experiment's owner",
      };
    }

    // No expiry branch here, unlike dataverse.ts. Zenodo personal access
    // tokens have no documented expiry and the API exposes no endpoint that
    // reports one, which is also why staticTokenExpiry is deliberately NOT
    // implemented on this provider -- its absence means "this provider cannot
    // report an expiry", which connect-provider.ts already handles by omitting
    // tokenExpiresAt. If a stored tokenExpiresAt ever does appear (e.g. set by
    // a future Zenodo change), it is still honored rather than ignored.
    if (zenodo.tokenExpiresAt && zenodo.tokenExpiresAt < Date.now()) {
      return {
        success: false,
        error: "PROVIDER_TOKEN_EXPIRED",
        detail: "The Zenodo API token for this experiment's owner has expired",
      };
    }

    return { success: true, token: decrypt(zenodo.encryptedToken), serverUrl: zenodo.serverUrl };
  },

  async validateStaticToken(auth: ResolvedAuth): Promise<boolean> {
    const serverUrl = resolveServerUrl(auth);
    // size=1 keeps the response tiny -- this only needs the status code. A
    // token missing the deposit:write scope still 403s here, which is the
    // point: it would fail at the first upload otherwise, months later.
    const response = await fetch(`${serverUrl}/api/deposit/depositions?size=1`, {
      method: "GET",
      headers: authHeaders(auth),
    });
    // Never throw on a non-200 -- a bad or under-scoped token is "not valid",
    // not an exceptional condition.
    return response.status === 200;
  },

  async createDataContainer(auth: ResolvedAuth, researcherInput: Record<string, unknown>): Promise<ContainerRef> {
    const serverUrl = resolveServerUrl(auth);
    const title = researcherInput.title as string;
    const creatorName = researcherInput.creatorName as string;
    const description = researcherInput.description as string;
    const affiliation = researcherInput.affiliation as string | undefined;

    const body = {
      metadata: {
        title,
        // "dataset" rather than the default. Note that upload_type is the
        // LEGACY field name; InvenioRDM's native API calls this resource_type.
        // The legacy deposit API still expects upload_type, so changing this
        // is part of any future move to the native drafts API, not a
        // standalone fix.
        upload_type: "dataset",
        description,
        creators: [
          {
            name: creatorName,
            ...(affiliation ? { affiliation } : {}),
          },
        ],
      },
    };

    const response = await fetch(`${serverUrl}/api/deposit/depositions`, {
      method: "POST",
      headers: {
        ...authHeaders(auth),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // createDataContainer has no error union in the StorageProvider interface
    // (matches osf/gdrive/dataverse) -- signal failure by throwing.
    if (!isSuccessStatus(response.status)) {
      const mapped = await mapErrorResponse(response);
      throw new Error(`Zenodo deposition creation failed: ${mapped.providerStatus} ${mapped.providerMessage}`);
    }

    const responseBody = (await response.json()) as DepositionResponse;
    const depositionId = responseBody.id;
    const bucketUrl = responseBody.links?.bucket;

    // Both are load-bearing for every subsequent write, so a deposition that
    // came back without them is a hard failure now rather than a confusing
    // one at the first participant's submission.
    if (typeof depositionId !== "number" || !bucketUrl) {
      throw new Error("Zenodo deposition creation returned no id or bucket link");
    }

    return { provider: "zenodo", depositionId, bucketUrl, serverUrl };
  },

  async writeSessionFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    filename: string,
    data: string | Buffer,
    meta: FileMeta
  ): Promise<WriteResult> {
    const zenodoContainer = container as ZenodoContainerRef;
    const serverUrl = resolveServerUrl(auth, zenodoContainer);
    const bucket = resolveBucketUrl(zenodoContainer, serverUrl);

    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);

    const response = await fetch(`${bucket}/${encodeKey(filename)}`, {
      method: "PUT",
      headers: {
        ...authHeaders(auth),
        // files-REST takes the raw bytes as the body, not multipart -- this is
        // the whole reason the bucket endpoint costs one request instead of
        // the native API's three.
        //
        // This MUST be application/octet-stream. Sending the real mimetype
        // instead gets a hard 415 "Invalid 'Content-Type' header. Expected one
        // of: application/octet-stream" -- the bucket endpoint accepts exactly
        // that one value. (Live sandbox, spike gate A, 2026-08-11.) Zenodo
        // infers the displayed file type from the key's extension, so nothing
        // is lost by not sending meta.contentType here.
        "Content-Type": "application/octet-stream",
        "Content-Length": String(Buffer.byteLength(body)),
      },
      body,
    });

    if (!isSuccessStatus(response.status)) {
      const mapped = await mapErrorResponse(response);
      return { success: false, ...mapped };
    }

    const responseBody = (await response.json()) as BucketPutResponse;

    // storedFilename comes from the response's `key`, never assumed to equal
    // the requested name -- the same defensive read as dataverse.ts's `label`.
    // It matters more here than it looks: Zenodo flattens slashes out of keys
    // (see toZenodoKey), so the requested name and the stored name genuinely
    // differ for metadataActive experiments, and the collision cache needs the
    // stored one. The fallback is the flattened key rather than the raw
    // `filename` so a response missing `key` still records what Zenodo holds.
    const storedFilename = responseBody.key ?? toZenodoKey(filename);

    return {
      success: true,
      // Every Zenodo file operation this adapter performs addresses the object
      // by KEY (bucket PUT/GET/DELETE), so the key is the durable identifier
      // and `id` carries it rather than the deposition-file UUID. listFiles
      // returns ids the same way, so refs from either source are
      // interchangeable. metadata-block.ts also requires a defined id before
      // it will persist a metadataFileRef, so leaving this unset would make it
      // re-discover the metadata file by listing on every single submission.
      fileRef: { name: storedFilename, id: storedFilename },
      storedFilename,
    };
  },

  // A plain overwriting PUT -- no delete first.
  //
  // This was originally delete-then-PUT, because Zenodo does not document
  // whether a bucket PUT to an existing key replaces it and InvenioRDM's
  // native API requires an explicit delete. Spike gate A settled it live
  // (sandbox, 2026-08-11): re-PUTting an existing key replaced the content in
  // place and left exactly ONE entry in the listing. So this is a single
  // atomic call with no window where the file does not exist -- unlike
  // dataverse.ts and Figshare, which still carry that caveat.
  //
  // Zenodo keeps the file's id stable across the replacement, so no ref
  // rewriting is needed either.
  async updateFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    existingFileRef: FileRef,
    data: string | Buffer,
    meta: FileMeta
  ): Promise<WriteResult> {
    return zenodoProvider.writeSessionFile(auth, container, existingFileRef.name, data, meta);
  },

  async listFiles(auth: ResolvedAuth, container: ContainerRef): Promise<FileRef[]> {
    const zenodoContainer = container as ZenodoContainerRef;
    const serverUrl = resolveServerUrl(auth, zenodoContainer);

    // No pagination loop, unlike dataverse.ts: a Zenodo record holds at most
    // 100 files, and this endpoint returns the deposition's files in one
    // response. If the cap ever rises, this needs revisiting.
    const response = await fetch(`${serverUrl}/api/deposit/depositions/${zenodoContainer.depositionId}/files`, {
      method: "GET",
      headers: authHeaders(auth),
    });

    if (!isSuccessStatus(response.status)) {
      const mapped = await mapErrorResponse(response);
      throw new Error(`Zenodo listing failed: ${mapped.providerStatus} ${mapped.providerMessage}`);
    }

    const body = (await response.json()) as DepositionFileResponse[];

    // The legacy deposition-files endpoint reports the name as `filename`;
    // bucket-shaped responses use `key`. Read both so this keeps working
    // whichever shape the compatibility layer returns, and drop entries with
    // neither rather than emitting a FileRef with an undefined name -- the
    // collision cache matches on exact names, so a bad entry there would let a
    // duplicate through.
    return (body || [])
      .map((file) => file.filename ?? file.key)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      .map((name) => ({ name, id: name }));
  },

  async downloadFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    fileRef: FileRef
  ): Promise<DownloadResult> {
    const zenodoContainer = container as ZenodoContainerRef;
    const serverUrl = resolveServerUrl(auth, zenodoContainer);
    const bucket = resolveBucketUrl(zenodoContainer, serverUrl);

    const response = await fetch(`${bucket}/${encodeKey(fileRef.name)}`, {
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

  // A Zenodo record holds at most 100 files, and the compaction that is meant
  // to keep a study under that cap (batch zips during collection, one merged
  // archive at finalization -- see docs/provider-migration-design.md) is NOT
  // built yet. Until it is, session 101 fails and stays failed: the queue maps
  // Zenodo's refusal to QUOTA_EXCEEDED, which is slow-tier and needs human
  // action to clear. No data is lost -- the submission stays in pending
  // storage and QueuePanel surfaces the reason -- but the researcher cannot
  // fix it, so they need to hear about the limit BEFORE they start collecting
  // rather than after.
  //
  // Unconditional and offline, unlike dataverse.ts's version probe: the cap is
  // a property of Zenodo itself, not of an installation, so there is nothing
  // to interrogate and no failure mode to fail open from.
  //
  // DELETE THIS once compaction ships.
  async setupWarnings(_auth: ResolvedAuth): Promise<string[]> {
    return [
      "Zenodo allows at most 100 files per deposition, and DataPipe does not yet " +
        "combine sessions into archives. Plan for fewer than 100 submissions in this " +
        "experiment: after that, further submissions will fail to upload and will have " +
        "to be recovered by hand.",
    ];
  },
};
