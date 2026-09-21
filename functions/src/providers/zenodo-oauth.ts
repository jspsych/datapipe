// Zenodo OAuth token refresh.
//
// SEPARATE FROM gdrive-oauth.ts DESPITE THE SIMILAR SHAPE, because Zenodo's
// refresh semantics differ in one way that changes the whole failure model:
// ZENODO ROTATES THE REFRESH TOKEN ON EVERY REFRESH AND DESTROYS THE OLD ONE.
//
// Verified by reading invenio-oauth2server (Zenodo runs InvenioRDM, which
// reports itself in the page generator meta tag), 2026-08-21 -- none of this
// is in Zenodo's developer documentation, which only covers personal access
// tokens:
//
//   oauthlib RequestValidator.rotate_refresh_token   -> defaults to True
//   invenio_oauth2server.provider.save_token         -> deletes EVERY prior
//     Token row for (client_id, user_id) before inserting the new one
//     ("make sure that every client has only one token connected to a user")
//
// Google keeps a refresh token stable for years and reissues the same value,
// so gdrive's path can treat a lost refresh response as harmless. Here it is
// not. Two consequences, both handled below:
//
//  1. LOSING THE RESPONSE LOSES THE ACCOUNT. The old refresh token is dead the
//     instant Zenodo answers, so a crash between the HTTP response and the
//     Firestore write leaves the researcher unable to write data until they
//     reconnect by hand -- mid-experiment. persistRefreshedToken() is
//     therefore the very next thing that happens after parsing, and a failure
//     there is logged distinctly rather than folded into "refresh failed".
//
//  2. CONCURRENT REFRESHES RACE. Two submissions arriving after an idle hour
//     both see an expired access token and both refresh. The first rotates
//     R -> R1; the second presents R, which no longer exists, and Zenodo
//     answers 400 invalid_grant. That is NOT a dead connection -- R1 is
//     perfectly good -- and treating it as one would tear down a working
//     account in the middle of data collection. recoverFromRotationRace()
//     re-reads the stored connection and continues with whatever the winner
//     persisted.
//
// Uses the runtime's global `fetch` rather than the "node-fetch" package,
// matching gdrive-oauth.ts and refresh-token.ts so tests can mock global.fetch.

import { decrypt, encrypt } from "../crypto-utils.js";
import { db } from "../app.js";
import { OAuth2AccountConnection } from "./types.js";

export type ZenodoRefreshResult =
  | { success: true; accessToken: string }
  | { success: false; error: string; detail: string };

const CONNECTION_PATH = "connectedAccounts.zenodo";

// Treat a token as expired this long before it actually is, so a token checked
// as valid at the top of a request cannot expire during a slow upload -- a
// compaction pass moves up to MAX_BATCH_BYTES in a single call.
//
// MEASURED, NOT ASSUMED: sandbox.zenodo.org issues expires_in=5184000, i.e.
// SIXTY DAYS (spike gate J, 2026-08-21). Reading the source would tell you one
// hour -- Invenio never sets OAUTH2_PROVIDER_TOKEN_EXPIRES_IN, so it falls
// through to oauthlib's `expires_in or 3600` -- but Zenodo overrides it in
// deployment config, which is not public. This is exactly the class of fact a
// spike exists to establish.
//
// A five-minute margin against a sixty-day lifetime is therefore vanishingly
// small, and deliberately so: it is here to stop a mid-request expiry, not to
// schedule refreshes. What the long lifetime really means is that refresh is a
// RARE event -- roughly one per connection per two months -- so it will almost
// never be exercised in testing and has to be right by construction.
export const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

// The Zenodo installation this DEPLOYMENT talks to: "" -> zenodo.org,
// "sandbox." -> sandbox.zenodo.org. Mirrors NEXT_PUBLIC_ZENODO_ENV on the
// frontend and NEXT_PUBLIC_OSF_ENV's host-prefix shape.
//
// Unlike the static-token era, this is NOT a per-researcher choice any more
// and must not be read off the stored connection: an OAuth client_id is
// registered against ONE installation, so a sandbox client simply cannot
// complete a flow on zenodo.org. Deployment config is the only thing that can
// legitimately decide which host we mean.
export function zenodoOAuthHost(): string {
  return `https://${process.env.ZENODO_ENV ?? ""}zenodo.org`;
}

export function zenodoAuthorizeUrl(): string {
  return process.env.ZENODO_AUTHORIZE_URL || `${zenodoOAuthHost()}/oauth/authorize`;
}

export function zenodoTokenUrl(): string {
  return process.env.ZENODO_TOKEN_URL || `${zenodoOAuthHost()}/oauth/token`;
}

type ExchangeOutcome =
  | { kind: "ok"; data: Record<string, unknown> }
  | { kind: "invalid-grant"; detail: string }
  | { kind: "failed"; detail: string };

/**
 * One POST to Zenodo's token endpoint with the refresh_token grant.
 *
 * `invalid-grant` is split out from `failed` because only that one is
 * ambiguous: it means the presented refresh token does not exist, which is
 * true both when the grant was revoked AND when a concurrent refresh rotated
 * it a moment ago. The caller resolves that ambiguity; everything else here
 * is a plain failure.
 */
