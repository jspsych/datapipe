import { setGlobalOptions } from "firebase-functions/v2";

import { apiData } from "./api-data.js";
// POST /api/session -- admits a participant to the RTDB staging tier
// (docs/streaming-ingest-design.md). Replaces the design's openExperiments
// mirror: the four submission gates run here, against Firestore, and only an
// unforgeable server-minted session id reaches RTDB.
import { apiSessionStart } from "./api-session-start.js";
import { apiCondition } from "./api-condition.js";
import { apiBase64 } from "./api-base64.js";
import { scheduledTokenRefresh } from "./scheduled-token-refresh.js";
import { scheduledUploadRetry } from "./scheduled-upload-retry.js";
import { scheduledPendingRecovery } from "./scheduled-pending-recovery.js";
// Recovers sessions that were staged but never completed. ONE invocation per
// sweep, not per session -- a trigger on the staging tier's TRIAL writes would
// silently reinstate the per-trial invocation this whole design exists to
// avoid.
import { scheduledStagingSweep } from "./scheduled-staging-sweep.js";
// The one exception, and it is not per trial: scoped to the per-connection
// disconnect/reconnect slots, which the rules cap at 40 writes per session.
// Keeps the researcher's live-sessions dashboard current. See its header.
import { onStagingDisconnect } from "./staging-disconnect-trigger.js";
import { onExperimentGrew, onUploadQueueChanged } from "./compaction-triggers.js";
// A SECOND trigger on uploadQueue/{docId}, deliberately not folded into
// onUploadQueueChanged above -- see the header of upload-failure-notify.ts.
import { onUploadFailure } from "./upload-failure-notify.js";
// Delivery for the `mail` collection. Replaces the deprecated Firebase
// "Trigger Email" extension with a direct Resend send (Amazon SES until AWS
// denied production access); mail.ts's document contract is unchanged through
// both swaps, so nothing on the write side moved.
import { onMailCreated } from "./mail-delivery.js";
// Re-drives mail whose failure has since stopped being true (a quota that has
// rolled over, a blip that has passed). onMailCreated cannot: an
// onDocumentCreated trigger does not re-fire on updates, so before this existed
// a `retryable` ERROR was retried by nobody.
import { scheduledMailRetry } from "./scheduled-mail-retry.js";
import { apiQueueStatus } from "./api-queue-status.js";
import { onUserDeleted } from "./on-user-deleted.js";
import { apiFinalize, finalizeTask } from "./api-finalize.js";
// createexperiment, connectprovider, connectstatictokenprovider,
// disconnectprovider, deleteaccount, generateoauthstate, oauth2callback,
// saveosftoken, getprovideraccesstoken, providersetupwarnings,
// checkemailconflict, sendcontactemailverification, verifycontactemail, and
// ensurederivedpaths used to each be their own onRequest export here. All 14 are low-traffic dashboard endpoints, not
// the submission hot path, so each paid its own always-cold instance pool for
// no benefit -- they are now dispatched from ONE function. See
// dashboard-api.ts's header for the full rationale.
import { dashboardApi } from "./dashboard-api.js";

setGlobalOptions({
  maxInstances: 20
});

export {
  apiData as apidata,
  apiSessionStart as apisessionstart,
  apiCondition as apicondition,
  apiBase64 as apibase64,
  scheduledTokenRefresh as scheduledtokenrefresh,
  scheduledUploadRetry as scheduleduploadretry,
  scheduledPendingRecovery as scheduledpendingrecovery,
  scheduledStagingSweep as scheduledstagingsweep,
  onStagingDisconnect as onstagingdisconnect,
  onExperimentGrew as onexperimentgrew,
  onUploadQueueChanged as onuploadqueuechanged,
  onUploadFailure as onuploadfailure,
  onMailCreated as onmailcreated,
  scheduledMailRetry as scheduledmailretry,
  apiQueueStatus as apiqueuestatus,
  onUserDeleted as onuserdeleted,
  apiFinalize as apifinalize,
  finalizeTask as finalizetask,
  dashboardApi as dashboardapi
};
