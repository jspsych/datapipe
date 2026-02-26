import { db } from "./app.js";
import { encrypt } from "./crypto-utils.js";

interface RefreshResult {
  success: boolean;
  accessToken?: string;
  accessTokenExpires?: number;
  error?: string;
}

const REFRESH_TOKEN_LIFETIME_MS = 2_629_746_000; // ~1 month in milliseconds

/**
 * Refreshes an OAuth access token using a refresh token.
 * If OSF returns a new refresh token (rotation), it is saved along with
 * a fresh expiration window.
 */
export async function refreshAndUpdateUser(
  userId: string,
  refreshToken: string
): Promise<RefreshResult> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.NEXT_PUBLIC_CLIENT_ID as string,
    client_secret: process.env.CLIENT_SECRET as string,
    grant_type: "refresh_token",
  });

  const tokenResponse = await fetch(
    `https://accounts.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/oauth2/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!tokenResponse.ok) {
    const errorData = await tokenResponse.text();
    console.error(`Token refresh failed for user ${userId}:`, errorData);
    return { success: false, error: errorData };
  }

  const tokenData = await tokenResponse.json();

  const updateData: Record<string, unknown> = {
    authToken: encrypt(tokenData.access_token),
    authTokenExpires: Date.now() + tokenData.expires_in * 1000,
  };

  // Handle refresh token rotation: if OSF returns a new refresh token,
  // save it and reset the expiration window.
  if (tokenData.refresh_token) {
    updateData.refreshToken = encrypt(tokenData.refresh_token);
    updateData.refreshTokenExpires = Date.now() + REFRESH_TOKEN_LIFETIME_MS;
  }

  await db.doc(`users/${userId}`).update(updateData);

  return {
    success: true,
    accessToken: tokenData.access_token,
    accessTokenExpires: updateData.authTokenExpires as number,
  };
}
