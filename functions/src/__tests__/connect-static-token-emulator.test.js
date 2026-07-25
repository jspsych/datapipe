/**
 * @jest-environment node
 */

// Tests for connectStaticTokenProvider (functions/src/connect-provider.ts) --
// the new static-token connect path that lets a Dataverse account actually be
// connected -- and for the disconnectProvider fix that lets a static-token
// connection be removed again (its old getOAuthConfig gate threw for
// static-token providers, so Dataverse could be neither connected nor
// disconnected before this change).
//
// UNLIKE oauth-connect-emulator.test.js, this suite does NOT drive the
// endpoints through the separate spawned Functions-emulator process's own
// HTTP listener. That pattern relies on an env var the Functions-emulator
// process reads at ITS OWN startup (GDRIVE_API_BASE/GDRIVE_TOKEN_URL) to
// redirect gdrive's OAuth calls to a local mock server. Dataverse has no such
// override, by design: serverUrl is genuinely PER-CONNECTION, researcher-
// supplied request-body input (that's the whole point of a federated
// provider), not a fixed provider constant -- and isAllowedServerUrl (the
// SSRF gate this endpoint enforces) rejects every address a same-machine
// mock server could actually bind to (localhost, 127.0.0.1, any port but
// 443, any bare IP literal). There is no URL we could hand the spawned
// emulator process that both (a) passes the SSRF gate and (b) resolves to a
// mock server we control, short of editing /etc/hosts or binding the
// privileged port 443 -- both out of scope for a test.
//
// So instead: this suite loads the compiled connectStaticTokenProvider /
// disconnectProvider / isAllowedServerUrl directly, in-process (the
// build-step instructions explicitly sanction jest.mock("node-fetch") in the
// test file for exactly this kind of problem), and drives the handlers
// through a throwaway local Express server bound to an OS-assigned port.
// Express is needed -- rather than a bare http.Server -- because the
// Firebase Functions Framework normally supplies req.body parsing and the
// res.status()/.json() helpers the handler calls; neither exists on a plain
// http.ServerResponse. This still exercises the REAL production code path,
// including the real dataverseProvider.validateStaticToken, against the REAL
// Firestore/Auth emulators (FIRESTORE_EMULATOR_HOST, idTokens signed by the
// Auth emulator -- same as oauth-connect-emulator.test.js). The only thing
// swapped out is dataverseProvider's own network transport ("node-fetch");
// its behavior against real Dataverse response shapes is already covered by
// providers-dataverse.test.js.

const mockFetch = jest.fn();
jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

import express from "express";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
jest.setTimeout(30000);

// Scoped to this process only -- this suite never talks to the separate
// Functions-emulator process, so (unlike oauth-connect-emulator.test.js) it
// doesn't need to match functions/.env.datapipe-test's key.
const TOKEN_ENCRYPTION_KEY = "34".repeat(32);

const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

// A real-shaped, https, dotted hostname reserved for exactly this purpose
// (the IANA ".test" TLD is guaranteed to never resolve in real DNS) -- mirrors
// providers-dataverse.test.js's own SERVER_URL convention.
const SERVER_URL = "https://dataverse.mock.test";

let db;
let connectStaticTokenProvider;
let disconnectProvider;
let isAllowedServerUrl;
let decrypt;

beforeAll(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = TOKEN_ENCRYPTION_KEY;

  ({ connectStaticTokenProvider, disconnectProvider, isAllowedServerUrl } = await import(
    "../../lib/connect-provider.js"
  ));
  ({ db } = await import("../../lib/app.js"));
  ({ decrypt } = await import("../../lib/crypto-utils.js"));
});

afterEach(() => {
  mockFetch.mockReset();
});

// ---- helpers ----

async function signUpEmulatorUser() {
  const email = `connect-static-token-${randomUUID()}@example.test`;
  const res = await fetch(AUTH_EMULATOR_SIGNUP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!", returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Auth emulator signUp failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return { uid: body.localId, idToken: body.idToken };
}

// Drives an onRequest-wrapped handler through a real (throwaway,
// OS-assigned-port) HTTP round trip -- see the header comment for why.
async function callHandler(handler, payload) {
  const app = express();
  app.use(express.json());
  app.use((req, res) => handler(req, res));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawBody: text };
    }
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

function callConnectStaticTokenProvider(payload) {
  return callHandler(connectStaticTokenProvider, payload);
}

function callDisconnectProvider(payload) {
  return callHandler(disconnectProvider, payload);
}

async function getUserData(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.data();
}

// ---- connectStaticTokenProvider ----

