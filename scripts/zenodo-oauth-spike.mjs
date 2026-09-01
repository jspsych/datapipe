// Zenodo OAuth2 gating spike (docs/provider-migration-design.md).
//
// Zenodo publishes NO documentation for its OAuth application flow --
// developers.zenodo.org covers personal access tokens only. Everything
// DataPipe assumes about it was read out of invenio-oauth2server's source on
// 2026-08-21. This script exists to check those readings against the running
// service, because a source file on GitHub master is not the same thing as
// whatever revision Zenodo actually deploys.
//
// Usage:
//   cd functions && npm run build && cd ..
//   ZENODO_CLIENT_ID=xxx ZENODO_CLIENT_SECRET=yyy node scripts/zenodo-oauth-spike.mjs
//
// Env:
//   ZENODO_CLIENT_ID     (required) from the registered OAuth application
//   ZENODO_CLIENT_SECRET (required) same application, confidential client
//   ZENODO_ENV           (default "sandbox.") "" targets production zenodo.org
//   ZENODO_OAUTH_PORT    (default 3000) port for the local redirect catcher
//   ZENODO_REDIRECT_URI  (default http://localhost:<port>/oauth2/connect)
//   ZENODO_CODE          an authorization code obtained by hand (see below)
//   ZENODO_CLEANUP       (default 1; set to 0 to leave the deposition behind)
//
// TWO WAYS TO GET THE AUTHORIZATION CODE:
//
//  1. AUTOMATIC (default). Requires http://localhost:<port>/oauth2/connect to
//     be one of the application's registered redirect URIs -- Zenodo's
//     validate_redirect_uri permits plain http ONLY for localhost/127.0.0.1,
//     so this needs no tunnel. The script starts a throwaway server, prints a
//     consent URL, and catches the redirect itself.
//
//  2. MANUAL, when only the deployed redirect URI is registered. Set
//     ZENODO_REDIRECT_URI to it; the script prints the consent URL and stops.
//     Approve it, then copy the `code` query parameter out of the browser's
//     address bar and re-run with ZENODO_CODE=<that value>. The deployed
//     connect page will show a CSRF error, which is correct and harmless --
//     the state did not come from that browser, so the page refuses to spend
//     the code and it is still yours to use. Codes are single-use and
//     short-lived, so re-run promptly.
//
// Leaves the deposition UNPUBLISHED -- nothing here mints a DOI.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { zenodoProvider } from "../functions/lib/providers/zenodo.js";

const clientId = process.env.ZENODO_CLIENT_ID;
const clientSecret = process.env.ZENODO_CLIENT_SECRET;
const env = process.env.ZENODO_ENV ?? "sandbox.";
const port = Number(process.env.ZENODO_OAUTH_PORT || 3000);
const cleanup = process.env.ZENODO_CLEANUP !== "0";
const suppliedCode = process.env.ZENODO_CODE;

const host = `https://${env}zenodo.org`;
const redirectUri = process.env.ZENODO_REDIRECT_URI || `http://localhost:${port}/oauth2/connect`;
// Only a loopback redirect can be caught locally; anything else has to come
// back through a real browser, so the code is supplied by hand instead.
const canCatchRedirect = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(redirectUri);

if (!clientId || !clientSecret) {
  console.error("ZENODO_CLIENT_ID and ZENODO_CLIENT_SECRET are required. See the header of this file.");
  process.exit(1);
}

const results = [];
const record = (gate, verdict, detail) => {
  results.push({ gate, verdict, detail });
  console.log(`\n[${verdict}] ${gate}\n      ${detail}`);
};

// Waits for Zenodo to redirect back with ?code=, then shuts the server down.
function awaitAuthorizationCode(state) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== "/oauth2/connect") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body style="font-family:system-ui;padding:3rem">
        <h2>${code ? "Authorized." : "Authorization failed."}</h2>
        <p>You can close this tab and return to the terminal.</p></body></html>`);
      server.close();
      if (error) return reject(new Error(`Zenodo returned error=${error}`));
      if (!code) return reject(new Error("No code in the redirect"));
      if (returnedState !== state) return reject(new Error("State mismatch"));
      resolve(code);
    });
    server.listen(port, "127.0.0.1");
    const waitMs = Number(process.env.ZENODO_OAUTH_WAIT_MS || 15 * 60 * 1000);
    setTimeout(() => {
      server.close();
      reject(new Error(`Timed out waiting for the consent redirect (${Math.round(waitMs / 60000)} min)`));
    }, waitMs).unref();
  });
}

async function postToken(params, { basicAuth = false } = {}) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  const body = { ...params };
  if (basicAuth) {
    // client_secret_basic: credentials move to the Authorization header and
    // must NOT also appear in the body, or oauthlib treats it as two competing
    // authentication attempts.
    delete body.client_id;
    delete body.client_secret;
    headers.Authorization =
      "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  }
  const response = await fetch(`${host}/oauth/token`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text for the failure detail */
  }
  return { ok: response.ok, status: response.status, json, text };
}

// Cheapest authenticated call that distinguishes a live token from a dead one.
async function tokenIsLive(accessToken) {
  const response = await fetch(`${host}/api/deposit/depositions?size=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.status === 200;
}

