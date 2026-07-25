/**
 * @jest-environment node
 */

// Emulator integration tests for getProviderAccessToken
// (functions/src/get-provider-access-token.ts), the endpoint the Picker
// front-end (a later build step) calls to obtain a raw Drive access token
// for client-side use. Follows the exact patterns established by
// oauth-connect-emulator.test.js (auth via the Auth emulator's
// accounts:signUp, encrypted-token seeding/decryption) and
// create-experiment-emulator.test.js (postJson/signUpEmulatorUser helpers).
//
// Per index.ts's lowercase export convention (getProviderAccessToken ->
// getprovideraccesstoken), the URL under test is
// http://localhost:5001/datapipe-test/us-central1/getprovideraccesstoken.
//
// No new mock Drive/token server is started here: the happy-path case seeds
// an UNEXPIRED connectedAccounts.gdrive entry (same shape
// create-experiment-emulator.test.js's seedGdriveUser uses), so
// resolve-token.ts's resolveGdriveToken never needs to hit the token
// endpoint at all -- avoiding any risk of colliding with the reserved fixed
// ports (3579 = mock Drive API, 3580 = mock OAuth token server) that other
// suites in this same jest run bind.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
const FUNCTIONS_BASE = "http://localhost:5001/datapipe-test/us-central1";
const GET_TOKEN_URL = `${FUNCTIONS_BASE}/getprovideraccesstoken`;
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

let db;

beforeAll(() => {
  let app;
  try {
    app = getApp("get-provider-access-token-test");
  } catch {
    app = initializeApp(config, "get-provider-access-token-test");
  }
  db = getFirestore(app);
});

// ---- helpers ----

async function signUpEmulatorUser() {
  const email = `get-provider-access-token-${randomUUID()}@example.test`;
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

function getViaGet(payload) {
  // 405 case: method must be rejected before body parsing matters, but a GET
  // with a query string is enough to exercise the method check.
  return fetch(`${GET_TOKEN_URL}?${new URLSearchParams(payload)}`, { method: "GET" }).then(
    async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) })
  );
}

function callGetProviderAccessToken(payload) {
  return postJson(GET_TOKEN_URL, payload);
}

async function seedGdriveUser(uid, overrides = {}) {
  await db.collection("users").doc(uid).set({
    connectedAccounts: {
      gdrive: {
        authMethod: "oauth2",
        // plaintext fallback, same convention as create-experiment-emulator.test.js
        encryptedToken: "get-token-plaintext-access-token",
        encryptedRefreshToken: "get-token-plaintext-refresh-token",
        tokenExpiresAt: Date.now() + 60 * 60 * 1000, // unexpired -- no refresh needed
        providerAccountId: "get-token-acct",
        ...overrides,
      },
    },
  });
}

// ---- cases ----

describe("getProviderAccessToken method + validation", () => {
  it("returns 405 for a GET request", async () => {
    const { status } = await getViaGet({ provider: "gdrive", uid: "whoever" });
    expect(status).toBe(405);
  });

  it("returns 400 when provider is missing", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const { status } = await callGetProviderAccessToken({ uid, idToken });
    expect(status).toBe(400);
  });

  it("returns 400 when uid is missing", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status } = await callGetProviderAccessToken({ provider: "gdrive", idToken });
    expect(status).toBe(400);
  });
});

describe("getProviderAccessToken auth failures", () => {
  it("returns 401 when idToken is missing", async () => {
    const { uid } = await signUpEmulatorUser();
    const { status } = await callGetProviderAccessToken({ provider: "gdrive", uid });
    expect(status).toBe(401);
  });

  it("returns 403 when idToken belongs to a different emulator user than uid", async () => {
    const userA = await signUpEmulatorUser();
    const userB = await signUpEmulatorUser();
    await seedGdriveUser(userA.uid);

    const { status } = await callGetProviderAccessToken({
      provider: "gdrive",
      uid: userA.uid,
      idToken: userB.idToken,
    });

    expect(status).toBe(403);
  });
});

describe("getProviderAccessToken provider validation", () => {
  it("returns 400 for provider 'osf' (the OSF identity flow is separate)", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const { status } = await callGetProviderAccessToken({ provider: "osf", uid, idToken });
    expect(status).toBe(400);
  });

  it("returns 400 for an unknown provider", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const { status } = await callGetProviderAccessToken({
      provider: "not-a-real-provider",
      uid,
      idToken,
    });
    expect(status).toBe(400);
  });
});

describe("getProviderAccessToken token resolution", () => {
  it("returns 400 surfacing PROVIDER_NOT_CONNECTED when no gdrive account is connected", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    // Deliberately no connectedAccounts.gdrive seeded.
    const { status, body } = await callGetProviderAccessToken({ provider: "gdrive", uid, idToken });

    expect(status).toBe(400);
    expect(body).toEqual(expect.objectContaining(MESSAGES.PROVIDER_NOT_CONNECTED));
  });

  it("returns 200 with the decrypted accessToken for a connected gdrive user, and nothing else", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);

    const { status, body } = await callGetProviderAccessToken({ provider: "gdrive", uid, idToken });

    expect(status).toBe(200);
    expect(body).toEqual({ accessToken: "get-token-plaintext-access-token" });
    // No refresh token or other user data leaks into the response.
    expect(Object.keys(body).sort()).toEqual(["accessToken"]);
  });
});
