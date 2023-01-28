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
  INVALID_OWNER: {
    error: "INVALID_OWNER",
    message: "The owner ID of this experiment does not match a valid user",
  },
  INVALID_OSF_TOKEN: {
    error: "INVALID_OSF_TOKEN",
    message: "The OSF token for this experiment is not valid",
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
  OSF_FILE_EXISTS: {
    error: "OSF_FILE_EXISTS",
    message: "The OSF file already exists. File names must be unique.",
  },
  OSF_UPLOAD_ERROR: {
    error: "OSF_UPLOAD_ERROR",
    message: "An error occurred while uploading the data to OSF",
  },
  SUCCESS: {
    message: "Success",
  },
};

export default MESSAGES;
