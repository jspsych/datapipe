import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";

export const generateOAuthState = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const state = crypto.randomUUID();

    // Store in Firestore with a 10-minute expiry.
    // The callback endpoint will look this up to verify the state
    // was actually issued by our server, then delete it (single-use).
    await db.collection('oauth_states').doc(state).set({
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    res.status(200).json({ state });
  } catch (error) {
    console.error('Error generating OAuth state:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Failed to generate state' });
  }
});
