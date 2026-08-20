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