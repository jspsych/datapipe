// Shared gdrive OAuth token-refresh logic (scratchpad/step4b-oauth-connect-
// spec.md). Extracted out of resolve-token.ts so the same refresh+persist
// path can be called both lazily (resolve-token.ts, on-demand when a token
// has expired) and proactively (scheduled-token-refresh.ts's
// refreshExpiringGdriveTokens, run on a schedule ahead of expiry).
//
// Uses the runtime's global `fetch`, not the "node-fetch" package — matches
// resolve-token.ts's existing OSF refresh sibling (refresh-token.ts) and is
// pinned by resolve-token-gdrive.test.js, which mocks global.fetch.

import { decrypt, encrypt } from "../crypto-utils.js";
import { db } from "../app.js";
import { OAuth2AccountConnection } from "./types.js";

export type GdriveRefreshResult =
  | { success: true; accessToken: string }
  | { success: false; error: string; detail: string };

/**
 * Refreshes a single user's gdrive access token using their stored refresh
 * token, and persists the new (encrypted) access token / expiry — rotating
 * the refresh token too, if the provider issued a new one. Does not check
 * whether the current token is actually expired; callers decide when to
 * invoke this.
 */
export async function refreshGdriveToken(
  uid: string,
  connection: OAuth2AccountConnection
): Promise<GdriveRefreshResult> {
  const tokenUrl = process.env.GDRIVE_TOKEN_URL || "https://oauth2.googleapis.com/token";
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decrypt(connection.encryptedRefreshToken),
    client_id: process.env.GDRIVE_CLIENT_ID as string,
    client_secret: process.env.GDRIVE_CLIENT_SECRET as string,
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown network error";
    return { success: false, error: "INVALID_REFRESH_TOKEN", detail };
  }

  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text();
    return { success: false, error: "INVALID_REFRESH_TOKEN", detail: detail || "Refresh token is not valid" };
  }

  const tokenData = await tokenResponse.json();

  const newTokenExpiresAt = Date.now() + tokenData.expires_in * 1000;

  const update: Record<string, unknown> = {
    "connectedAccounts.gdrive.encryptedToken": encrypt(tokenData.access_token),
    "connectedAccounts.gdrive.tokenExpiresAt": newTokenExpiresAt,
  };

  // Only rotate the refresh token when the provider actually issued a new
  // one — otherwise leave the existing one in place.
  if (tokenData.refresh_token) {
    update["connectedAccounts.gdrive.encryptedRefreshToken"] = encrypt(tokenData.refresh_token);
  }

  await db.doc(`users/${uid}`).update(update);

  return { success: true, accessToken: tokenData.access_token };
}
