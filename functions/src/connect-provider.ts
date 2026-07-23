// Provider connect/disconnect flow (docs/provider-migration-design.md,
// scratchpad/step4b-oauth-connect-spec.md).
//
// This is a storage GRANT flow for already-authenticated users, distinct
// from oauth2-callback.ts's OSF IDENTITY flow (signup/sign-in/account
// linking, Firebase custom tokens). There is no signup path here, ever —
// the caller must already hold a valid Firebase idToken for the uid they
// claim.

import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, auth } from "./app.js";
import { encrypt } from "./crypto-utils.js";
import { getOAuthConfig } from "./providers/oauth-config.js";

type AuthCheckResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

async function verifyOwnership(uid: string, idToken: string | undefined): Promise<AuthCheckResult> {
  if (!idToken) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    if (decodedToken.uid !== uid) {
      return { ok: false, status: 403, error: 'User ID does not match authenticated user' };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 401, error: 'Invalid authentication token' };
  }
}

export const connectProvider = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { provider, code, state, uid, idToken } = req.body || {};

    if (!provider || !code || !state || !uid) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    let config;
    try {
      config = getOAuthConfig(provider);
    } catch {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }

    // Server-side CSRF validation: verify the state was issued by our
    // server. Same oauth_states collection + semantics as the OSF callback
    // (oauth2-callback.ts): exists, not expired, single-use delete.
    const stateRef = db.collection('oauth_states').doc(state);
    const stateDoc = await stateRef.get();
    if (!stateDoc.exists) {
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }
    const stateData = stateDoc.data();
    if (stateData && stateData.expiresAt < Date.now()) {
      await stateRef.delete();
      res.status(400).json({ error: 'State parameter has expired' });
      return;
    }
    // Delete after use — each state token is single-use.
    await stateRef.delete();

    // The state must have been issued for this exact provider (a legacy
    // OSF state, issued with no provider at all, must never be accepted
    // here).
    if (!stateData || stateData.provider !== provider) {
      res.status(400).json({ error: 'State was not issued for this provider' });
      return;
    }

    // Verify that the caller owns the uid they claim. No signup path here.
    const authCheck = await verifyOwnership(uid, idToken);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    // Exchange the authorization code for tokens.
    const params = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    });

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
    } catch (e) {
      console.error('Token exchange network error:', e instanceof Error ? e.message : 'Unknown error');
      res.status(400).json({ error: 'Token exchange failed' });
      return;
    }

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      res.status(400).json({ error: 'Token exchange failed' });
      return;
    }

    const tokenData = await tokenResponse.json();

    // Hard-fail on a missing refresh_token: Google only issues one with
    // access_type=offline&prompt=consent, so its absence means we'd
    // otherwise persist a half-connected account with no way to refresh.
    if (!tokenData.access_token || !tokenData.refresh_token || !tokenData.expires_in) {
      res.status(400).json({ error: 'Token exchange failed' });
      return;
    }

    // Dot-path persist via set()+mergeFields: creates users/{uid} if it
    // doesn't exist yet (a freshly-signed-up user may have no Firestore
    // doc at all), while touching only connectedAccounts.<provider> and
    // leaving any sibling provider connections untouched.
    const fieldPath = `connectedAccounts.${provider}`;
    await db.doc(`users/${uid}`).set(
      {
        connectedAccounts: {
          [provider]: {
            authMethod: 'oauth2',
            encryptedToken: encrypt(tokenData.access_token),
            encryptedRefreshToken: encrypt(tokenData.refresh_token),
            tokenExpiresAt: Date.now() + tokenData.expires_in * 1000,
          },
        },
      },
      { mergeFields: [fieldPath] }
    );

    res.status(200).json({ success: true, provider });
  } catch (error) {
    console.error('Error connecting provider:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Failed to connect provider' });
  }
});

export const disconnectProvider = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { provider, uid, idToken } = req.body || {};

    if (!provider || !uid) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    try {
      getOAuthConfig(provider);
    } catch {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }

    const authCheck = await verifyOwnership(uid, idToken);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    await db.doc(`users/${uid}`).update({
      [`connectedAccounts.${provider}`]: FieldValue.delete(),
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error disconnecting provider:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Failed to disconnect provider' });
  }
});
