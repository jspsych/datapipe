// Storage-provider abstraction (docs/provider-migration-design.md).
// Nothing imports these types yet except the registry; adapters arrive in
// later build steps, starting with the OSF refactor.

// interfaces.ts imports StorageProviderId/ContainerRef/FileRef/
// CollisionCacheState/ConnectedAccounts FROM this module, so a value import
// of UserData here would create a runtime circular dependency. `import type`
// is erased at compile time and is safe.
import type { UserData } from "../interfaces.js";

export type StorageProviderId = "osf" | "gdrive" | "figshare" | "dataverse" | "zenodo";

export type AuthMethod = "oauth2" | "static-token";

// Generic error taxonomy that every adapter maps its provider's errors into.
// QUOTA_EXCEEDED covers both storage-full and file-too-large.
// CONTENTION: the provider rejected a write because another write to the
// same container was already in flight. Transient and clears in seconds --
// unlike the other codes here, this is never an outage or something a human
// needs to act on -- so the upload queue retries it on a fast tier instead of
// the outage-scale exponential backoff the other codes get. Motivating case:
// Dataverse allows exactly one concurrent write per dataset and rejects every
// other in-flight write with a generic 400 (verified live against
// demo.dataverse.org, 2026-07-26 -- see mapDataverseError in dataverse.ts).
export type ProviderErrorCode =
  | "RATE_LIMITED"
  | "AUTH_EXPIRED"
  | "NAME_CONFLICT"
  | "QUOTA_EXCEEDED"
  | "UNAVAILABLE"
  | "CONTENTION";

// A resolved, decrypted credential handed to adapter calls. serverUrl is only
// present for federated providers (Dataverse).
export interface ResolvedAuth {
  token: string;
  serverUrl?: string;
}

// Result of resolving a user's stored credential into a usable token. The
// success variant carries an optional serverUrl for future federated
// providers (Dataverse) and is structurally assignable to ResolvedAuth above,
// so callers can pass it straight into adapter write-path calls.
export type TokenResult =
  | { success: true; token: string; serverUrl?: string }
  | { success: false; error: string; detail: string };

// Opaque, provider-shaped reference to the container an experiment writes
// into (OSF component, Drive folder, Figshare article, Dataverse dataset).
// Only the owning adapter interprets fields beyond `provider`.
export interface ContainerRef {
  provider: StorageProviderId;
  [key: string]: unknown;
}

export interface FileRef {
  name: string;
  id?: string;
  path?: string;
  rev?: string;
  // Both optional and both best-effort: a provider that does not report them
  // on a given call leaves them undefined, and no caller may treat their
  // absence as an error. Compaction (compaction.ts) uses `size` to bound how
  // many files it pulls into one archive, and `checksum` to verify an uploaded
  // archive landed intact BEFORE it deletes the originals -- so an adapter
  // that omits `checksum` from its write result disables that verification and
  // must not be given a non-null maxFileCount. Format is the provider's own
  // (Zenodo reports "md5:<hex>"); compare like-for-like, never across
  // providers.
  size?: number;
  checksum?: string;
}

export interface FileMeta {
  size: number;
  contentType: string;
}

export type WriteResult =
  | {
      success: true;
      fileRef: FileRef;
      // The filename the provider REPORTS having stored — callers compare it
      // against the requested name to detect silent renames (Dataverse).
      storedFilename: string;
    }
  | {
      success: false;
      error: ProviderErrorCode;
      // Raw provider response, preserved for logs and the retry queue.
      providerStatus: number | null;
      providerMessage: string | null;
      retryAfter?: number | null;
    };

export type DownloadResult =
  | {
      success: true;
      content: string;
    }
  | {
      success: false;
      error: ProviderErrorCode;
      providerStatus: number | null;
      providerMessage: string | null;
    };

export type DeleteResult =
  | { success: true }
  | {
      success: false;
      error: ProviderErrorCode;
      providerStatus: number | null;
      providerMessage: string | null;
    };

