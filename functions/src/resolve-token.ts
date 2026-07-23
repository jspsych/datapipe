import { decrypt } from "./crypto-utils.js";
import { refreshAndUpdateUser } from "./refresh-token.js";
import { refreshGdriveToken } from "./providers/gdrive-oauth.js";
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

  const refreshResult = await refreshGdriveToken(exp_data.owner, gdrive);

  if (!refreshResult.success) {
    return { success: false, error: refreshResult.error, detail: refreshResult.detail };
  }

  return { success: true, token: refreshResult.accessToken };
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
