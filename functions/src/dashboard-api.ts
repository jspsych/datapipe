// ONE deployed Cloud Function fronting 16 low-traffic, bearer-token dashboard
// HTTP endpoints: createExperiment, connectProvider,
// connectStaticTokenProvider, disconnectProvider, deleteAccount,
// generateOAuthState, oauth2Callback, saveOsfToken, getProviderAccessToken,
// providerSetupWarnings, checkEmailConflict, sendContactEmailVerification,
// verifyContactEmail, oauth2Regenerate, getOsfToken, ensureDerivedPaths.
// (ensureDerivedPaths landed on `test` via PR #249 after the other 15 were
// merged, as the same kind of endpoint -- see its own handler for details.)
//
// WHY: `test` used to deploy each of these as its own function. Every one is
// low-traffic -- dashboard clicks, not the submission hot path -- so each
// maintained its OWN always-cold instance pool: nearly every dashboard click
// paid a full container cold start. Merging them into one function lets them
// share warm instances the way a busier function already does on its own.
// Firebase Hosting's rewrites (firebase.json) still route each public path
// (e.g. /api/createexperiment) here unchanged -- only the deployed function
// topology moved, not the wire contract, so no frontend code needed to
// change.
//
// Dispatch is a plain object keyed by req.path -- no express Router, no new
// dependency. A single trailing slash is tolerated (Hosting/clients should
// never send one, but a bare string comparison is cheap insurance against a
// confusing 404 the one time something does). An unmatched path is a 404,
// the same shape a request to a function that doesn't exist gets today.
//
// The verification round trip (plan §2.2, §5 package P3): a resend-capable
// send + a hash-checked verify, both bearer-token endpoints in the same
// shape as deleteAccount / apiQueueStatus. This comment used to live in
// index.ts, next to the two imports it described; it moved here because both
// endpoints now live behind this one dispatcher instead of as independent
// exports.

import { onRequest } from "firebase-functions/v2/https";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";

import { createExperimentHandler } from "./create-experiment.js";
import {
  connectProviderHandler,
  connectStaticTokenProviderHandler,
  disconnectProviderHandler,
} from "./connect-provider.js";
import { deleteAccountHandler } from "./delete-account.js";
import { generateOAuthStateHandler } from "./generate-oauth-state.js";
import { oauth2CallbackHandler } from "./oauth2-callback.js";
import { saveOsfTokenHandler } from "./save-osf-token.js";
import { getOsfTokenHandler } from "./get-osf-token.js";
import { getProviderAccessTokenHandler } from "./get-provider-access-token.js";
import { providerSetupWarningsHandler } from "./provider-setup-warnings.js";
import { checkEmailConflictHandler } from "./check-email-conflict.js";
import { sendContactEmailVerificationHandler } from "./send-contact-email-verification.js";
import { verifyContactEmailHandler } from "./verify-contact-email.js";
import { oauth2RegenerateHandler } from "./oauth2-regenerate.js";
import { ensureDerivedPathsHandler } from "./ensure-derived-paths.js";

type Handler = (req: Request, res: Response) => void | Promise<void>;

// Keyed by the hosting-facing path (firebase.json's rewrite `source` for each
// of these), not the old per-endpoint function name -- the path is the one
// thing a request arriving here actually carries.
const ROUTES: Record<string, Handler> = {
  "/api/createexperiment": createExperimentHandler,
  "/api/connectprovider": connectProviderHandler,
  "/api/connectstatictokenprovider": connectStaticTokenProviderHandler,
  "/api/disconnectprovider": disconnectProviderHandler,
  "/api/deleteaccount": deleteAccountHandler,
  "/api/generateoauthstate": generateOAuthStateHandler,
  "/api/oauth2callback": oauth2CallbackHandler,
  "/api/saveosftoken": saveOsfTokenHandler,
  "/api/getprovideraccesstoken": getProviderAccessTokenHandler,
  "/api/providersetupwarnings": providerSetupWarningsHandler,
  "/api/checkemailconflict": checkEmailConflictHandler,
  "/api/sendcontactemailverification": sendContactEmailVerificationHandler,
  "/api/verifycontactemail": verifyContactEmailHandler,
  "/api/oauth2regenerate": oauth2RegenerateHandler,
  "/api/getosftoken": getOsfTokenHandler,
  "/api/ensurederivedpaths": ensureDerivedPathsHandler,
};

export const dashboardApi = onRequest({ cors: true }, async (req, res) => {
  // Strip exactly one trailing slash, but never touch a bare "/" -- nothing
  // in ROUTES matches that anyway, so it falls through to the 404 below same
  // as any other unmapped path.
  const path =
    req.path.length > 1 && req.path.endsWith("/") ? req.path.slice(0, -1) : req.path;

  const handler = ROUTES[path];
  if (!handler) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await handler(req, res);
});
