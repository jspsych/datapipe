import { decrypt, encrypt } from "./crypto-utils.js";
import { refreshAndUpdateUser } from "./refresh-token.js";
import { db } from "./app.js";
import { ExperimentData, UserData } from './interfaces';

type TokenResult = {
  success: true;
  token: string;
} | {
  success: false;
  error: string;
  detail: string;
}

function hasValidPAT(user_data: UserData): boolean {
  return user_data.osfTokenValid && !!user_data.osfToken;
}

async function resolveOsfToken(
  user_data: UserData,
  exp_data: ExperimentData,
): Promise<TokenResult> {
  if (user_data.usingPersonalToken) {
    if (!user_data.osfTokenValid) {
      return { success: false, error: "INVALID_OSF_TOKEN", detail: "The OSF token for this experiment is not valid" };
    }
    return { success: true, token: decrypt(user_data.osfToken) };
  }

  // OAuth path
  if (Date.now() > user_data.authTokenExpires) {
    const refreshResult = await refreshAndUpdateUser(exp_data.owner, decrypt(user_data.refreshToken));

    if (!refreshResult.success) {
      // Fall back to PAT if available
      if (hasValidPAT(user_data)) {
        return { success: true, token: decrypt(user_data.osfToken) };
      }
      return { success: false, error: "INVALID_REFRESH_TOKEN", detail: refreshResult.error || "Refresh token is not valid" };
    }

    return { success: true, token: refreshResult.accessToken! };
  }

  return { success: true, token: decrypt(user_data.authToken) };
}

async function resolveGdriveToken(
  user_data: UserData,
  exp_data: ExperimentData,
): Promise<TokenResult> {
  const gdrive = user_data.connectedAccounts?.gdrive;

  if (!gdrive) {
    return {
      success: false,
      error: "PROVIDER_NOT_CONNECTED",
      detail: "No connected Google Drive account for this experiment's owner",
    };
  }

  if (gdrive.tokenExpiresAt > Date.now()) {
    return { success: true, token: decrypt(gdrive.encryptedToken) };
  }

  const tokenUrl = process.env.GDRIVE_TOKEN_URL || "https://oauth2.googleapis.com/token";
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decrypt(gdrive.encryptedRefreshToken),
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

  await db.doc(`users/${exp_data.owner}`).update(update);

  return { success: true, token: tokenData.access_token };
}

export default async function resolveToken(
  user_data: UserData,
  exp_data: ExperimentData,
): Promise<TokenResult> {
  if (!exp_data.storageProvider || exp_data.storageProvider === "osf") {
    return resolveOsfToken(user_data, exp_data);
  }

  if (exp_data.storageProvider === "gdrive") {
    return resolveGdriveToken(user_data, exp_data);
  }

  return {
    success: false,
    error: "PROVIDER_NOT_CONNECTED",
    detail: `Unsupported storage provider: ${exp_data.storageProvider}`,
  };
}