async function main() {
  console.log(`Zenodo OAuth spike against ${host}\n`);

  const state = randomUUID();
  const authorizeUrl = new URL(`${host}/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  // Exactly the scopes zenodo.ts's oauthConfig() requests -- deliberately no
  // user:email, which gate K checks the consequence of.
  authorizeUrl.searchParams.set("scope", "deposit:write deposit:actions");
  authorizeUrl.searchParams.set("state", state);

  let code;
  if (suppliedCode) {
    // State cannot be checked on this path -- the redirect never came back
    // through this process. That is acceptable here and nowhere else: this is a
    // local diagnostic run by the person who just approved the consent, not a
    // login flow exposed to anyone. connect-provider.ts validates state
    // server-side for the real thing.
    code = suppliedCode;
    console.log("Using the authorization code supplied via ZENODO_CODE.");
  } else if (canCatchRedirect) {
    console.log("Open this URL and approve:\n");
    console.log(`  ${authorizeUrl}\n`);
    console.log(`Listening on ${redirectUri} ...`);
    code = await awaitAuthorizationCode(state);
    console.log("\nGot an authorization code.");
  } else {
    console.log("Open this URL and approve:\n");
    console.log(`  ${authorizeUrl}\n`);
    console.log(`${redirectUri} is not a loopback address, so this script cannot catch the`);
    console.log("redirect. Approve the consent, copy the `code` parameter out of the address");
    console.log("bar, and re-run with:\n");
    console.log("  ZENODO_CODE=<code> node scripts/zenodo-oauth-spike.mjs\n");
    console.log("The connect page will show a CSRF error -- that is expected, and it means the");
    console.log("code was not spent. Codes are short-lived, so re-run promptly.");
    return;
  }

  // ---- Gate J: does the exchange work, and how long does a token live? ----
  //
  // Tried two ways, because Zenodo documents neither and the answer decides
  // what connect-provider.ts has to send. RFC 6749 lets a confidential client
  // authenticate either by putting client_id/client_secret in the body
  // (client_secret_post) or by HTTP Basic (client_secret_basic), and servers
  // are free to accept only one. A rejected authentication does not spend the
  // authorization code, so falling through to the second attempt is safe.
  const grantParams = {
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  };

  console.log(`\n  redirect_uri sent: ${redirectUri}`);
  let first = await postToken(grantParams);
  let authStyle = "client_secret_post (credentials in the body)";

  if (!first.ok) {
    console.log(`  client_secret_post -> ${first.status} ${first.text.slice(0, 200)}`);
    console.log("  retrying with HTTP Basic ...");
    first = await postToken(grantParams, { basicAuth: true });
    authStyle = "client_secret_basic (HTTP Basic)";
  }

  if (!first.ok || !first.json?.access_token) {
    record(
      "J. authorization_code exchange",
      "FAIL",
      `Both authentication styles rejected. Last: ${first.status} ${first.text.slice(0, 300)}`
    );
    return;
  }

  record("J0. client authentication style", "INFO", `Zenodo accepted ${authStyle}.`);

  // Persist the token response when asked. A 60-day access token is still
  // usable long after this run, and it means probing the refresh grant does
  // not cost a fresh consent round trip every time.
  if (process.env.ZENODO_TOKEN_OUT) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.ZENODO_TOKEN_OUT, JSON.stringify(first.json, null, 2));
    console.log(`  token response written to ${process.env.ZENODO_TOKEN_OUT}`);
  }

  const expiresIn = first.json.expires_in;
  record(
    "J. authorization_code exchange",
    "PASS",
    `expires_in=${expiresIn}s (${(expiresIn / 3600).toFixed(2)}h), ` +
      `refresh_token=${first.json.refresh_token ? "present" : "ABSENT"}, ` +
      `scope="${first.json.scope}"`
  );

  if (expiresIn !== 3600) {
    record(
      "J2. access-token lifetime matches the source default",
      "INFO",
      `Zenodo issued ${expiresIn}s, not oauthlib's 3600s default -- it overrides ` +
        "OAUTH2_PROVIDER_TOKEN_EXPIRES_IN in deployment config. EXPIRY_MARGIN_MS in " +
        "zenodo-oauth.ts is sized against this number; check it still makes sense."
    );
  }

  // ---- Gate K: identity leakage without the user:email scope ----
  const user = first.json.user;
  if (!user) {
    record("K. identity in the token response", "INFO", "No `user` object at all in the token response.");
  } else if (user.email) {
    record(
      "K. identity in the token response",
      "FAIL",
      `Zenodo returned an email (${user.email}) even though user:email was NOT requested. ` +
        "We would be receiving identity data we never asked for and do not want."
    );
  } else {
    record(
      "K. identity in the token response",
      "PASS",
      `user.id=${user.id} present, no email -- matches invenio-oauth2server's save_token, ` +
        "which only adds the address when the user:email scope is granted."
    );
  }

  // ---- Gate O: can an OAuth token actually drive the adapter? ----
  const auth = { token: first.json.access_token, serverUrl: host };
  let container = null;
  try {
    container = await zenodoProvider.createDataContainer(auth, {
      title: `DataPipe OAuth spike ${new Date().toISOString()}`,
      creatorName: "DataPipe, Spike",
      description: "Temporary deposition created by scripts/zenodo-oauth-spike.mjs. Never published.",
    });
    const body = JSON.stringify({ hello: "oauth" });
    const write = await zenodoProvider.writeSessionFile(auth, container, "data/raw/oauth-probe.json", body, {
      size: Buffer.byteLength(body),
      contentType: "application/json",
    });
    record(
      "O. OAuth token drives the real adapter",
      write.success ? "PASS" : "FAIL",
      write.success
        ? `deposition ${container.depositionId}, wrote "${write.storedFilename}" -- deposit:write is sufficient`
        : `write failed: ${write.error} ${write.providerMessage ?? ""}`
    );
  } catch (e) {
    record("O. OAuth token drives the real adapter", "FAIL", e.message);
  }

  // ---- Gate L: does refresh rotate the refresh token? ----
  const useBasic = authStyle.startsWith("client_secret_basic");
  const second = await postToken(
    {
      grant_type: "refresh_token",
      refresh_token: first.json.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    },
    { basicAuth: useBasic }
  );

  if (!second.ok || !second.json?.access_token) {
    record("L. refresh_token grant", "FAIL", `${second.status}: ${second.text.slice(0, 300)}`);
  } else {
    const rotated = second.json.refresh_token !== first.json.refresh_token;
    record(
      "L. refresh rotates the refresh token",
      rotated ? "PASS" : "FAIL",
      rotated
        ? "New refresh_token differs from the old one, as oauthlib's rotate_refresh_token=True implies. " +
            "zenodo-oauth.ts MUST persist it -- this is the whole reason that module exists."
        : "Refresh token came back UNCHANGED. Rotation is off on this deployment, which would make " +
            "recoverFromRotationRace() dead code and the persist far less dangerous. Re-read that module."
    );

    // ---- Gate M: is the superseded refresh token dead immediately? ----
    const replay = await postToken(
      {
        grant_type: "refresh_token",
        refresh_token: first.json.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      },
      { basicAuth: useBasic }
    );
    const deadRefresh = !replay.ok;
    record(
      "M. superseded refresh token is rejected",
      deadRefresh ? "PASS" : "FAIL",
      deadRefresh
        ? `Replay returned ${replay.status} (${(replay.json?.error ?? replay.text).toString().slice(0, 80)}) -- ` +
            "this is exactly the invalid_grant that recoverFromRotationRace() has to distinguish " +
            "from a genuinely revoked grant."
        : "The OLD refresh token still works, so two concurrent refreshes cannot collide. " +
            "recoverFromRotationRace() would be unnecessary."
    );

    // ---- Gate N: does refreshing kill the PREVIOUS access token? ----
    // invenio-oauth2server's save_token deletes every prior Token row for
    // (client_id, user_id), which would take the old ACCESS token with it. If
    // true, a long upload holding the old token breaks the moment anything
    // else refreshes -- a failure mode no amount of expiry margin prevents.
    const oldAccessLive = await tokenIsLive(first.json.access_token);
    record(
      "N. previous access token survives a refresh",
      oldAccessLive ? "PASS" : "INFO",
      oldAccessLive
        ? "The pre-refresh access token still authenticates, so an in-flight upload is unaffected " +
            "by a concurrent refresh."
        : "The pre-refresh access token is ALREADY DEAD, as save_token deleting every prior " +
            "row for (client_id, user_id) implies. A refresh by a concurrent request invalidates " +
            "a token an in-flight upload may be using. Zenodo reports that as 403 -- the same " +
            "403 it returns for a revoked token, a garbage token and no token at all -- so the " +
            "response cannot distinguish transient from terminal; only comparing against the " +
            "stored token can."
    );
  }

  if (cleanup && container) {
    try {
      await fetch(`${host}/api/deposit/depositions/${container.depositionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${second.json?.access_token ?? first.json.access_token}` },
      });
      console.log(`\nCleaned up deposition ${container.depositionId}.`);
    } catch (e) {
      console.log(`\nCould not delete deposition ${container.depositionId}: ${e.message}`);
    }
  }

  console.log("\n\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`[${r.verdict}] ${r.gate}`);
  }
  const failed = results.filter((r) => r.verdict === "FAIL");
  if (failed.length) {
    console.log(`\n${failed.length} gate(s) FAILED.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nSpike aborted:", e.message);
  process.exitCode = 1;
});
