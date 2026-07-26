// Storage-provider abstraction (docs/provider-migration-design.md).
// Nothing imports these types yet except the registry; adapters arrive in
// later build steps, starting with the OSF refactor.

// interfaces.ts imports StorageProviderId/ContainerRef/FileRef/
// CollisionCacheState/ConnectedAccounts FROM this module, so a value import
// of UserData here would create a runtime circular dependency. `import type`
// is erased at compile time and is safe.
import type { UserData } from "../interfaces.js";

export type StorageProviderId = "osf" | "gdrive" | "figshare" | "dataverse";

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

// Descriptive (UI hints, subfolder fallback, size-cap warnings) — never a
// correctness gate. Collision detection lives in Firestore, not here.
export interface ProviderCapabilities {
  nativeSubfolders: boolean;
  supportsRegion: boolean;
  maxFileSizeBytes: number | null;
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
