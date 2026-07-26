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
import { getOAuthConfig, getProvider } from "./providers/index.js";
import { StorageProviderId } from "./providers/types.js";

export type AuthCheckResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

// Rejects request bodies that could turn our authenticated Dataverse client
// into a server-side request forgery (SSRF) primitive: serverUrl is fully
// researcher-supplied, and downloadFile echoes the response body straight
// back to the caller. Left unconstrained, that is a read-with-credentials
// proxy against Google Cloud's metadata service
// (169.254.169.254 / metadata.google.internal) and anything else reachable
// on the private network. This is DEFENSE IN DEPTH, NOT a complete SSRF
// defense -- a public DNS name can still resolve to an internal address
// after this check passes (DNS rebinding) -- so it only closes the cheap,
// obvious cases: non-https schemes, embedded credentials, non-default ports,
// loopback/internal-looking hostnames, and literal IP addresses. Researchers
// only ever connect to named institutional installations
// (dataverse.harvard.edu, demo.dataverse.org), never to a bare IP, so
// rejecting every IPv4/IPv6 literal outright costs nothing real and closes
// the whole class rather than trying to enumerate private ranges.
export function isAllowedServerUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  // Default-port URLs are normalized to "" by the URL parser, so this also
  // accepts an explicit ":443".
  if (url.port !== "" && url.port !== "443") return false;

  // Strip a single trailing dot before any comparison. "…internal." is the
  // explicit-root FQDN form and DNS resolves it identically to "…internal",
  // but it matches neither an equality check nor an endsWith(".internal")
  // one -- so without this, https://metadata.google.internal./ walks straight
  // through every rule below.
  const hostname = url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;
  if (hostname === "localhost") return false;
  if (hostname.endsWith(".localhost")) return false;
  if (hostname.endsWith(".internal")) return false;
  if (hostname === "metadata.google.internal") return false;
  if (hostname.startsWith("[")) return false; // IPv6 literal
  // Reject every IPv4-shaped literal outright, including the
  // octal/decimal-shorthand forms (0177.0.0.1, 2130706433) that a naive
  // dotted-quad check would miss -- rather than trying to enumerate private
  // ranges.
  if (/^\d+(\.\d+)*$/.test(hostname)) return false;
  if (!hostname.includes(".")) return false; // rejects bare single-label internal names

  return true;
}

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

// Separate endpoint from connectProvider rather than a branch inside it: the
// two flows share almost nothing. OAuth needs code+state+CSRF-state
// validation against a third-party redirect; static-token needs a pasted
// token+serverUrl with no redirect at all, so no CSRF state applies here.
// Mixing them would tangle the validation of both.
export const connectStaticTokenProvider = onRequest({ cors: true }, async (req, res) => {
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

    await db.doc(`users/${uid}`).update({
      [`connectedAccounts.${provider}`]: FieldValue.delete(),
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error disconnecting provider:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Failed to disconnect provider' });
  }
});
