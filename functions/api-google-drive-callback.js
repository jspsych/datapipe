import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";
import { exchangeCodeForTokens } from "./google-drive-auth.js";

export const apiGoogleDriveCallback = onRequest(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
    return;
  }

  // Set CORS headers for actual request
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code, state } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: "Authorization code is required" });
  }

  try {
    // Exchange the authorization code for tokens
    const tokens = await exchangeCodeForTokens(code);
    
    // The state parameter should contain the user ID
    if (!state) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const userId = state;
    
    // Store the tokens in the user's document using Firebase Admin
    const userDoc = db.doc(`users/${userId}`);
    await userDoc.set({
      uid: userId, // Add the uid field to satisfy security rules
      googleDriveRefreshToken: tokens.refresh_token,
      googleDriveAccessToken: tokens.access_token,
      googleDriveTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
    }, { merge: true });

    // Redirect to a success page or back to the account settings
    res.redirect("/admin/account?googleDriveSuccess=true");
  } catch (error) {
    console.error("Google Drive OAuth error:", error);
    res.redirect("/admin/account?googleDriveError=true");
  }
});
