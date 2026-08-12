import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";
import { getOAuthConfig } from "./providers/index.js";

export const generateOAuthState = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Optional `provider` in the body. Absent → exactly today's legacy
    // behavior (the OSF flow keeps working byte-identically): a bare
    // { state } response and a state doc with no provider field.
    const { provider } = req.body || {};

    const state = crypto.randomUUID();
    const stateData: Record<string, unknown> = {
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
    };

    let authorizeUrl: string | undefined;

    if (provider) {
      let config;
      try {
        config = getOAuthConfig(provider);
      } catch {
        res.status(400).json({ error: 'Unknown provider' });
        return;
      }

      stateData.provider = provider;

      const url = new URL(config.authorizeUrl);
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', config.scope);
      url.searchParams.set('state', state);
      for (const [key, value] of Object.entries(config.extraAuthParams)) {
        url.searchParams.set(key, value);
      }
      authorizeUrl = url.toString();
    }

    // Store in Firestore with a 10-minute expiry.
    // The callback endpoint will look this up to verify the state
    // was actually issued by our server, then delete it (single-use).
    await db.collection('oauth_states').doc(state).set(stateData);

    const response: Record<string, unknown> = { state };
    if (authorizeUrl) {
      response.authorizeUrl = authorizeUrl;
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Error generating OAuth state:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Failed to generate state' });
  }
});
