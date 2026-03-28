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
    osfFilesLink: string;
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
  }

  export interface OSFFile{
    id: string;
    attributes: {
      name: string;
      kind: string;
    };
    links: {move: string};
  }