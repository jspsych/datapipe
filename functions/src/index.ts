import { setGlobalOptions } from "firebase-functions/v2";

import { apiData } from "./api-data.js";
import { apiCondition } from "./api-condition.js";
import { apiBase64 } from "./api-base64.js";
import { oauth2Callback } from "./oauth2-callback.js";
import { oauth2Regenerate } from "./oauth2-regenerate.js";
import { checkEmailConflict } from "./check-email-conflict.js";
import { scheduledTokenRefresh } from "./scheduled-token-refresh.js";
import { generateOAuthState } from "./generate-oauth-state.js";
import { saveOsfToken } from "./save-osf-token.js";
import { getOsfToken } from "./get-osf-token.js";

setGlobalOptions({
  maxInstances: 20
});

export {
  apiData as apidata,
  apiCondition as apicondition,
  apiBase64 as apibase64,
  oauth2Callback as oauth2callback,
  oauth2Regenerate as oauth2regenerate,
  checkEmailConflict as checkemailconflict,
  scheduledTokenRefresh as scheduledtokenrefresh,
  generateOAuthState as generateoauthstate,
  saveOsfToken as saveosftoken,
  getOsfToken as getosftoken
};
