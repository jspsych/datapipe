import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { db, auth } from "./app.js";
import MESSAGES from "./api-messages.js";
import { refreshAndUpdateUser } from "./refresh-token.js";
import { decrypt } from "./crypto-utils.js";
import { UserData } from "./interfaces.js";

// Plain handler, not an onRequest export -- dispatched from dashboard-api.ts
// along with 14 other low-traffic dashboard endpoints, merged into ONE
// deployed function (dashboardapi) so they share warm instances.
//
// NOT converted to use require-user.ts's shared helper: this endpoint reads
// `uid` from the request BODY first and compares it against the decoded
// token (verifyOwnership's shape, just header-transported instead of
// body-transported), which is a different contract from requireUser's
// token-is-the-only-identity check -- forcing it through that helper would
// change the 403 case.
export async function oauth2RegenerateHandler(req: Request, res: Response): Promise<void> {
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

    // Verify Firebase Auth token to ensure the caller is the actual user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const idToken = authHeader.split('Bearer ')[1];
      const decodedToken = await auth.verifyIdToken(idToken);
      if (decodedToken.uid !== uid) {
        res.status(403).json({ error: 'User ID does not match authenticated user' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Invalid authentication token' });
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

  const refreshResult = await refreshAndUpdateUser(uid, decrypt(user_data.refreshToken));

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
    console.error('OAuth regenerate error:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({
      error: 'Internal server error'
    });
  }
}