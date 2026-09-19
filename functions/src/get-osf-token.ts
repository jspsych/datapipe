import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { db } from "./app.js";
import { decrypt } from "./crypto-utils.js";
import { refreshAndUpdateUser } from "./refresh-token.js";
import { UserData } from "./interfaces.js";
import { requireUser } from "./require-user.js";

// Plain handler, not an onRequest export -- dispatched from dashboard-api.ts
// along with 14 other low-traffic dashboard endpoints, merged into ONE
// deployed function (dashboardapi) so they share warm instances.
export async function getOsfTokenHandler(req: Request, res: Response): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // Verify Firebase Auth token
    const authResult = await requireUser(req, res);
    if (!authResult) return;
    const { uid } = authResult;

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
}
