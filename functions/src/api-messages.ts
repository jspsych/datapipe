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
  INVALID_OSF_TOKEN: {
    error: "INVALID_OSF_TOKEN",
    message: "The OSF token for this experiment is not valid",
  },
  INVALID_REFRESH_TOKEN: {
    error: "INVALID_REFRESH_TOKEN",
    message: "The experiment owner's refresh token is not valid",
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
  NOT_USING_OAUTH: {
    error: "NOT_USING_OAUTH",
    message:
      "The user is not using OAuth for OSF API verification"
  },
  OAUTH_NOT_SETUP: {
    error: "OAUTH_NOT_SETUP",
    message: "OAuth is not set up for this user"
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
  OSF_FILE_EXISTS: {
    error: "OSF_FILE_EXISTS",
    message: "The OSF file already exists. File names must be unique.",
  },
  OSF_UPLOAD_ERROR: {
    error: "OSF_UPLOAD_ERROR",
    message: "An error occurred while uploading the data to OSF",
  },
  INVALD_METADATA_ERROR: {
    error: "INVALD_METADATA_ERROR",
    message: "Metadata produced from incoming data is invalid"
  },
  OSF_METADATA_UPLOAD_ERROR: {
    error: "OSF_METADATA_UPLOAD_ERROR",
    message: "An error occured while uploading metadata to OSF"
  },
  METADATA_ERROR: {
    error: "METADATA_ERROR",
    message: "An error occurred while processing metadata"
  },
  METADATA_NOT_ACTIVE: {
    metadataMessage : "Metadata production is not active for this experiment",
  },
  METADATA_IN_OSF_NOT_IN_FIRESTORE: {
    metadataMessage : "Metadata is in OSF but not in Firestore",
  },
  METADATA_IN_FIRESTORE_NOT_IN_OSF: {
    metadataMessage : "Metadata is in Firestore but not in OSF",
  },
  METADATA_NOT_IN_FIRESTORE_OR_OSF: {
    metadataMessage : "Metadata is not in Firestore or OSF",
  },
  METADATA_IN_OSF_AND_FIRESTORE: {
    metadataMessage : "Metadata is in OSF and in Firestore",
  },
  SUCCESS: {
    message: "Success",
  }
};

export default MESSAGES;
