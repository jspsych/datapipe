import { onRequest } from "firebase-functions/v2/https";
import { db, auth } from "./app.js";
import { decrypt } from "./crypto-utils.js";
import { refreshAndUpdateUser } from "./refresh-token.js";
import { UserData } from "./interfaces.js";

export const getOsfToken = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // Verify Firebase Auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    let uid: string;
    try {
      const idToken = authHeader.split("Bearer ")[1];
      const decodedToken = await auth.verifyIdToken(idToken);
      uid = decodedToken.uid;
    } catch {
      res.status(401).json({ error: "Invalid authentication token" });
      return;
    }

    const userDoc = await db.doc(`users/${uid}`).get();
    if (!userDoc.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const userData = userDoc.data() as UserData;

    if (userData.usingPersonalToken) {
      if (!userData.osfTokenValid) {
        res.status(400).json({ error: "Personal access token is invalid" });
        return;
      }
      res.status(200).json({ token: decrypt(userData.osfToken) });
      return;
    }

    // OAuth flow
    if (Date.now() > userData.authTokenExpires) {
      const refreshResult = await refreshAndUpdateUser(
        uid,
        decrypt(userData.refreshToken)
      );
      if (!refreshResult.success) {
        res.status(400).json({
          error: "Token refresh failed",
          details: refreshResult.error,
        });
        return;
      }
      res.status(200).json({ token: refreshResult.accessToken });
      return;
    }

    res.status(200).json({ token: decrypt(userData.authToken) });
  } catch (error) {
    console.error(
      "Get OSF token error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    res.status(500).json({ error: "Internal server error" });
  }
});
