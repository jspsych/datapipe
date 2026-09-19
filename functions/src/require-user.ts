// Shared bearer-token check for the dashboardapi endpoints
// (functions/src/dashboard-api.ts) that authenticate a signed-in researcher
// directly off the `Authorization: Bearer <idToken>` header -- as opposed to
// connect-provider.ts's verifyOwnership, which authenticates an `idToken`
// carried in the request BODY alongside a claimed `uid`. The two shapes are
// not interchangeable: this one has no uid to compare against, because the
// caller does not send one -- the token itself IS the identity.
//
// Extracted here because delete-account.ts, save-osf-token.ts,
// send-contact-email-verification.ts, verify-contact-email.ts and
// ensure-derived-paths.ts each copy-pasted this exact block.
//
// On failure this writes the 401 response itself and returns null, so callers
// only need `const authResult = await requireUser(req, res); if (!authResult)
// return;` -- identical to the inline shape it replaces, byte for byte.

import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { auth } from "./app.js";

export interface RequireUserResult {
  uid: string;
  // Always present (DecodedIdToken.auth_time is unconditional) but only ever
  // READ by delete-account.ts, for its own recent-login-age check.
  authTime: number;
}

export async function requireUser(
  req: Request,
  res: Response,
  options?: { checkRevoked?: boolean }
): Promise<RequireUserResult | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }

  try {
    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await auth.verifyIdToken(idToken, options?.checkRevoked);
    return { uid: decodedToken.uid, authTime: decodedToken.auth_time };
  } catch {
    res.status(401).json({ error: "Invalid authentication token" });
    return null;
  }
}
