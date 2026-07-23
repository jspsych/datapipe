// Provider OAuth registry (docs/provider-migration-design.md,
// scratchpad/step4b-oauth-connect-spec.md).
//
// Only 'gdrive' is registered today. 'osf' deliberately has no entry here —
// the OSF identity flow (oauth2-callback.ts) is a separate, untouched
// legacy path with its own env vars (CLIENT_ID/CLIENT_SECRET/REDIRECT_URI).
// Structured so a provider like figshare is a config addition, not a
// rewrite.

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  extraAuthParams: Record<string, string>;
}

// Each entry is a factory (not a plain object) so env vars are read at
// CALL time, not module load — mirrors providers/gdrive.ts's getApiBase().
const CONFIG_FACTORIES: Record<string, () => OAuthConfig> = {
  gdrive: () => ({
    authorizeUrl:
      process.env.GDRIVE_AUTHORIZE_URL || "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: process.env.GDRIVE_TOKEN_URL || "https://oauth2.googleapis.com/token",
    clientId: process.env.GDRIVE_CLIENT_ID as string,
    clientSecret: process.env.GDRIVE_CLIENT_SECRET as string,
    redirectUri: process.env.GDRIVE_REDIRECT_URI as string,
    scope: "https://www.googleapis.com/auth/drive.file",
    // Without these, Google won't issue a refresh_token on the consent
    // grant — a half-connected account (access token, no refresh token)
    // is treated as a hard failure downstream.
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  }),
};

export function getOAuthConfig(provider: string): OAuthConfig {
  const factory = CONFIG_FACTORIES[provider];
  if (!factory) {
    throw new Error(`Unknown or unsupported OAuth provider: ${provider}`);
  }
  return factory();
}
