import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { db } from "./app.js";
import { encrypt } from "./crypto-utils.js";
import { requireUser } from "./require-user.js";

// Plain handler, not an onRequest export -- dispatched from dashboard-api.ts
// along with 14 other low-traffic dashboard endpoints, merged into ONE
// deployed function (dashboardapi) so they share warm instances.
export async function saveOsfTokenHandler(req: Request, res: Response): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { token } = req.body;

    if (token === undefined || token === null) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    // Verify Firebase Auth token
    const authResult = await requireUser(req, res);
    if (!authResult) return;
    const { uid } = authResult;

    // Validate the token against OSF API
    let osfTokenValid = false;
    if (token) {
      try {
        const osfResponse = await fetch(
          `https://api.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/v2/`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        osfTokenValid = osfResponse.status === 200;
      } catch {
        osfTokenValid = false;
      }
    }

    // Encrypt and save
    await db.doc(`users/${uid}`).update({
      osfToken: encrypt(token),
      osfTokenValid,
    });

    res.status(200).json({ success: true, osfTokenValid });
  } catch (error) {
    console.error(
      "Save OSF token error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    res.status(500).json({ error: "Internal server error" });
  }
}
