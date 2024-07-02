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
  } 
  
  export interface RequestBody {
    experimentID: string;
    data: any; // Consider specifying a more detailed type
    filename: string;
    metadataOptions: any; // Consider specifying a more detailed type
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
  }

  export interface RequestBody {
    experimentID: string;
    data: any; // Consider specifying a more detailed type
    filename: string;
    metadataOptions: any; // Consider specifying a more detailed type
  }

  export interface OSFFile{
    id: string;
    attributes: {
      name: string;
      kind: string;
    };
    links: {move: string};
  }