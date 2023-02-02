import { apiData } from "./api-data.js";
import { apiCondition } from "./api-condition.js";
import { apiBase64 } from "./api-base64.js";
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({
  maxInstances: 20
});

export { apiData as apidata, apiCondition as apicondition, apiBase64 as apibase64 };
