/**
 * @jest-environment node
 */

// RED-phase tests for step 4b (docs/provider-migration-design.md,
// scratchpad/step4b-oauth-connect-spec.md), cases 1-9 of the test plan.
//
// generateOAuthState (generate-oauth-state.ts) exists today but only knows
// the legacy, provider-less OSF flow -- it ignores any `provider` field in
// the POST body entirely, so case 1 (no provider) is a regression guard
// expected to PASS today, while cases 2-3 (provider handling, unknown-
// provider validation) fail red because that branch doesn't exist yet.
//
// connectProvider and disconnectProvider (functions/src/connect-provider.ts,
// exported as connectprovider/disconnectprovider per index.ts's lowercase
// export convention -- see apiData -> apidata) do not exist at all yet, so
// every request to their emulator URLs 404s. Cases 4-9 are all red for that
// reason; none of the validation/persistence logic described in the spec
// exists to exercise yet. Where a case's setup depends on case 2's
// (not-yet-existing) provider-aware generateOAuthState -- e.g. case 4's
// "state from (2)" -- this file still calls the real endpoint the way the
// finished feature is meant to be exercised; today that just means the
// created state doc won't carry `provider: "gdrive"` yet, which is
// irrelevant since connectProvider 404s long before it would read that
// field anyway.
//
// Real Auth-emulator idTokens: the Auth emulator's accounts:signUp REST
// endpoint (http://localhost:9099/identitytoolkit.googleapis.com/v1/
// accounts:signUp?key=fake) returns a real idToken + localId for any
// email/password; localId is used as the uid so connectProvider's (future)
// auth.verifyIdToken(idToken) check matches -- there is no other way to get
// a verifiable idToken against the emulator's Auth backend.
//
// Mock OAuth token server: a fixed port (3580, this file only -- see
// functions/.env.datapipe-test) express server standing in for Google's
// token endpoint. Fixed, not listen(0), for the same reason as
// gdrive-emulator.test.js's mock Drive server: the emulator-hosted
// connectProvider function has no other way to discover where the mock
// lives, since GDRIVE_TOKEN_URL is read from the Functions emulator's own
// env, not passed at request time. Port 3579 (also fixed) is reserved for
// gdrive-emulator.test.js's mock Drive API and is never touched here.
//
// TOKEN_ENCRYPTION_KEY: this file's process sets the SAME fixed 64-hex value
// baked into functions/.env.datapipe-test so the Firestore-persisted
// encryptedToken -- written by the separate Functions-emulator process --
// can be decrypted and verified here.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };

// Must match functions/.env.datapipe-test exactly.
const TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
const GDRIVE_AUTHORIZE_URL = "http://127.0.0.1:3580/authorize";
const GDRIVE_CLIENT_ID = "test-client-id";
const GDRIVE_REDIRECT_URI = "http://localhost:3000/oauth2/gdrive";
const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_PORT = 3580;

const FUNCTIONS_BASE = "http://localhost:5001/datapipe-test/us-central1";
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

let db;
let mockTokenServer;
let decrypt;

beforeAll(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = TOKEN_ENCRYPTION_KEY;
  ({ decrypt } = await import("../../lib/crypto-utils.js"));

  let app;
  try {
    app = getApp("oauth-connect-test");
  } catch {
    app = initializeApp(config, "oauth-connect-test");
  }
  db = getFirestore(app);

  mockTokenServer = await createMockTokenServer();
});

afterEach(() => {
  mockTokenServer.reset();
});

afterAll(() => {
  mockTokenServer.server.close();
});

// ---- helpers ----

// A minimal stand-in for Google's token endpoint: records every received
// form-encoded body and returns a configurable response. Defaults to a
// happy-path grant so tests that don't care about the exchange details
// (e.g. auth-failure cases, which never reach the exchange) don't need to
// configure it.
function createMockTokenServer() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  function defaultResponse() {
    return {
      status: 200,
      body: {
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        expires_in: 3600,
      },
    };
  }

  let nextResponse = defaultResponse();
  const receivedRequests = [];

  app.post("/token", (req, res) => {
    receivedRequests.push({ ...req.body });
    res.status(nextResponse.status).json(nextResponse.body);
  });

  return new Promise((resolve) => {
    const server = app.listen(TOKEN_PORT, () => {
      resolve({
        server,
        setNextResponse(status, body) {
          nextResponse = { status, body };
        },
        getLastRequest() {
          return receivedRequests[receivedRequests.length - 1];
        },
        reset() {
          receivedRequests.length = 0;
          nextResponse = defaultResponse();
        },
      });
    });
  });
}