// Descriptive (UI hints, subfolder fallback, size-cap warnings) — never a
// correctness gate. Collision detection lives in Firestore, not here.
//
// maxFileCount is the ONE EXCEPTION and is deliberately not descriptive: it is
// what makes an experiment eligible for compaction (compaction.ts), so a
// non-null value here is a contract that this adapter also implements
// deleteFile, downloadFileBytes, and (where its keyspace is flat)
// archivePathFor. Zenodo's hard 100-files-per-record limit is the motivating
// case and the only non-null value today. null means "no known cap": either
// the provider has none (OSF, Drive) or it is per-installation and unreadable
// (Dataverse), and both mean the same thing here — never compact.
export interface ProviderCapabilities {
  nativeSubfolders: boolean;
  supportsRegion: boolean;
  maxFileSizeBytes: number | null;
  maxFileCount: number | null;
  quotaNote: string | null;
}

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  extraAuthParams: Record<string, string>;
}

// Describes one researcher-supplied value createDataContainer needs beyond
// the experiment title (which create-experiment always injects itself).
// This is the SERVER-side source of truth: create-experiment validates a
// createDataContainer request generically against a provider's
// containerInput list, so it never needs to name a specific provider or know
// its researcherInput shape, and adding a new provider never requires
// editing that endpoint.
export interface ContainerInputField {
  name: string;
  label: string;
  required: boolean;
  placeholder?: string;
  // "hidden" means the client supplies this through a bespoke UI (gdrive's
  // Google Picker) rather than a rendered text field.
  inputType?: "text" | "textarea" | "hidden";
}

export interface StorageProvider {
  id: StorageProviderId;
  authMethod: AuthMethod;
  capabilities: ProviderCapabilities;

  // The researcher-supplied fields this provider's createDataContainer needs
  // beyond the experiment title. See ContainerInputField above -- this is
  // the SERVER-side source of truth create-experiment validates against.
  containerInput: ContainerInputField[];

  // Optional because only providers on the generic OAuth2 storage-GRANT flow
  // have one. OSF deliberately does not -- its OAuth is a separate legacy
  // IDENTITY flow (oauth2-callback.ts) with its own env vars -- and that
  // absence is precisely what makes getOAuthConfig reject "osf" without
  // special-casing it.
  oauthConfig?(): OAuthConfig;

  // Decrypts the user's stored credential, checks expiry, and refreshes +
  // persists as needed. Failures come back as a TokenResult rather than
  // throwing.
  resolveToken(userData: UserData, owner: string): Promise<TokenResult>;

  // Optional: opt-in proactive refresh, run by the weekly scheduled pass
  // (scheduled-token-refresh.ts) ahead of expiry. A provider that omits this
  // is simply skipped by that pass. `windowMs` is optional and EACH PROVIDER
  // SUPPLIES ITS OWN DEFAULT -- the two existing windows are not
  // interchangeable and must never be unified: OSF's is 2 weeks, checked
  // against its REFRESH-token expiry (`refreshTokenExpires`), while gdrive's
  // is 10 minutes, checked against its ACCESS-token expiry
  // (`tokenExpiresAt`).
  refreshExpiringTokens?(windowMs?: number): Promise<void>;

  // static-token providers only
  validateStaticToken?(auth: ResolvedAuth): Promise<boolean>;

  // static-token providers only. Returns the credential's absolute expiry as
  // epoch milliseconds, or null when the provider does not report one or it
  // cannot be determined. Never throws -- callers treat null as "unknown"
  // and must not fail on it.
  staticTokenExpiry?(auth: ResolvedAuth): Promise<number | null>;

  // Optional, non-blocking, researcher-facing advisories checked when an
  // experiment is being set up against this provider (see
  // provider-setup-warnings.ts). Returns human-readable strings for the UI
  // to display; an empty array means nothing to report. Never throws -- a
  // provider that cannot determine its answer returns [] rather than
  // failing setup. Motivating case: Dataverse's tabIngest suppression param
  // (writeSessionFile) is silently ignored by installations older than
  // 5.11, so dataverse.ts's implementation warns when it detects one.
  setupWarnings?(auth: ResolvedAuth): Promise<string[]>;

