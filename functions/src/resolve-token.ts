import { decrypt } from "./crypto-utils.js";
import { refreshAndUpdateUser } from "./refresh-token.js";
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

export default async function resolveToken(
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