async function signUpEmulatorUser() {
  const email = `oauth-connect-${randomUUID()}@example.test`;
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

async function generateState(provider) {
  const res = await fetch(`${FUNCTIONS_BASE}/generateoauthstate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(provider ? { provider } : {}),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function createStateDoc(overrides = {}) {
  const state = randomUUID();
  await db.collection("oauth_states").doc(state).set({
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
    provider: "gdrive",
    ...overrides,
  });
  return state;
}

async function getStateDoc(state) {
  return db.collection("oauth_states").doc(state).get();
}

async function getUserData(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.data();
}

async function postJson(url, payload) {
  const res = await fetch(url, {
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
}

function callConnectProvider(payload) {
  return postJson(`${FUNCTIONS_BASE}/connectprovider`, payload);
}

function callDisconnectProvider(payload) {
  return postJson(`${FUNCTIONS_BASE}/disconnectprovider`, payload);
}

// ---- cases ----

describe("1. generateOAuthState without provider (regression guard)", () => {
  it("returns { state } only, with no authorizeUrl, and the state doc has no provider field -- expected to PASS today", async () => {
    const { status, body } = await generateState();

    expect(status).toBe(200);
    expect(typeof body.state).toBe("string");
    expect(body.authorizeUrl).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(["state"]);

    const stateDoc = await getStateDoc(body.state);
    expect(stateDoc.exists).toBe(true);
    expect(stateDoc.data().provider).toBeUndefined();
  });
});

describe("2. generateOAuthState with provider gdrive", () => {
  it("returns { state, authorizeUrl } with the correct query params, and records provider on the state doc", async () => {
    const { status, body } = await generateState("gdrive");

    expect(status).toBe(200);
    expect(typeof body.state).toBe("string");
    expect(typeof body.authorizeUrl).toBe("string");

    const url = new URL(body.authorizeUrl);
    expect(`${url.origin}${url.pathname}`).toBe(GDRIVE_AUTHORIZE_URL);
    expect(url.searchParams.get("client_id")).toBe(GDRIVE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(GDRIVE_REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(GDRIVE_SCOPE);
    expect(url.searchParams.get("state")).toBe(body.state);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");

    const stateDoc = await getStateDoc(body.state);
    expect(stateDoc.data().provider).toBe("gdrive");
  });
});

describe("3. generateOAuthState with unknown provider", () => {
  it("returns 400", async () => {
    const { status } = await generateState("not-a-real-provider");
    expect(status).toBe(400);
  });
});

describe("4. connectProvider happy path", () => {
  it("exchanges the code, persists an encrypted gdrive connection, and deletes the state (single-use)", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const { body: stateBody } = await generateState("gdrive");
    const state = stateBody.state;

    mockTokenServer.setNextResponse(200, {
      access_token: "case4-access-token",
      refresh_token: "case4-refresh-token",
      expires_in: 3600,
    });

    const before = Date.now();
    const { status, body } = await callConnectProvider({
      provider: "gdrive",
      code: "case4-auth-code",
      state,
      uid,
      idToken,
    });
    const after = Date.now();

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, provider: "gdrive" });

    const userData = await getUserData(uid);
    const gdrive = userData.connectedAccounts.gdrive;
    expect(gdrive.authMethod).toBe("oauth2");
    expect(gdrive.encryptedToken.startsWith("v1:")).toBe(true);
    expect(decrypt(gdrive.encryptedToken)).toBe("case4-access-token");
    expect(gdrive.tokenExpiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 5000);
    expect(gdrive.tokenExpiresAt).toBeLessThanOrEqual(after + 3600 * 1000 + 5000);

    const lastRequest = mockTokenServer.getLastRequest();
    expect(lastRequest.grant_type).toBe("authorization_code");
    expect(lastRequest.code).toBe("case4-auth-code");
    expect(lastRequest.client_id).toBe(GDRIVE_CLIENT_ID);
    expect(lastRequest.redirect_uri).toBe(GDRIVE_REDIRECT_URI);
    expect(typeof lastRequest.client_secret).toBe("string");
    expect(lastRequest.client_secret.length).toBeGreaterThan(0);

    const stateDoc = await getStateDoc(state);
    expect(stateDoc.exists).toBe(false);
  });
});

describe("5. connectProvider state validation", () => {
  it("rejects a state issued without a provider (legacy OSF state) as a provider mismatch", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const { body: legacyStateBody } = await generateState(); // no provider -- legacy OSF state

    const { status } = await callConnectProvider({
      provider: "gdrive",
      code: "case5-mismatch-code",
      state: legacyStateBody.state,
      uid,
      idToken,
    });

    expect(status).toBe(400);
  });

  it("rejects a reused (already-consumed) state", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const state = await createStateDoc();
    await db.collection("oauth_states").doc(state).delete(); // simulate prior consumption

    const { status } = await callConnectProvider({
      provider: "gdrive",
      code: "case5-reused-code",
      state,
      uid,
      idToken,
    });

    expect(status).toBe(400);
  });

  it("rejects an expired state", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const state = await createStateDoc({ expiresAt: Date.now() - 1000 });

    const { status } = await callConnectProvider({
      provider: "gdrive",
      code: "case5-expired-code",
      state,
      uid,
      idToken,
    });

    expect(status).toBe(400);
  });
});

describe("6. connectProvider auth failures", () => {
  it("returns 401 when idToken is missing, and persists nothing", async () => {
    const { uid } = await signUpEmulatorUser();
    const state = await createStateDoc();

    const { status } = await callConnectProvider({
      provider: "gdrive",
      code: "case6-missing-idtoken",
      state,
      uid,
    });

    expect(status).toBe(401);
    const userData = await getUserData(uid);
    expect(userData?.connectedAccounts?.gdrive).toBeUndefined();
  });

  it("returns 403 when idToken belongs to a different emulator user than uid, and persists nothing", async () => {
    const userA = await signUpEmulatorUser();
    const userB = await signUpEmulatorUser();
    const state = await createStateDoc();

    const { status } = await callConnectProvider({
      provider: "gdrive",
      code: "case6-mismatched-user",
      state,
      uid: userA.uid,
      idToken: userB.idToken,
    });

    expect(status).toBe(403);
    const userAData = await getUserData(userA.uid);
    expect(userAData?.connectedAccounts?.gdrive).toBeUndefined();
  });
});

describe("7. token exchange without a refresh_token", () => {
  it("returns 400 and persists nothing (half-connected-account guard)", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const state = await createStateDoc();

    mockTokenServer.setNextResponse(200, {
      access_token: "case7-access-token",
      expires_in: 3600,
      // no refresh_token -- Google only issues one with access_type=offline&prompt=consent
    });

    const { status, body } = await callConnectProvider({
      provider: "gdrive",
      code: "case7-no-refresh-code",
      state,
      uid,
      idToken,
    });

    expect(status).toBe(400);
    expect(body.error).toBe("Token exchange failed");

    const userData = await getUserData(uid);
    expect(userData?.connectedAccounts?.gdrive).toBeUndefined();
  });
});

describe("8. connectProvider does not clobber sibling providers", () => {
  it("leaves a pre-existing connectedAccounts.dataverse entry intact after connecting gdrive", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const dataverseEntry = {
      authMethod: "static-token",
      encryptedToken: "dataverse-token-placeholder",
      serverUrl: "https://demo.dataverse.org",
    };
    await db
      .collection("users")
      .doc(uid)
      .set({ connectedAccounts: { dataverse: dataverseEntry } }, { merge: true });

    const { body: stateBody } = await generateState("gdrive");
    mockTokenServer.setNextResponse(200, {
      access_token: "case8-access-token",
      refresh_token: "case8-refresh-token",
      expires_in: 3600,
    });

    const { status } = await callConnectProvider({
      provider: "gdrive",
      code: "case8-code",
      state: stateBody.state,
      uid,
      idToken,
    });

    expect(status).toBe(200);
    const userData = await getUserData(uid);
    expect(userData.connectedAccounts.dataverse).toEqual(dataverseEntry);
    expect(userData.connectedAccounts.gdrive).toBeDefined();
  });
});

describe("9. disconnectProvider", () => {
  it("removes connectedAccounts.gdrive while leaving siblings intact", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const dataverseEntry = {
      authMethod: "static-token",
      encryptedToken: "dataverse-token-placeholder-9",
      serverUrl: "https://demo.dataverse.org",
    };
    await db
      .collection("users")
      .doc(uid)
      .set({
        connectedAccounts: {
          gdrive: {
            authMethod: "oauth2",
            encryptedToken: "pre-existing-gdrive-token",
            encryptedRefreshToken: "pre-existing-gdrive-refresh",
            tokenExpiresAt: Date.now() + 60 * 60 * 1000,
          },
          dataverse: dataverseEntry,
        },
      });

    const { status, body } = await callDisconnectProvider({ provider: "gdrive", uid, idToken });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true });

    const userData = await getUserData(uid);
    expect(userData.connectedAccounts.gdrive).toBeUndefined();
    expect(userData.connectedAccounts.dataverse).toEqual(dataverseEntry);
  });

  it("returns 403 for a wrong-user idToken and leaves the entry untouched", async () => {
    const userA = await signUpEmulatorUser();
    const userB = await signUpEmulatorUser();
    const gdriveEntry = {
      authMethod: "oauth2",
      encryptedToken: "userA-gdrive-token",
      encryptedRefreshToken: "userA-gdrive-refresh",
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
    };
    await db.collection("users").doc(userA.uid).set({ connectedAccounts: { gdrive: gdriveEntry } });

    const { status } = await callDisconnectProvider({
      provider: "gdrive",
      uid: userA.uid,
      idToken: userB.idToken,
    });

    expect(status).toBe(403);
    const userAData = await getUserData(userA.uid);
    expect(userAData.connectedAccounts.gdrive).toEqual(gdriveEntry);
  });
});