describe("connectStaticTokenProvider", () => {
  it("persists an encrypted dataverse connection with the normalized serverUrl origin", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    mockFetch.mockResolvedValueOnce({ status: 200 });

    const { status, body } = await callConnectStaticTokenProvider({
      provider: "dataverse",
      uid,
      idToken,
      token: "plaintext-dataverse-api-token",
      // A trailing slash on the input proves normalization strips it down to
      // the bare origin before persisting/using it.
      serverUrl: `${SERVER_URL}/`,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, provider: "dataverse" });

    const userData = await getUserData(uid);
    const dataverse = userData.connectedAccounts.dataverse;
    expect(dataverse.authMethod).toBe("static-token");
    expect(dataverse.serverUrl).toBe(SERVER_URL);
    expect(dataverse.encryptedToken).not.toBe("plaintext-dataverse-api-token");
    expect(dataverse.encryptedToken.startsWith("v1:")).toBe(true);
    expect(decrypt(dataverse.encryptedToken)).toBe("plaintext-dataverse-api-token");
    // Dataverse doesn't tell us the expiry at connect time -- must stay unset.
    expect(dataverse.tokenExpiresAt).toBeUndefined();

    // validateStaticToken hit the normalized origin, not the raw
    // trailing-slash input.
    expect(mockFetch).toHaveBeenCalledWith(`${SERVER_URL}/api/users/:me`, expect.anything());
  });

  it("rejects an invalid token with 400 and persists nothing", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    mockFetch.mockResolvedValueOnce({ status: 401 });

    const { status, body } = await callConnectStaticTokenProvider({
      provider: "dataverse",
      uid,
      idToken,
      token: "bad-token",
      serverUrl: SERVER_URL,
    });

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid API token");

    const userData = await getUserData(uid);
    expect(userData?.connectedAccounts?.dataverse).toBeUndefined();
  });

  it("rejects an oauth2 provider (gdrive) with 400 Unknown provider, without calling validateStaticToken", async () => {
    const { uid, idToken } = await signUpEmulatorUser();

    const { status, body } = await callConnectStaticTokenProvider({
      provider: "gdrive",
      uid,
      idToken,
      token: "some-token",
      serverUrl: SERVER_URL,
    });

    expect(status).toBe(400);
    expect(body.error).toBe("Unknown provider");
    expect(mockFetch).not.toHaveBeenCalled();

    const userData = await getUserData(uid);
    expect(userData?.connectedAccounts?.gdrive).toBeUndefined();
  });

  it("rejects 'osf' with 400 Unknown provider", async () => {
    const { uid, idToken } = await signUpEmulatorUser();

    const { status, body } = await callConnectStaticTokenProvider({
      provider: "osf",
      uid,
      idToken,
      token: "some-token",
      serverUrl: SERVER_URL,
    });

    expect(status).toBe(400);
    expect(body.error).toBe("Unknown provider");
  });

  it("rejects a missing serverUrl with 400 Invalid server URL, without calling validateStaticToken", async () => {
    const { uid, idToken } = await signUpEmulatorUser();

    const { status, body } = await callConnectStaticTokenProvider({
      provider: "dataverse",
      uid,
      idToken,
      token: "some-token",
    });

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid server URL");
    expect(mockFetch).not.toHaveBeenCalled();

    const userData = await getUserData(uid);
    expect(userData?.connectedAccounts?.dataverse).toBeUndefined();
  });
});

// ---- isAllowedServerUrl (pure-function SSRF gate, no network needed) ----

describe("isAllowedServerUrl", () => {
  const rejected = [
    ["non-https scheme", "http://dataverse.harvard.edu"],
    ["localhost", "https://localhost/"],
    ["IPv4 loopback literal", "https://127.0.0.1/"],
    ["private IPv4 literal", "https://10.0.0.1/"],
    ["cloud metadata IP literal", "https://169.254.169.254/"],
    ["GCP metadata hostname", "https://metadata.google.internal/"],
    // Trailing-dot FQDNs are the explicit-root form and resolve identically
    // in DNS, but match neither an equality check nor endsWith(".internal"),
    // so they bypassed every hostname rule until the hostname was normalized.
    ["GCP metadata hostname, trailing-dot FQDN", "https://metadata.google.internal./"],
    ["localhost, trailing-dot FQDN", "https://localhost./"],
    ["internal suffix, trailing-dot FQDN", "https://build.corp.internal./"],
    ["IPv6 literal", "https://[::1]/"],
    ["embedded credentials", "https://user:pass@dataverse.harvard.edu/"],
    ["non-443 port", "https://dataverse.harvard.edu:8443/"],
    ["bare single-label host", "https://dataverse/"],
  ];

  it.each(rejected)("rejects %s (%s)", (_label, url) => {
    expect(isAllowedServerUrl(url)).toBe(false);
  });

  const allowed = ["https://dataverse.harvard.edu", "https://demo.dataverse.org"];

  it.each(allowed)("allows a real institutional installation: %s", (url) => {
    expect(isAllowedServerUrl(url)).toBe(true);
  });
});

// ---- disconnectProvider ----

describe("disconnectProvider", () => {
  it("removes a dataverse connection (previously impossible -- getOAuthConfig threw for static-token providers)", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await db
      .collection("users")
      .doc(uid)
      .set({
        connectedAccounts: {
          dataverse: {
            authMethod: "static-token",
            encryptedToken: "pre-existing-dataverse-token",
            serverUrl: SERVER_URL,
          },
        },
      });

    const { status, body } = await callDisconnectProvider({ provider: "dataverse", uid, idToken });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true });

    const userData = await getUserData(uid);
    expect(userData.connectedAccounts.dataverse).toBeUndefined();
  });

  it("still rejects 'osf' with 400 Unknown provider (its legacy identity flow stays unmanaged here)", async () => {
    const { uid, idToken } = await signUpEmulatorUser();

    const { status, body } = await callDisconnectProvider({ provider: "osf", uid, idToken });

    expect(status).toBe(400);
    expect(body.error).toBe("Unknown provider");
  });
});
