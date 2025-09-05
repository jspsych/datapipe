import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";
import MESSAGES from "./api-messages.js";
import { UserData } from "./interfaces.js";

const clientId = process.env.NEXT_PUBLIC_CLIENT_ID as string;
const clientSecret = process.env.NEXT_PUBLIC_CLIENT_SECRET as string;

export const oauth2Regenerate = onRequest({ cors: true }, async (req, res) => {
try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { uid } = req.body;

    if (!uid) {
      res.status(400).json({ error: 'User ID is required, are you not authenticated?' });
      return;
    }

  const user_doc = await db.doc(`users/${uid}`).get();
  if (!user_doc.exists) {
    res.status(400).json(MESSAGES.INVALID_OWNER);
    return;
  }

  const user_data: UserData = user_doc.data() as UserData;

  if (!user_data) {
    res.status(400).json(MESSAGES.USER_DATA_NOT_FOUND);
    return;
  }

  if (user_data.usingPersonalToken) {
    res.status(400).json(MESSAGES.NOT_USING_OAUTH);
    return;
  }

  if (!user_data.refreshToken) {
    res.status(400).json(MESSAGES.OAUTH_NOT_SETUP);
    return;
  }

  const code = user_data.refreshToken;

  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
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
    authToken: tokenData.access_token,
    authTokenExpires: Date.now() + tokenData.expires_in * 1000
  });

  console.log('User document updated:', x);

  res.status(200).json({
    success: true,
    accessToken: tokenData.access_token
  });

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});