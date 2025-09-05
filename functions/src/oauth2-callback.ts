import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";

const clientId = process.env.NEXT_PUBLIC_CLIENT_ID as string;
const clientSecret = process.env.NEXT_PUBLIC_CLIENT_SECRET as string;
const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI as string;

export const oauth2Callback = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { code, uid } = req.body;
    console.log('Authorization code:', code);

    if (!code) {
      res.status(400).json({ error: 'Authorization code is required' });
      return;
    }

    if (!uid) {
      res.status(400).json({ error: 'User ID is required, are you not authenticated?' });
      return;
    }

    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://accounts.osf.io/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    console.log('Token response status:', tokenResponse.status);
    console.log('Token response headers:', Object.fromEntries(tokenResponse.headers.entries()));

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      res.status(400).json({ 
        error: 'Token exchange failed',
        details: errorData,
        status: tokenResponse.status
      });
      return;
    }

    const tokenData = await tokenResponse.json();

    let x = await db.doc(`users/${uid}`).update({
      refreshToken: tokenData.refresh_token,
      authToken: tokenData.access_token,
      refreshTokenExpires: Date.now() + 2_629_746_000, // 1 month in milliseconds
      authTokenExpires: Date.now() + tokenData.expires_in * 1000
    });

    console.log('User document updated:', x);

    res.status(200).json({
      success: true,
      refreshToken: tokenData.refresh_token,
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in
    });

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});