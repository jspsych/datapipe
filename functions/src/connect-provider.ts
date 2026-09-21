// Provider connect/disconnect flow (docs/provider-migration-design.md,
// scratchpad/step4b-oauth-connect-spec.md).
//
// This is a storage GRANT flow for already-authenticated users, distinct
// from oauth2-callback.ts's OSF IDENTITY flow (signup/sign-in/account
// linking, Firebase custom tokens). There is no signup path here, ever —
// the caller must already hold a valid Firebase idToken for the uid they
// claim.

import type { Request } from "firebase-functions/v2/https";
// Aliased: this file also does its own `fetch()` calls to exchange an OAuth
// code, and needs the global fetch Response type (`let tokenResponse:
// Response`) for those -- a bare `Response` import from express would shadow
// it.
import type { Response as ExpressResponse } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { db, auth } from "./app.js";
import { decrypt, encrypt } from "./crypto-utils.js";
import { getOAuthConfig, getProvider } from "./providers/index.js";
import { revokeGdriveToken } from "./providers/gdrive-oauth.js";
import { OAuth2AccountConnection, StorageProviderId } from "./providers/types.js";
import { isAllowedServerUrl } from "./providers/server-url.js";

export type AuthCheckResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

// isAllowedServerUrl now lives in ./providers/server-url.ts, re-exported here
// so every existing caller and test keeps working unchanged -- it moved out
// of this file specifically so dataverse.ts (the adapter that resolves
// serverUrl on every hot-path call, not just at connect time) can import it
// too, without a cycle through providers/index.js -> dataverse.ts ->
// connect-provider.ts. See that module for the allowlist itself and the
// SSRF rationale.
export { isAllowedServerUrl };

export async function verifyOwnership(uid: string, idToken: string | undefined): Promise<AuthCheckResult> {
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

// Plain handler, not an onRequest export -- dispatched from dashboard-api.ts
// along with 14 other low-traffic dashboard endpoints, merged into ONE
// deployed function (dashboardapi) so they share warm instances.
export async function connectProviderHandler(req: Request, res: ExpressResponse): Promise<void> {
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
      // Log WHICH failure this is, not just that one happened. These three
      // look identical to the researcher ("Token exchange failed") and have
      // completely different causes, and a bare error body cost a live
      // debugging cycle on 2026-08-21 working out which one we were seeing:
      //
      //   invalid_client -- OUR misconfiguration. The client id/secret the
      //     function is running with are wrong or absent. Note that a deploy
      //     can look green and still leave these stale: `firebase deploy`
      //     reports "Skipped (No changes detected)" when only .env changed,
      //     so adding a secret and re-running the workflow does NOT
      //     necessarily update the function.
      //   invalid_grant -- the authorization code was rejected: already
      //     spent, or expired. Codes are single-use and short-lived, so a
      //     page reload after a failed attempt produces exactly this.
      //   anything else -- provider-side or a request-shape problem.
      //
      // Whether the credentials are merely PRESENT is logged as a boolean, so
      // a stale/empty deploy is distinguishable from a wrong value without
      // ever putting the credential itself in a log line.
      const kind = errorText.includes('invalid_client')
        ? 'invalid_client (our client credentials are wrong or missing)'
        : errorText.includes('invalid_grant')
          ? 'invalid_grant (the authorization code was already spent or expired)'
          : 'unclassified';
      console.error(
        `Token exchange failed for ${provider}: ${kind}; ` +
          `clientId=${config.clientId ? 'present' : 'MISSING'}, ` +
          `clientSecret=${config.clientSecret ? 'present' : 'MISSING'}, ` +
          `redirectUri=${config.redirectUri || 'MISSING'}; body: ${errorText}`
      );
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
}

// Separate endpoint from connectProvider rather than a branch inside it: the
// two flows share almost nothing. OAuth needs code+state+CSRF-state
// validation against a third-party redirect; static-token needs a pasted
// token+serverUrl with no redirect at all, so no CSRF state applies here.
// Mixing them would tangle the validation of both.
export async function connectStaticTokenProviderHandler(req: Request, res: ExpressResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { provider, uid, idToken, token, serverUrl } = req.body || {};

    if (!provider || !uid || !token) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    let storageProvider;
    try {
      storageProvider = getProvider(provider as StorageProviderId);
    } catch {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }
    // Opaque "Unknown provider" for every rejection here -- registered but
    // wrong auth method looks identical to the caller as genuinely unknown,
    // same convention as getOAuthConfig's callers.
    if (storageProvider.authMethod !== 'static-token' || !storageProvider.validateStaticToken) {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }

    if (typeof serverUrl !== 'string' || !isAllowedServerUrl(serverUrl)) {
      res.status(400).json({ error: 'Invalid server URL' });
      return;
    }
    // Normalize to scheme+host only (no path/query/fragment/trailing slash)
    // so the adapter's `${serverUrl}/api/...` string concatenation can never
    // produce a double slash or inherit a stray path.
    const normalizedServerUrl = new URL(serverUrl).origin;

    // Verify that the caller owns the uid they claim. No signup path here.
    const authCheck = await verifyOwnership(uid, idToken);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    let isValid: boolean;
    try {
      isValid = await storageProvider.validateStaticToken({ token, serverUrl: normalizedServerUrl });
    } catch (e) {
      // A network error against an unreachable/misconfigured installation is
      // "not valid", not a server-side failure.
      console.error('Static token validation error:', e instanceof Error ? e.message : 'Unknown error');
      isValid = false;
    }
    if (!isValid) {
      res.status(400).json({ error: 'Invalid API token' });
      return;
    }

    // Best-effort: if the provider can report its credential's expiry (only
    // Dataverse does today), fetch it now and persist it so resolveToken's
    // PROVIDER_TOKEN_EXPIRED branch -- previously dead, since nothing ever
    // set tokenExpiresAt -- actually has data to act on. A failure or an
    // unknown (null) expiry here MUST NOT fail the connect: the token was
    // already validated above, and "we don't know when this expires" is not
    // an error, just the same omitted-field state the endpoint always had.
    let tokenExpiresAt: number | null = null;
    if (storageProvider.staticTokenExpiry) {
      try {
        tokenExpiresAt = await storageProvider.staticTokenExpiry({ token, serverUrl: normalizedServerUrl });
      } catch (e) {
        console.error(
          'Static token expiry check error:',
          e instanceof Error ? e.message : 'Unknown error'
        );
        tokenExpiresAt = null;
      }
    }

    // Same dot-path persist convention as connectProvider: set()+mergeFields
    // creates users/{uid} if absent and leaves sibling provider connections
    // untouched. tokenExpiresAt is included only when it resolved to a
    // number -- Firestore rejects undefined, and resolveToken already treats
    // a missing tokenExpiresAt as "no known expiry", so omitting it entirely
    // when unknown is correct, not a gap.
    const fieldPath = `connectedAccounts.${provider}`;
    await db.doc(`users/${uid}`).set(
      {
        connectedAccounts: {
          [provider]: {
            authMethod: 'static-token',
            encryptedToken: encrypt(token),
            serverUrl: normalizedServerUrl,
            ...(tokenExpiresAt !== null ? { tokenExpiresAt } : {}),
          },
        },
      },
      { mergeFields: [fieldPath] }
    );

    res.status(200).json({ success: true, provider });
  } catch (error) {
    console.error('Error connecting static-token provider:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Failed to connect provider' });
  }
}

