const MESSAGES = {
  MISSING_PARAMETER: {
    error: "MISSING_PARAMETER",
    message: "One or more required parameters are missing.",
  },
  DATA_COLLECTION_NOT_ACTIVE: {
    error: "DATA_COLLECTION_NOT_ACTIVE",
    message: "Data collection is not active for this experiment",
  },
  BASE64DATA_COLLECTION_NOT_ACTIVE: {
    error: "BASE64DATA_COLLECTION_NOT_ACTIVE",
    message: "Base64 data collection is not active for this experiment",
  },
  EXPERIMENT_FINALIZED: {
    error: "EXPERIMENT_FINALIZED",
    message: "This experiment has been finalized and no longer accepts submissions",
  },
  CONDITION_ASSIGNMENT_NOT_ACTIVE: {
    error: "CONDITION_ASSIGNMENT_NOT_ACTIVE",
    message: "Condition assignment is not active for this experiment",
  },
  EXPERIMENT_NOT_FOUND: {
    error: "EXPERIMENT_NOT_FOUND",
    message: "The experiment ID does not match an experiment",
  },
  EXPERIMENT_DATA_NOT_FOUND: {
    error: "EXPERIMENT_DATA_NOT_FOUND",
    message: "The experiment data could not be found",
  },
  USER_DATA_NOT_FOUND: {
    error: "USER_DATA_NOT_FOUND",
    message: "The user data could not be found",
  },
  INVALID_OWNER: {
    error: "INVALID_OWNER",
    message: "The owner ID of this experiment does not match a valid user",
  },
  // Keeps its OSF name deliberately, unlike the upload codes below. Only
  // providers/osf.ts mints this one -- every other provider returns
  // INVALID_REFRESH_TOKEN, PROVIDER_NOT_CONNECTED or PROVIDER_TOKEN_EXPIRED
  // -- so it cannot fire on a non-OSF upload, and naming OSF is accurate
  // rather than a leftover.
  INVALID_OSF_TOKEN: {
    error: "INVALID_OSF_TOKEN",
    message: "The OSF token for this experiment is not valid",
  },
  INVALID_REFRESH_TOKEN: {
    error: "INVALID_REFRESH_TOKEN",
    message: "The experiment owner's refresh token is not valid",
  },
  PROVIDER_NOT_CONNECTED: {
    error: "PROVIDER_NOT_CONNECTED",
    message: "The experiment owner has not connected an account for this experiment's storage provider",
  },
  // Names no provider. It once had to cover two static-token adapters, and
  // hardcoding "Dataverse" told a Zenodo owner to go fix a token on a service
  // they may not even use. Zenodo moved to OAuth2 on 2026-08-21 and no longer
  // emits this at all, leaving dataverse.ts as the only source -- but the
  // wording stays provider-neutral, since the next static-token provider would
  // reintroduce exactly the same bug. What it carries is what makes this code
  // distinct from AUTH_EXPIRED: a static token cannot be refreshed, so the
  // researcher has to CREATE a new one and reconnect, not just re-authorize.
  PROVIDER_TOKEN_EXPIRED: {
    error: "PROVIDER_TOKEN_EXPIRED",
    message:
      "The API token for this experiment's storage provider has expired. A new token must be created on that provider and reconnected to DataPipe",
  },
  INVALID_BASE64_DATA: {
    error: "INVALID_BASE64_DATA",
    message: "The data are not valid base64 data",
  },
  INVALID_DATA: {
    error: "INVALID_DATA",
    message:
      "The data are not valid according to the validation parameters set for this experiment.",
  },
  SESSION_LIMIT_REACHED: {
    error: "SESSION_LIMIT_REACHED",
    message: "The session limit for this experiment has been reached",
  },
  UNKNOWN_ERROR_GETTING_CONDITION: {
    error: "UNKNOWN_ERROR_GETTING_CONDITION",
    message:
      "An unknown error occurred while getting the condition for this experiment",
  },
  // api-data.ts and api-base64.ts serve every provider, so none of the three
  // codes below may name one: a Zenodo upload collision was answering with
  // OSF_FILE_EXISTS / "The OSF file already exists". They were renamed from
  // OSF_* on 2026-09-16, which is a BREAKING change to the wire contract --
  // an experiment matching on the old string silently stops matching. See the
  // migration note in pages/docs/api.js. Messages stay provider-neutral
  // rather than naming the actual provider, same reasoning as
  // PROVIDER_TOKEN_EXPIRED above: each string is built once and reused across
  // all of them.
  FILE_EXISTS: {
    error: "FILE_EXISTS",
    message:
      "A file with this name already exists in the storage provider. File names must be unique.",
  },
  UPLOAD_ERROR: {
    error: "UPLOAD_ERROR",
    message: "An error occurred while uploading the data to the storage provider",
  },
  UPLOAD_EXCEPTION: {
    error: "UPLOAD_EXCEPTION",
    message:
      "An unexpected error occurred while uploading the data to the storage provider",
  },
  TOKEN_RESOLUTION_ERROR: {
    error: "TOKEN_RESOLUTION_ERROR",
    message: "Failed to resolve the storage provider's token",
  },
  INVALID_METADATA_ERROR: {
    error: "INVALID_METADATA_ERROR",
    message: "Metadata produced from incoming data is invalid"
  },
  METADATA_ERROR: {
    error: "METADATA_ERROR",
    message: "An error occurred while processing metadata"
  },
  METADATA_NOT_ACTIVE: {
    metadataMessage : "Metadata production is not active for this experiment",
  },
  METADATA_IN_PROVIDER_NOT_IN_FIRESTORE: {
    metadataMessage : "Metadata is in the storage provider but not in Firestore",
  },
  METADATA_IN_FIRESTORE_NOT_IN_PROVIDER: {
    metadataMessage : "Metadata is in Firestore but not in the storage provider",
  },
  METADATA_NOT_IN_FIRESTORE_OR_PROVIDER: {
    metadataMessage : "Metadata is not in Firestore or the storage provider",
  },
  METADATA_IN_PROVIDER_AND_FIRESTORE: {
    metadataMessage : "Metadata is in the storage provider and in Firestore",
  },
  DATA_PERSIST_ERROR: {
    error: "DATA_PERSIST_ERROR",
    message: "Failed to save data. The data was not stored. If this is from a live experiment, participants may need to resubmit.",
  },
  UPLOAD_QUEUED: {
    error: null,
    message: "Data received. The upload will be retried automatically.",
  },
  // The experiment was open and the session was admissible, but the staging
  // tier itself could not be written -- no RTDB instance provisioned, or the
  // service is unreachable. Distinct from every gate above, because the
  // researcher's experiment is fine and the participant should simply fall
  // back to submitting once at the end (which the plugin does automatically).
  SESSION_START_ERROR: {
    error: "SESSION_START_ERROR",
    message:
      "Could not start an incremental upload session. Data can still be submitted at the end of the experiment.",
  },
  SUCCESS: {
    message: "Success",
  }
};

export default MESSAGES;
