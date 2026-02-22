import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";
import MESSAGES from "./api-messages.js";
import { refreshAndUpdateUser } from "./refresh-token.js";
import { UserData } from "./interfaces.js";

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

  const refreshResult = await refreshAndUpdateUser(uid, user_data.refreshToken);

  if (!refreshResult.success) {
    res.status(400).json({
      error: 'Token exchange failed',
      details: refreshResult.error,
    });
    return;
  }

  res.status(200).json({
    success: true,
    accessToken: refreshResult.accessToken,
  });

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});