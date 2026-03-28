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

  if (Date.now() > user_data.authTokenExpires) {
    const refreshResult = await refreshAndUpdateUser(exp_data.owner, decrypt(user_data.refreshToken));

    if (!refreshResult.success) {
      return { success: false, error: "INVALID_REFRESH_TOKEN", detail: refreshResult.error || "Refresh token is not valid" };
    }

    return { success: true, token: refreshResult.accessToken! };
  }

  return { success: true, token: decrypt(user_data.authToken) };
}
