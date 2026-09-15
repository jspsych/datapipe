// Shared gdrive OAuth token-refresh logic (scratchpad/step4b-oauth-connect-
// spec.md). Kept separate from gdrive.ts so the same refresh+persist path can
// be called by both of that adapter's entry points: lazily by resolveToken()
// (on-demand, when a token has already expired) and proactively by
// refreshExpiringTokens() (ahead of expiry, from the weekly scheduled pass).
//
// Uses the runtime's global `fetch`, not the "node-fetch" package — matches
// the OSF refresh sibling (refresh-token.ts) and is pinned by
// resolve-token-gdrive.test.js, which mocks global.fetch.

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

export interface GdriveRevokeResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Revokes a gdrive OAuth grant by revoking its refresh token, via Google's
 * token revocation endpoint. Revoking a refresh token revokes the whole
 * grant (access token included), so there is no separate access-token call.
 *
 * Never throws -- callers (disconnectProvider, purge-user-data) treat
 * revocation as best-effort and must not fail the caller's own operation
 * over it. A 400 invalid_token means Google already considers the grant
 * gone (already revoked, or unknown token), which is the end state we
 * wanted, so that case is reported as `ok: true`.
 *
 * Never logs the token itself -- only status/error, at warn level, on
 * unexpected failures.
 */
export async function revokeGdriveToken(refreshToken: string): Promise<GdriveRevokeResult> {
  const revokeUrl = process.env.GDRIVE_REVOKE_URL || "https://oauth2.googleapis.com/revoke";
  const params = new URLSearchParams({ token: refreshToken });

  let response: Response;
  try {
    response = await fetch(revokeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown network error";
    console.warn(`revokeGdriveToken: network error contacting revocation endpoint: ${detail}`);
    return { ok: false, error: "NETWORK_ERROR" };
  }

  if (response.ok) {
    return { ok: true, status: response.status };
  }

  // Google returns 400 invalid_token for an already-revoked or unknown
  // token -- the grant is already gone, which is the outcome we wanted.
  if (response.status === 400) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // ignore -- fall through to the invalid_token treatment below
    }
    if (body.includes("invalid_token")) {
      return { ok: true, status: response.status };
    }
    console.warn(`revokeGdriveToken: revocation endpoint returned 400: ${body || "(no body)"}`);
    return { ok: false, status: response.status, error: "REVOKE_FAILED" };
  }

  console.warn(`revokeGdriveToken: revocation endpoint returned ${response.status}`);
  return { ok: false, status: response.status, error: "REVOKE_FAILED" };
}