  // One-time setup at experiment creation. researcherInput is provider-shaped
  // (e.g. parent project for Figshare, collection + serverUrl for Dataverse).
  createDataContainer(
    auth: ResolvedAuth,
    researcherInput: Record<string, unknown>
  ): Promise<ContainerRef>;

  writeSessionFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    filename: string,
    data: string | Buffer,
    meta: FileMeta
  ): Promise<WriteResult>;

  // Figshare has no in-place update: its adapter implements this as
  // delete + re-upload, so callers must tolerate a non-atomic window.
  updateFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    existingFileRef: FileRef,
    data: string | Buffer,
    meta: FileMeta
  ): Promise<WriteResult>;

  // Full listing (adapters paginate internally). Used for collision-cache
  // rehydration and dashboard file counts.
  listFiles(auth: ResolvedAuth, container: ContainerRef): Promise<FileRef[]>;

  // Pure, synchronous, deterministic: given the path writeSessionFile will be
  // asked to write, returns the `name` this adapter's own listFiles reports
  // for the resulting file. Omitting it means "identity".
  //
  // THIS IS THE COLLISION CACHE'S IDENTITY FUNCTION, and it exists because
  // the two sides silently disagreed. The cache hashes a name at claim time
  // and rehydrates a cold cache from listFiles, so the two MUST live in the
  // same namespace -- but adapters legitimately transform the requested path:
  // Zenodo flattens slashes into "_". A claim made on the raw leaf name
  // therefore never matched a rehydrated one, and the providers that cannot
  // return NAME_CONFLICT (Zenodo's PUT overwrites in place, Dataverse
  // silently renames) had no backstop to catch what slipped through.
  //
  // Note the symmetry runs BOTH ways: an adapter is free to make its
  // listFiles report the full path instead of implementing this hook, which
  // is what gdrive does. Prefer that where the provider has real folders --
  // an over-claiming storedNameFor is lossy, and on a provider with no
  // NAME_CONFLICT it silently rejects legitimate submissions.
  //
  // Any new adapter whose writeSessionFile does not store the requested path
  // verbatim MUST implement this. See claimNameFor in providers/index.ts.
  storedNameFor?(filename: string): string;

  // storedNameFor's counterpart, used ONLY to lay out a compaction archive:
  // given a name as this adapter's listFiles reports it, return the path the
  // file should occupy inside the zip. Omitting it means "identity", which is
  // correct for every provider with real folders.
  //
  // This is not a general inverse and cannot be one -- storedNameFor is
  // many-to-one (Zenodo maps every run of slashes to a single "_"). It is
  // exact only over the paths DATAPIPE ITSELF writes, which is all it is ever
  // asked about: metadata-derived-files.ts flattens researcher subfolders with
  // "-" (plus a "~<digest>" disambiguator) BEFORE building a path, so a leaf
  // never contains a slash and the only
  // shapes that reach a provider are `data/raw/<leaf>`, `data/<stem>_data.csv`,
  // `dataset_description.json`, and `.psychds-ignore`. Callers pass
  // metadataActive so the reconstruction is skipped entirely for experiments
  // that never produce a slashed path — see archivePathsFor in compaction.ts.
  archivePathFor?(storedName: string): string;

  // Removes a file. Required for any provider with a non-null maxFileCount,
  // since compaction cannot relieve a cap without it; optional otherwise, and
  // absent on providers DataPipe never deletes from. Never throws — failures
  // come back as a DeleteResult, same convention as WriteResult.
  //
  // Callers must treat this as best-effort and idempotent: a file that is
  // already gone is a success, not an error, because the only caller retries
  // after partial failure.
  deleteFile?(
    auth: ResolvedAuth,
    container: ContainerRef,
    fileRef: FileRef
  ): Promise<DeleteResult>;

  // downloadFile's binary-safe sibling, returning raw bytes instead of text.
  // Required for any provider with a non-null maxFileCount.
  //
  // Both exist because neither is right for both callers. metadata-block.ts
  // wants a decoded JSON string, while compaction re-uploads what it reads
  // byte-for-byte and includes files submitted through /api/base64 — images,
  // audio, video. Routing those through downloadFile's response.text() would
  // decode them as UTF-8 and replace every invalid sequence with U+FFFD,
  // silently corrupting the archive DataPipe is about to delete the originals
  // in favor of. Nothing would surface it: the write succeeds and the bytes
  // are simply wrong.
  downloadFileBytes?(
    auth: ResolvedAuth,
    container: ContainerRef,
    fileRef: FileRef
  ): Promise<{ success: true; content: Buffer } | { success: false; error: ProviderErrorCode; providerStatus: number | null; providerMessage: string | null }>;

  // Uploads from a readable stream, for payloads too large to hold in memory.
  // Required for any provider with a non-null maxFileCount.
  //
  // Exists because writeSessionFile takes a Buffer, which caps the largest
  // file an adapter can move at function memory -- fine for a single session,
  // but a finalization archive merges an entire study into ONE file (Psych-DS
  // requires it) and has no such ceiling by design. `size` is required and
  // must be the exact byte length of `body`, not an estimate: Zenodo's bucket
  // PUT needs a real Content-Length header up front, since the request is
  // streamed and there is no buffered body to measure afterward.
  writeStreamedFile?(
    auth: ResolvedAuth,
    container: ContainerRef,
    filename: string,
    body: NodeJS.ReadableStream,
    size: number,
    meta: FileMeta
  ): Promise<WriteResult>;

  // Fetches a file's contents as text. Used by metadata-block.ts to read
  // back an existing dataset_description.json. Never throws — failures come
  // back as a DownloadResult, same shape convention as WriteResult.
  downloadFile(
    auth: ResolvedAuth,
    container: ContainerRef,
    fileRef: FileRef
  ): Promise<DownloadResult>;
}