export async function disconnectProviderHandler(req: Request, res: ExpressResponse): Promise<void> {
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

    // Accept any REGISTERED provider except osf: osf's identity flow
    // (oauth2-callback.ts) is a separate legacy path not managed here.
    // Everything else -- oauth2 (gdrive) or static-token (dataverse) -- can
    // be disconnected the same way, since disconnect is just deleting the
    // stored connection, regardless of how it was established.
    let storageProvider;
    try {
      storageProvider = getProvider(provider as StorageProviderId);
    } catch {
      storageProvider = undefined;
    }
    if (!storageProvider || storageProvider.id === 'osf') {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }

    const authCheck = await verifyOwnership(uid, idToken);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    // gdrive is the only provider with a real revocation endpoint today --
    // Dataverse tokens are institution-issued personal access tokens with no
    // documented revoke call, and Zenodo (see zenodo-oauth.ts) has none
    // either, so both keep the old delete-only behavior unchanged.
    //
    // Revocation is best-effort: it must never fail this request, and the
    // stored copy is deleted regardless of whether Google's revoke call
    // succeeded (a failed revoke still means DataPipe no longer holds a
    // token, which is the property that matters most). `revoked` is surfaced
    // in the response so a future UI can tell the difference, but nothing
    // today reads it as an error signal.
    let revoked: boolean | undefined;
    if (provider === 'gdrive') {
      revoked = false;
      try {
        const userSnap = await db.doc(`users/${uid}`).get();
        const gdriveConnection = userSnap.data()?.connectedAccounts?.gdrive as
          | OAuth2AccountConnection
          | undefined;
        if (gdriveConnection?.encryptedRefreshToken) {
          const refreshToken = decrypt(gdriveConnection.encryptedRefreshToken);
          const result = await revokeGdriveToken(refreshToken);
          revoked = result.ok;
        }
      } catch (e) {
        console.warn(
          'disconnectProvider: failed to read/decrypt gdrive connection for revocation:',
          e instanceof Error ? e.message : 'Unknown error'
        );
      }
    }

    try {
      await db.doc(`users/${uid}`).update({
        [`connectedAccounts.${provider}`]: FieldValue.delete(),
      });
    } catch (e) {
      // NOT_FOUND: the user document doesn't exist at all (e.g. it was
      // already purged, or never fully created). There is nothing left to
      // disconnect, which is the same end state this call is trying to
      // reach, so treat it as success rather than a 500.
      if ((e as { code?: number }).code !== 5) {
        throw e;
      }
    }

    const responseBody: Record<string, unknown> = { success: true };
    if (provider === 'gdrive') {
      responseBody.revoked = revoked;
    }
    res.status(200).json(responseBody);
  } catch (error) {
    console.error('Error disconnecting provider:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Failed to disconnect provider' });
  }
}
