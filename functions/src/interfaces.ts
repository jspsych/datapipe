import {
    StorageProviderId,
    ContainerRef,
    FileRef,
    CollisionCacheState,
    ConnectedAccounts,
  } from './providers/types';

export interface ExperimentData {
    active: boolean;
    activeBase64: boolean;
    activeConditionAssignment: boolean;
    metadataActive?: boolean;
    limitSessions: boolean;
    sessions: number;
    maxSessions: number;
    useValidation: boolean;
    allowJSON: boolean;
    allowCSV: boolean;
    nConditions: number;
    currentCondition: number;
    requiredFields: string[];
    owner: string;
    osfFilesLink: string;
    // Provider-migration fields (additive; absent = legacy OSF experiment).
    storageProvider?: StorageProviderId;
    providerContainer?: ContainerRef;
    metadataFileRef?: FileRef | null;
    collisionCache?: CollisionCacheState;
    compaction?: CompactionState;
    // Set once, permanently, by finalization.ts (docs/finalization-spec.md).
    // Checked by api-data.ts / api-base64.ts to reject submissions after the
    // fact -- a session landing after this point would sit outside the merged
    // archive and quietly make the record non-Psych-DS again. There is no
    // un-finalize: firestore.rules (Phase 4) is what stops a client from
    // clearing this through the client SDK; the admin-only write path here is
    // the only place it is ever set.
    finalized?: boolean;
    finalizedAt?: FirebaseFirestore.Timestamp;
    // Progress surface for the split apiFinalize/finalizeTask pair
    // (functions/src/api-finalize.ts, Phase 4 of docs/finalization-spec.md).
    // Written by admin-SDK code only -- firestore.rules blocks a client write
    // to this field the same way it blocks `finalized` itself, for the same
    // reason: a researcher forging "finalized" progress here would be
    // indistinguishable, to the dashboard poller, from a real pass.
    finalization?: FinalizationState;
    // First-failure notification state (functions/src/upload-failure-notify.ts).
    // Server-managed: firestore.rules lists `uploadFailure` in
    // serverManagedFieldsUntouched() for the same reason it lists `compaction`
    // and `collisionCache` -- it holds Timestamps that server code calls
    // .toMillis() on, and a client able to clear notifiedAt could make
    // DataPipe mail them once per failed file instead of once per episode.
    uploadFailure?: UploadFailureState;
  }

  // experiments/{id}.uploadFailure. One episode at a time: an episode opens at
  // the first failure DataPipe has actually retried, and closes when the
  // experiment's queue drains (nothing left in pending/processing/failed).
  //
  // Every field is optional because the map is created lazily by the first
  // failure and because a document written before this feature has none of
  // them -- readers must treat "absent" as "disarmed, never notified".
  export interface UploadFailureState {
    // ARMED flag, and the whole point of the feature. Non-null means the
    // researcher has already been told about the CURRENT episode, so further
    // failures only increment the count. Cleared (to null) when the queue
    // drains, which re-arms the next episode.
    //
    // It is also set when no mail was sent -- see suppressedReason -- because
    // suppressing the burst matters as much as suppressing the duplicate mail:
    // one submission can produce twenty queue entries.
    notifiedAt?: FirebaseFirestore.Timestamp | null;
    // Rate-limit floor: the last time mail was ACTUALLY sent. NEVER cleared,
    // including on drain, because it is the backstop against a queue that
    // flaps clear->fail every hour for a week. One mail per experiment per 24
    // hours, maximum.
    lastNotifiedAt?: FirebaseFirestore.Timestamp;
    // Start of the current episode; cleared on drain alongside notifiedAt.
    firstFailureAt?: FirebaseFirestore.Timestamp | null;
    // Files that have failed in the current episode. Reset to 0 on drain.
    failureCount?: number;
    // Why the episode was armed without sending anything. Owner-visible in
    // Firestore, never shown to the researcher.
    suppressedReason?: "no-contact-email" | "rate-limited" | null;
  }

  // experiments/{id}.finalization. `status` starts at "queued" the moment
  // apiFinalize enqueues the Cloud Task and ends at one of
  // FinalizationResult's status values (finalization.ts) once finalizeTask's
  // call to finalizeExperiment returns -- "queued" and "running" are the only
  // two values that do not also appear on FinalizationResult. Kept as a
  // sibling map to `compaction` above (same experiment doc, same
  // Timestamp-and-detail shape) rather than folded into it: compaction is a
  // recurring background pass with no client-visible "in progress" state to
  // poll, while finalization is a one-shot, user-triggered action whose whole
  // point is that the dashboard has something to poll.
  export interface FinalizationState {
    status:
      | "queued"
      | "running"
      | "finalized"
      | "already-finalized"
      | "not-eligible"
      | "leased-elsewhere"
      | "nothing-to-archive"
      | "queued-uploads-pending"
      | "archive-too-large"
      | "failed";
    startedAt?: FirebaseFirestore.Timestamp;
    finishedAt?: FirebaseFirestore.Timestamp;
    // Human-readable detail carried over from FinalizationResult.detail (or,
    // for a status this module produces itself -- "failed" from an uncaught
    // exception -- an equivalent message). Absent on "queued"/"running" and on
    // the plain "finalized" success case, which needs no further explanation.
    detail?: string;
  }

  // experiments/{id}.compaction (additive; absent until the first pass looks
  // at this experiment). Per-batch membership lives in the compactionBatches
  // subcollection rather than here — see functions/src/compaction.ts.
  export interface CompactionState {
    // Held for the duration of a pass so two never overlap; cleared on
    // completion. Same lease shape as CollisionCacheState.rehydratingUntil.
    compactingUntil?: FirebaseFirestore.Timestamp;
    // Set on every pass, including one that found nothing to do.
    lastCheckedAt?: FirebaseFirestore.Timestamp;
    // The experiment's `sessions` value when that pass began. This is the
    // scheduled worker's change trigger: it re-examines an experiment when
    // this no longer matches the live count, instead of polling on a timer.
    sessionsAtLastCheck?: number;
    // How many files the provider held at the end of the last pass.
    // Diagnostic only — nothing branches on it.
    lastFileCount?: number;
    // Set only when files were actually archived.
    lastRunAt?: FirebaseFirestore.Timestamp;
    lastError?: string;
  }

  export interface UserData {
    email: string;
    uid: string;
    osfToken: string;
    osfTokenValid: boolean;
    experiments: string[];
    usingPersonalToken: boolean;
    refreshToken: string;
    refreshTokenExpires: number;
    authToken: string;
    authTokenExpires: number;
    // Provider-migration field (additive; legacy OSF fields above stay as-is).
    connectedAccounts?: ConnectedAccounts;
    // Where DataPipe writes to when a researcher's data stops arriving.
    //
    // Deliberately NOT the same thing as `email` above. `email` is an identity
    // key -- check-email-conflict.ts and oauth2-callback.ts query it for
    // account collisions -- and it is provenance-mixed: "" for ORCID, an
    // OSF-API address or the synthetic `user-{id}@osf.io` fallback for the
    // OSF-era population. Repurposing it would put a researcher-editable value
    // into a collision query. `contactEmail` sits beside it and is the only
    // field the notification path reads.
    //
    // Validation predicates live in functions/src/mail.ts
    // (contactEmailRecipient), mirrored in lib/contact-email.js for the
    // frontend. Both are additive: absent means "no address yet", which is the
    // normal state for an ORCID or OSF-era account until the gate is met.
    contactEmail?: string;
    // Written by the server only. firestore.rules permits a CLIENT write of
    // this field solely in the `false` direction, so saving a new address can
    // reset the flag but no client can self-certify one. Nothing gates on it:
    // notifications go to an unverified address too, because an unverified
    // typo bounces while a withheld address delivers nothing at all.
    contactEmailVerified?: boolean;
    // Epoch ms, written by the client alongside contactEmail.
    contactEmailUpdatedAt?: number;
    // Provenance, diagnostic only. "auth" = copied from the Firebase Auth
    // record's user.email; "user" = typed by the researcher. There is no
    // OSF-derived source: OSF sign-in mints a custom token and never produced
    // an Auth email, so no OSF-supplied address is ever seeded (see the
    // SEEDING RULE in lib/contact-email.js).
    contactEmailSource?: "auth" | "user";
  }
  
  export interface RequestBody {
    experimentID: string;
    data: string; // Consider specifying a more detailed type
    filename: string;
    metadataOptions: object; // Consider specifying a more detailed type
  }

  export interface Variable {
    name: string;
    levels?: string[];
    minValue?: number;
    maxValue?: number;
  }  

  export interface Metadata {
    variableMeasured: Variable[];
  }  
  
  export interface MetadataMessage {
    error?: string;
    message?: string;
    metadataMessage: string;
  }

  export interface MetadataResponse {
    success: boolean;
    error?: string;
    message?: string;
    metadataMessage: string;
  }

  export interface DownloadResponse {
    success: boolean;
    errorCode: number | null;
    errorText: string | null | undefined;
    metadata: Metadata | null;
  }
  
  
  export interface OSFResult {
    success: boolean;
    errorCode: number | null;
    errorText: string | null;
    retryAfter?: number | null;
  }

  export interface QueuedUpload {
    experimentID: string;
    owner: string;
    filename: string;
    storagePath: string;
    dataType: "data" | "base64";
    // Optional — undefined for provider-migrated (e.g. gdrive) queue
    // entries, which carry storageProvider/providerContainer instead.
    osfFilesLink?: string;
    status: "pending" | "processing" | "completed" | "failed";
    errorCode: number;
    retryCount: number;
    maxRetries: number;
    createdAt: FirebaseFirestore.Timestamp;
    lastAttemptAt: FirebaseFirestore.Timestamp | null;
    nextRetryAt: FirebaseFirestore.Timestamp;
    completedAt: FirebaseFirestore.Timestamp | null;
    failureReason: string | null;
    deduplicationKey: string;
    sessionIncremented: boolean;
    // Collision-cache claim owned by this queue entry (additive; absent for
    // entries queued before the collision cache existed — those skip the
    // cache entirely on retry).
    claimToken?: string;
    // Provider-migration fields (additive; absent = legacy OSF queue entry,
    // which falls back to the osfFilesLink-based container above).
    storageProvider?: StorageProviderId;
    providerContainer?: ContainerRef;
  }

  export interface OSFFile{
    id: string;
    attributes: {
      name: string;
      kind: string;
    };
    links: {move: string};
  }