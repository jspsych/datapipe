import { onRequest } from "firebase-functions/v2/https";
import { db, auth } from "./app.js";
import { encrypt } from "./crypto-utils.js";

export const saveOsfToken = onRequest({ cors: true }, async (req, res) => {
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
});
