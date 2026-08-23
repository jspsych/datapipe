import { setGlobalOptions } from "firebase-functions/v2";

import { apiData } from "./api-data.js";
import { apiCondition } from "./api-condition.js";
import { apiBase64 } from "./api-base64.js";
import { oauth2Callback } from "./oauth2-callback.js";
import { oauth2Regenerate } from "./oauth2-regenerate.js";
import { checkEmailConflict } from "./check-email-conflict.js";
import { scheduledTokenRefresh } from "./scheduled-token-refresh.js";
import { scheduledUploadRetry } from "./scheduled-upload-retry.js";
import { scheduledPendingRecovery } from "./scheduled-pending-recovery.js";
import { onExperimentGrew, onUploadQueueChanged } from "./compaction-triggers.js";
// A SECOND trigger on uploadQueue/{docId}, deliberately not folded into
// onUploadQueueChanged above -- see the header of upload-failure-notify.ts.
import { onUploadFailure } from "./upload-failure-notify.js";
import { apiQueueStatus } from "./api-queue-status.js";
import { generateOAuthState } from "./generate-oauth-state.js";
import { connectProvider, connectStaticTokenProvider, disconnectProvider } from "./connect-provider.js";
import { saveOsfToken } from "./save-osf-token.js";
import { getOsfToken } from "./get-osf-token.js";
import { onUserDeleted } from "./on-user-deleted.js";
import { deleteAccount } from "./delete-account.js";
import { createExperiment } from "./create-experiment.js";
import { getProviderAccessToken } from "./get-provider-access-token.js";
import { providerSetupWarnings } from "./provider-setup-warnings.js";
import { apiFinalize, finalizeTask } from "./api-finalize.js";

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
  scheduledUploadRetry as scheduleduploadretry,
  scheduledPendingRecovery as scheduledpendingrecovery,
  onExperimentGrew as onexperimentgrew,
  onUploadQueueChanged as onuploadqueuechanged,
  onUploadFailure as onuploadfailure,
  apiQueueStatus as apiqueuestatus,
  generateOAuthState as generateoauthstate,
  connectProvider as connectprovider,
  connectStaticTokenProvider as connectstatictokenprovider,
  disconnectProvider as disconnectprovider,
  saveOsfToken as saveosftoken,
  getOsfToken as getosftoken,
  onUserDeleted as onuserdeleted,
  deleteAccount as deleteaccount,
  createExperiment as createexperiment,
  getProviderAccessToken as getprovideraccesstoken,
  providerSetupWarnings as providersetupwarnings,
  apiFinalize as apifinalize,
  finalizeTask as finalizetask
};