async function exchangeRefreshToken(refreshToken: string): Promise<ExchangeOutcome> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.ZENODO_CLIENT_ID as string,
    client_secret: process.env.ZENODO_CLIENT_SECRET as string,
  });

  let response: Response;
  try {
    response = await fetch(zenodoTokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown network error";
    return { kind: "failed", detail };
  }

  if (!response.ok) {
    const body = await response.text();
    // oauthlib answers 400 {"error": "invalid_grant"}. Matched on the body
    // rather than the status alone: 400 also covers invalid_client and
    // unsupported_grant_type, which are configuration faults, not races, and
    // must not send us hunting for a rotation that never happened.
    if (body.includes("invalid_grant")) {
      return { kind: "invalid-grant", detail: body };
    }
    return { kind: "failed", detail: body || `Token endpoint returned ${response.status}` };
  }

  return { kind: "ok", data: (await response.json()) as Record<string, unknown> };
}

/**
 * Writes a freshly issued token back to the user document.
 *
 * This is the dangerous half of a Zenodo refresh: by the time it runs, the
 * refresh token we presented has ALREADY been deleted server-side, so if this
 * write does not land the researcher's connection is unrecoverable without a
 * manual reconnect. Hence the explicit, greppable error log -- a silent throw
 * here would be indistinguishable from an ordinary transient failure.
 */
async function persistRefreshedToken(
  uid: string,
  data: Record<string, unknown>
): Promise<ZenodoRefreshResult> {
  const accessToken = data.access_token as string | undefined;
  const expiresIn = data.expires_in as number | undefined;
  const refreshToken = data.refresh_token as string | undefined;

  if (!accessToken || typeof expiresIn !== "number") {
    return {
      success: false,
      error: "INVALID_REFRESH_TOKEN",
      detail: "Zenodo token response was missing access_token or expires_in",
    };
  }

  const update: Record<string, unknown> = {
    [`${CONNECTION_PATH}.encryptedToken`]: encrypt(accessToken),
    [`${CONNECTION_PATH}.tokenExpiresAt`]: Date.now() + expiresIn * 1000,
  };

  if (refreshToken) {
    update[`${CONNECTION_PATH}.encryptedRefreshToken`] = encrypt(refreshToken);
  } else {
    // Should not happen -- oauthlib's refresh grant always issues one -- but
    // if it ever does, keeping the old value is strictly better than clearing
    // it, and the warning says why the next refresh may fail.
    console.warn(
      `zenodo: refresh for ${uid} returned no refresh_token; keeping the previous one, ` +
        "which Zenodo has probably already invalidated"
    );
  }

  try {
    await db.doc(`users/${uid}`).update(update);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown Firestore error";
    console.error(
      `zenodo: FAILED TO PERSIST ROTATED CREDENTIALS for ${uid} -- the previous refresh ` +
        `token is already dead server-side, so this account must be reconnected by hand: ${detail}`
    );
    return { success: false, error: "INVALID_REFRESH_TOKEN", detail };
  }

  return { success: true, accessToken };
}

/**
 * Resolves an invalid_grant by asking whether somebody else rotated the token.
 *
 * Re-reads the stored connection and compares it against the refresh token we
 * just tried. A DIFFERENT stored value means a concurrent refresh won the race
 * and our token was collateral damage, so the connection is healthy and we
 * continue with the winner's credentials. The SAME stored value means nothing
 * rotated and the grant really is gone.
 *
 * Bounded to a single extra exchange: if the winner's access token is already
 * expired too we try once more with its refresh token and then stop, rather
 * than recursing into a race that a busy experiment could sustain.
 */
async function recoverFromRotationRace(
  uid: string,
  presentedRefreshToken: string,
  detail: string
): Promise<ZenodoRefreshResult> {
  const snapshot = await db.doc(`users/${uid}`).get();
  const stored = snapshot.data()?.connectedAccounts?.zenodo as
    | OAuth2AccountConnection
    | undefined;

  if (!stored?.encryptedRefreshToken) {
    return {
      success: false,
      error: "PROVIDER_NOT_CONNECTED",
      detail: "No connected Zenodo account for this experiment's owner",
    };
  }

  if (decrypt(stored.encryptedRefreshToken) === presentedRefreshToken) {
    return { success: false, error: "INVALID_REFRESH_TOKEN", detail };
  }

  console.log(
    `zenodo: refresh for ${uid} lost a rotation race; continuing with the stored credentials`
  );

  if (stored.tokenExpiresAt > Date.now() + EXPIRY_MARGIN_MS) {
    return { success: true, accessToken: decrypt(stored.encryptedToken) };
  }

  const retry = await exchangeRefreshToken(decrypt(stored.encryptedRefreshToken));
  if (retry.kind !== "ok") {
    return { success: false, error: "INVALID_REFRESH_TOKEN", detail: retry.detail };
  }
  return persistRefreshedToken(uid, retry.data);
}

/**
 * Refreshes a single user's Zenodo access token and persists the result,
 * rotating the stored refresh token to match. Does not check whether the
 * current token is actually expired -- callers decide when to invoke this.
 */
export async function refreshZenodoToken(
  uid: string,
  connection: OAuth2AccountConnection
): Promise<ZenodoRefreshResult> {
  const presentedRefreshToken = decrypt(connection.encryptedRefreshToken);
  const outcome = await exchangeRefreshToken(presentedRefreshToken);

  if (outcome.kind === "invalid-grant") {
    return recoverFromRotationRace(uid, presentedRefreshToken, outcome.detail);
  }
  if (outcome.kind === "failed") {
    return { success: false, error: "INVALID_REFRESH_TOKEN", detail: outcome.detail };
  }

  return persistRefreshedToken(uid, outcome.data);
}
