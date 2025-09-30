import { setGlobalOptions } from "firebase-functions/v2";

import { apiData } from "./api-data.js";
import { apiCondition } from "./api-condition.js";
import { apiBase64 } from "./api-base64.js";
import { oauth2Callback } from "./oauth2-callback.js";
import { oauth2Regenerate } from "./oauth2-regenerate.js";
import { checkEmailConflict } from "./check-email-conflict.js";

setGlobalOptions({
  maxInstances: 20
});

export { 
  apiData as apidata, 
  apiCondition as apicondition, 
  apiBase64 as apibase64, 
  oauth2Callback as oauth2callback,
  oauth2Regenerate as oauth2regenerate,
  checkEmailConflict as checkemailconflict
};
