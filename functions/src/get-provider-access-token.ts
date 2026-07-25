// Short-lived provider access token for client-side Google Picker use
// (docs/provider-migration-design.md). The Picker's folder-choosing UI
// (a later, front-end build step) needs a raw Drive access token in the
// browser, but decrypting/refreshing that token is server-only work that
// only resolve-token.ts can do -- this endpoint is the one place that
// hands a decrypted token back to an authenticated caller.
//
// Auth + request shape mirrors connect-provider.ts's storage-grant flow
// (POST only, { provider, uid, idToken } body, verifyOwnership for
// 401/403). Token resolution mirrors create-experiment.ts's use of
// resolve-token.ts, including its MESSAGES mapping on failure.

import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";
import { verifyOwnership } from "./connect-provider.js";
import resolveToken from "./resolve-token.js";
import { getOAuthConfig } from "./providers/oauth-config.js";
import { StorageProviderId } from "./providers/types.js";
import { ExperimentData, UserData } from "./interfaces.js";
import MESSAGES from "./api-messages.js";

export const getProviderAccessToken = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const {
      provider,
      uid,
      idToken,
    }: { provider?: string; uid?: string; idToken?: string } = req.body || {};

    if (!provider || !uid) {
      res.status(400).json({ error: "Missing required parameters" });
      return;
    }

    // getOAuthConfig only has an entry for OAuth2 providers (gdrive today).
    // OSF deliberately has no entry -- its identity flow is a separate,
    // legacy path (oauth2-callback.ts) -- so this single check rejects both
    // "osf" and any unregistered/unknown provider, same as connect-provider.ts.
    try {
      getOAuthConfig(provider);
    } catch {
      res.status(400).json({ error: "Unknown provider" });
      return;
    }

    // Verify the caller owns the uid they claim -- same shape as
    // connect-provider.ts's storage-grant flow (401 missing/invalid token,
    // 403 uid mismatch). No signup path here, ever.
    const authCheck = await verifyOwnership(uid, idToken);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    const userDoc = await db.doc(`users/${uid}`).get();
    // A freshly-signed-up user may have no Firestore doc yet -- treat that
    // the same as "no connected accounts" rather than throwing, so
    // PROVIDER_NOT_CONNECTED applies uniformly (same as create-experiment.ts).
    const userData: UserData = (userDoc.data() as UserData) || ({} as UserData);

    const tokenResult = await resolveToken(userData, {
      storageProvider: provider as StorageProviderId,
      owner: uid,
    } as ExperimentData);

    if (!tokenResult.success) {
      const errorMessage =
        MESSAGES[tokenResult.error as keyof typeof MESSAGES] || MESSAGES.TOKEN_RESOLUTION_ERROR;
      res.status(400).json(errorMessage);
      return;
    }

    // Only the access token -- never the refresh token or any other user
    // data. resolve-token.ts's TokenResult carries no expiry to surface
    // alongside it.
    res.status(200).json({ accessToken: tokenResult.token });
  } catch (error) {
    console.error(
      "Error getting provider access token:",
      error instanceof Error ? error.message : "Unknown error"
    );
    res.status(500).json({ error: "Failed to get provider access token" });
  }
});