// users/{uid}.connectedAccounts.* shapes (additive Firestore schema).
export interface OAuth2AccountConnection {
  authMethod: "oauth2";
  encryptedToken: string;
  encryptedRefreshToken: string;
  tokenExpiresAt: number;
  providerAccountId?: string;
}

export interface StaticTokenAccountConnection {
  authMethod: "static-token";
  encryptedToken: string;
  serverUrl: string;
  // Dataverse tokens expire (~yearly); drives the expiry-warning job.
  tokenExpiresAt?: number;
}

export interface ConnectedAccounts {
  gdrive?: OAuth2AccountConnection;
  figshare?: OAuth2AccountConnection;
  dataverse?: StaticTokenAccountConnection;
  // Zenodo was a static-token provider until 2026-08-21 and is now OAuth2.
  // Its tokenExpiresAt is always PRESENT, unlike the personal access tokens
  // this replaced, which never expired at all -- but it is SIXTY DAYS out, not
  // the one hour the upstream source implies (Zenodo overrides oauthlib's
  // default in deployment config; measured by spike gate J, 2026-08-21).
  // The refresh token behind it carries no expiry of its own, so a connection
  // can survive indefinitely -- but only if every rotation is persisted,
  // because Zenodo destroys the previous refresh token on each refresh. See
  // zenodo-oauth.ts.
  zenodo?: OAuth2AccountConnection;
}

// experiments/{id}.collisionCache (additive Firestore schema). The salt is a
// per-experiment nonce retained indefinitely; claims themselves live in a
// subcollection keyed by salted filename hash and expire via TTL.
export interface CollisionCacheState {
  salt: string;
  warmUntil: FirebaseFirestore.Timestamp;
  // Set while a rehydration pass is in flight (leases the rehydration work
  // to one request at a time); cleared on completion or failure.
  rehydratingUntil?: FirebaseFirestore.Timestamp;
}
