/**
 * @jest-environment node
 */

// Emulator integration tests for oauth2-callback.ts, the OSF sign-in /
// account-linking endpoint. This file existed with ZERO tests before this
// change even though it decides between creating a Firebase user, signing an
// existing one in, or linking OSF onto an already-authenticated account, and
// it persists encrypted OSF tokens on `users/{uid}` -- see the module's own
// header for the full decision tree.
//
// Harness conventions follow oauth-connect-emulator.test.js and
// contact-email-verify-emulator.test.js: emulator env vars set at module
// scope BEFORE any import that reaches app.js, a NAMED admin app so the
// compiled module's bare initializeApp() does not collide with it, a dynamic
// import of the COMPILED crypto-utils module from functions/lib/ (so
// `npm --prefix functions run build` must run first), real HTTP calls
// against the running Functions emulator (an onRequest export is a
// CloudFunction object, not a plain callable (req, res) function -- see
// contact-email-verify-emulator.test.js's header), and real Auth-emulator
// idTokens from accounts:signUp for the account-linking cases.
//
// MOCK OSF SERVER: oauth2-callback.ts makes several real fetch() calls to
// OSF (token exchange, oauth2/profile, v2/users/:id, v2/users/:id/settings/
// emails). Those calls happen inside the Functions emulator's own process --
// a separate process from this jest file -- so there is no in-process
// fetch/nock seam reachable from here. This suite adds the SAME kind of
// test-only transport seam providers/zenodo.ts already has
// (emulatorServerOverride, gated on FUNCTIONS_EMULATOR): oauth2-callback.ts
// now reads OSF_API_BASE_OVERRIDE (see functions/.env.local) and, only under
// the emulator, redirects every accounts.osf.io/api.osf.io call to the one
// mock server this file starts on a fixed port (3591 -- see
// functions/.env.local for why that port). That is the only production-code
// change this suite required; outside the emulator (FUNCTIONS_EMULATOR
// unset) osfBaseOverride() always returns undefined, so the override is a
// no-op no matter what OSF_API_BASE_OVERRIDE holds.
//
// WHY NOT SPY ON console.* FOR THE "raw token never logged" CLAIM. Some
// sibling suites (mail-delivery-emulator.test.js) spy on console because they
// call the seam under test directly, in the SAME process as the test. This
// suite cannot do that: oauth2-callback.ts has no exported seam beneath the
// onRequest wrapper, and the wrapped handler executes inside the Functions
// emulator's process, not this one -- a console spy here would observe
// nothing the handler prints. What IS asserted, everywhere a token is in
// play, is that the raw access/refresh token string never appears anywhere
// in the HTTP response body -- the property that actually matters for a
// caller-facing leak, and the one this suite can verify directly.
//
// TOKEN_ENCRYPTION_KEY: this file's process sets the SAME fixed 64-hex value
// baked into functions/.env.local so the Firestore-persisted authToken/
// refreshToken -- written by the separate Functions-emulator process -- can
// be decrypted and verified here.
//
// Fixtures use randomUUID() throughout (codes, states, osf user ids, emails,
// uids) so this suite is safe to run alongside every other suite sharing the
// emulator.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";
import { fnUrl } from "./helpers/fn-url.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };

// Must match functions/.env.local exactly.
const TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
const OSF_PORT = 3591;

const CALLBACK_URL = fnUrl("/api/oauth2callback");
const GENERATE_STATE_URL = fnUrl("/api/generateoauthstate");
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

let db;
let decrypt;
let encrypt;
let mockOsf;

beforeAll(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = TOKEN_ENCRYPTION_KEY;
  ({ decrypt, encrypt } = await import("../../lib/crypto-utils.js"));

  let app;
  try {
    app = getApp("oauth2-callback-test");
  } catch {
    app = initializeApp(config, "oauth2-callback-test");
  }
  db = getFirestore(app);

  mockOsf = await createMockOsfServer();
});

afterAll(() => {
  mockOsf.server.close();
});

afterEach(async () => {
  mockOsf.reset();
  const batch = db.batch();
  for (const uid of created.uids) {
    batch.delete(db.doc(`users/${uid}`));
  }
  for (const state of created.states) {
    batch.delete(db.collection("oauth_states").doc(state));
  }
  await batch.commit();
  created.uids.length = 0;
  created.states.length = 0;
});

// ---------------------------------------------------------------------------
// Mock OSF server: token endpoint, oauth2/profile, v2/users/:id, and
// v2/users/:id/settings/emails. Records what it received so tests can assert
// on it; every response is reconfigurable per test via reset() in afterEach.
// ---------------------------------------------------------------------------

function createMockOsfServer() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  function defaultTokenResponse() {
    return {
      status: 200,
      body: {
        access_token: "default-access-token",
        refresh_token: "default-refresh-token",
        expires_in: 3600,
      },
    };
  }

  let tokenResponse = defaultTokenResponse();
  let profileResponse = { status: 200, body: { id: "default-osf-user-id" } };
  let userApiResponse = { status: 200, body: { data: { attributes: { full_name: "Default OSF User" } } } };
  let emailsResponse = { status: 200, body: { data: [] } };

  const receivedTokenRequests = [];
  const receivedProfileAuthHeaders = [];
  let profileCallCount = 0;
  let userApiCallCount = 0;
  let emailsCallCount = 0;

  app.post("/oauth2/token", (req, res) => {
    receivedTokenRequests.push({ ...req.body });
    const r = tokenResponse;
    if (r.text !== undefined) {
      res.status(r.status).send(r.text);
    } else {
      res.status(r.status).json(r.body);
    }
  });

  app.get("/oauth2/profile", (req, res) => {
    profileCallCount += 1;
    receivedProfileAuthHeaders.push(req.headers.authorization);
    res.status(profileResponse.status).json(profileResponse.body);
  });

  app.get("/v2/users/:id/", (req, res) => {
    userApiCallCount += 1;
    res.status(userApiResponse.status).json(userApiResponse.body);
  });

  app.get("/v2/users/:id/settings/emails/", (req, res) => {
    emailsCallCount += 1;
    res.status(emailsResponse.status).json(emailsResponse.body);
  });

  return new Promise((resolve) => {
    const server = app.listen(OSF_PORT, () => {
      resolve({
        server,
        setTokenResponse(status, body) {
          tokenResponse = { status, body };
        },
        setTokenResponseText(status, text) {
          tokenResponse = { status, text };
        },
        setProfile(status, body) {
          profileResponse = { status, body };
        },
        setUserApi(status, body) {
          userApiResponse = { status, body };
        },
        setEmails(status, body) {
          emailsResponse = { status, body };
        },
        getLastTokenRequest() {
          return receivedTokenRequests[receivedTokenRequests.length - 1];
        },
        getLastProfileAuthHeader() {
          return receivedProfileAuthHeaders[receivedProfileAuthHeaders.length - 1];
        },
        getProfileCallCount() {
          return profileCallCount;
        },
        getUserApiCallCount() {
          return userApiCallCount;
        },
        reset() {
          tokenResponse = defaultTokenResponse();
          profileResponse = { status: 200, body: { id: "default-osf-user-id" } };
          userApiResponse = { status: 200, body: { data: { attributes: { full_name: "Default OSF User" } } } };
          emailsResponse = { status: 200, body: { data: [] } };
          receivedTokenRequests.length = 0;
          receivedProfileAuthHeaders.length = 0;
          profileCallCount = 0;
          userApiCallCount = 0;
          emailsCallCount = 0;
        },
      });
    });
  });
}

// Configures the mock for a full happy-path OSF user in one call. Returns the
// access/refresh token values it wired up, so a test can assert the response
// never contains them and that Firestore decrypts back to exactly these.
function configureOsfHappyPath({
  osfUserId,
  email,
  fullName = "Test OSF User",
  accessToken = `access-${randomUUID()}`,
  refreshToken = `refresh-${randomUUID()}`,
  expiresIn = 3600,
} = {}) {
  mockOsf.setTokenResponse(200, { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn });
  mockOsf.setProfile(200, { id: osfUserId });
  mockOsf.setUserApi(200, { data: { attributes: { full_name: fullName } } });
  mockOsf.setEmails(200, {
    data: email ? [{ attributes: { primary: true, email_address: email } }] : [],
  });
  return { accessToken, refreshToken, expiresIn };
}

// ---------------------------------------------------------------------------
// Firestore / Auth-emulator / HTTP helpers
// ---------------------------------------------------------------------------

const created = { uids: [], states: [] };

async function signUpEmulatorUser() {
  const email = `oauth2-callback-${randomUUID()}@example.test`;
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

function callCallback(payload) {
  return postJson(CALLBACK_URL, payload);
}

// A state minted through the real generateOAuthState endpoint -- the legacy,
// provider-less OSF flow this callback expects.
async function generateState() {
  const { body } = await postJson(GENERATE_STATE_URL, {});
  created.states.push(body.state);
  return body.state;
}

// A state doc built directly, for cases generateOAuthState can't produce
// (expired, carrying a foreign `provider`, etc).
async function createStateDoc(overrides = {}) {
  const state = randomUUID();
  created.states.push(state);
  await db.collection("oauth_states").doc(state).set({
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
    ...overrides,
  });
  return state;
}

async function getStateDoc(state) {
  return db.collection("oauth_states").doc(state).get();
}

async function getUserDoc(uid) {
  return db.doc(`users/${uid}`).get();
}

function trackUid(uid) {
  created.uids.push(uid);
  return uid;
}

// ---------------------------------------------------------------------------
// 1. Happy path: new user
// ---------------------------------------------------------------------------

describe("happy path: new user via isSignup", () => {
  it("returns a custom token, persists an encrypted OSF connection, and consumes the state", async () => {
    const state = await generateState();
    const osfUserId = `osf-${randomUUID()}`;
    const email = `oauth2-cb-new-${randomUUID()}@example.test`;
    const { accessToken, refreshToken } = configureOsfHappyPath({ osfUserId, email, fullName: "Ada Researcher" });

    const before = Date.now();
    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      isSignup: true,
    });
    const after = Date.now();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.isNewUser).toBe(true);
    expect(typeof body.customToken).toBe("string");
    expect(body.customToken.length).toBeGreaterThan(0);
    expect(body.user.email).toBe(email);
    expect(body.user.displayName).toBe("Ada Researcher");
    const uid = trackUid(body.user.uid);

    // The raw tokens must never be echoed back to the caller.
    const rawResponse = JSON.stringify(body);
    expect(rawResponse).not.toContain(accessToken);
    expect(rawResponse).not.toContain(refreshToken);

    const userSnap = await getUserDoc(uid);
    expect(userSnap.exists).toBe(true);
    const userData = userSnap.data();
    expect(userData.osfUserId).toBe(osfUserId);
    expect(userData.authMethod).toBe("osf");
    expect(userData.email).toBe(email);
    expect(userData.usingPersonalToken).toBe(false);

    expect(userData.authToken.startsWith("v1:")).toBe(true);
    expect(userData.refreshToken.startsWith("v1:")).toBe(true);
    expect(decrypt(userData.authToken)).toBe(accessToken);
    expect(decrypt(userData.refreshToken)).toBe(refreshToken);

    expect(userData.authTokenExpires).toBeGreaterThanOrEqual(before + 3600 * 1000 - 5000);
    expect(userData.authTokenExpires).toBeLessThanOrEqual(after + 3600 * 1000 + 5000);

    const stateDoc = await getStateDoc(state);
    expect(stateDoc.exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Existing user matched by osfUserId signs in, tokens rotated
// ---------------------------------------------------------------------------

describe("sign-in via isSignup when osfUserId already matches an existing user", () => {
  it("signs into the same uid rather than creating a new one, and rotates the stored tokens", async () => {
    const uid = trackUid(`existing-${randomUUID()}`);
    const osfUserId = `osf-${randomUUID()}`;
    const email = `oauth2-cb-existing-${randomUUID()}@example.test`;

    await db.doc(`users/${uid}`).set({
      email,
      uid,
      osfUserId,
      displayName: "Old Name",
      authMethod: "osf",
      osfToken: "",
      osfTokenValid: false,
      usingPersonalToken: false,
      refreshToken: encrypt("stale-refresh-token"),
      refreshTokenExpires: Date.now() + 1000,
      authToken: encrypt("stale-access-token"),
      authTokenExpires: Date.now() + 1000,
      experiments: [],
      createdAt: Date.now() - 100000,
    });

    const state = await generateState();
    const { accessToken, refreshToken } = configureOsfHappyPath({ osfUserId, email });

    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      isSignup: true,
    });

    expect(status).toBe(200);
    expect(body.isNewUser).toBe(false);
    expect(body.user.uid).toBe(uid);
    expect(body.user.email).toBe(email);

    // Exactly one user document exists for this OSF id -- no duplicate was
    // created.
    const matches = await db.collection("users").where("osfUserId", "==", osfUserId).get();
    expect(matches.size).toBe(1);

    const userData = (await getUserDoc(uid)).data();
    expect(userData.displayName).toBe("Old Name"); // this branch never touches displayName
    expect(decrypt(userData.authToken)).toBe(accessToken);
    expect(decrypt(userData.refreshToken)).toBe(refreshToken);
    expect(decrypt(userData.authToken)).not.toBe("stale-access-token");
    expect(decrypt(userData.refreshToken)).not.toBe("stale-refresh-token");
  });
});

// ---------------------------------------------------------------------------
// 3. Link flow: an already-signed-in user links their OSF account
// ---------------------------------------------------------------------------

describe("linking OSF to an already-signed-in user", () => {
  it("links successfully when the body uid matches the authenticated idToken", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    trackUid(uid);
    const originalEmail = `oauth2-cb-link-${randomUUID()}@example.test`;
    await db.doc(`users/${uid}`).set({
      email: originalEmail,
      uid,
      displayName: "Link User",
      experiments: [],
      createdAt: Date.now(),
      usingPersonalToken: true,
    });

    const state = await generateState();
    const osfUserId = `osf-${randomUUID()}`;
    const osfEmail = `oauth2-cb-link-osf-${randomUUID()}@example.test`;
    const { accessToken, refreshToken } = configureOsfHappyPath({ osfUserId, email: osfEmail });

    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      uid,
      idToken,
      isSignup: false,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, isNewUser: false });

    const userData = (await getUserDoc(uid)).data();
    expect(userData.osfUserId).toBe(osfUserId);
    expect(userData.authMethod).toBe("osf");
    expect(userData.usingPersonalToken).toBe(false);
    expect(decrypt(userData.authToken)).toBe(accessToken);
    expect(decrypt(userData.refreshToken)).toBe(refreshToken);
    // Linking never touches the user's own email -- unlike signup, which
    // stores the OSF-reported one. The original DataPipe account email is
    // left exactly as it was.
    expect(userData.email).toBe(originalEmail);
    expect(userData.email).not.toBe(osfEmail);
  });

  it("returns 403 when the body uid does not match the authenticated idToken, and writes nothing", async () => {
    const userA = await signUpEmulatorUser();
    const userB = await signUpEmulatorUser();
    trackUid(userA.uid);
    trackUid(userB.uid);
    await db.doc(`users/${userA.uid}`).set({
      email: `oauth2-cb-a-${randomUUID()}@example.test`,
      uid: userA.uid,
      experiments: [],
      createdAt: Date.now(),
    });

    const state = await generateState();
    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      uid: userA.uid,
      idToken: userB.idToken,
      isSignup: false,
    });

    expect(status).toBe(403);
    expect(body.error).toBe("User ID does not match authenticated user");

    const userAData = (await getUserDoc(userA.uid)).data();
    expect(userAData.osfUserId).toBeUndefined();
  });

  it("returns 401 when idToken is missing for an account-linking request", async () => {
    const uid = `oauth2-cb-no-token-${randomUUID()}`;
    const state = await generateState();

    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      uid,
      isSignup: false,
    });

    expect(status).toBe(401);
    expect(body.error).toBe("Authentication required for account linking");
  });

  it("returns 401 for a garbage idToken", async () => {
    const uid = `oauth2-cb-garbage-token-${randomUUID()}`;
    const state = await generateState();

    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      uid,
      idToken: "not-a-real-token",
      isSignup: false,
    });

    expect(status).toBe(401);
    expect(body.error).toBe("Invalid authentication token");
  });
});

// ---------------------------------------------------------------------------
// 4. State validation
// ---------------------------------------------------------------------------

describe("state validation", () => {
  it("rejects an unknown state", async () => {
    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state: randomUUID(),
      isSignup: true,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid state parameter");
  });

  it("rejects and deletes an expired state", async () => {
    const state = await createStateDoc({ expiresAt: Date.now() - 1000 });

    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      isSignup: true,
    });

    expect(status).toBe(400);
    expect(body.error).toBe("State parameter has expired");
    expect((await getStateDoc(state)).exists).toBe(false);
  });

  it("rejects a reused (already-consumed) state", async () => {
    const state = await generateState();
    const osfUserId = `osf-${randomUUID()}`;
    configureOsfHappyPath({ osfUserId, email: `oauth2-cb-reuse-${randomUUID()}@example.test` });

    const first = await callCallback({ code: `code-a-${randomUUID()}`, state, isSignup: true });
    expect(first.status).toBe(200);
    trackUid(first.body.user.uid);

    const second = await callCallback({ code: `code-b-${randomUUID()}`, state, isSignup: true });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("Invalid state parameter");
  });

  // KNOWN ASYMMETRY: oauth2-callback.ts never reads stateData.provider. A
  // state doc minted for (or otherwise carrying) an unrelated provider is
  // accepted exactly like an OSF-flow state -- there is no check tying the
  // state's intended provider to this endpoint at all. This is a real
  // asymmetry with connect-provider.ts's connectProvider, which DOES enforce
  // that match (see oauth-connect-emulator.test.js, case 5: "rejects a state
  // issued without a provider ... as a provider mismatch"). Pinning current
  // behavior here, not endorsing it -- flagged in the report as a KNOWN bug
  // for the owner to decide on.
  it("KNOWN: accepts a state minted for a different provider -- provider is never checked", async () => {
    const state = await createStateDoc({ provider: "zenodo" });
    const osfUserId = `osf-${randomUUID()}`;
    configureOsfHappyPath({
      osfUserId,
      email: `oauth2-cb-foreign-provider-${randomUUID()}@example.test`,
    });

    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      isSignup: true,
    });

    expect(status).toBe(200);
    trackUid(body.user.uid);
  });
});

// ---------------------------------------------------------------------------
// 5. Authorization code replay guard
// ---------------------------------------------------------------------------

describe("authorization code replay guard", () => {
  // KNOWN: processedCodes (oauth2-callback.ts) is an in-memory Map on the
  // function's module instance, not a shared/persistent store. This test
  // only demonstrates the guard because the Functions emulator keeps one
  // warm instance across these two sequential requests; a cold-started
  // sibling instance in production would not share that Map, so this is not
  // a durable replay defense across instances, regions, or deploys.
  it("rejects the same code presented twice against this instance", async () => {
    const code = `replay-${randomUUID()}`;

    const state1 = await generateState();
    configureOsfHappyPath({
      osfUserId: `osf-${randomUUID()}`,
      email: `oauth2-cb-replay-1-${randomUUID()}@example.test`,
    });
    const first = await callCallback({ code, state: state1, isSignup: true });
    expect(first.status).toBe(200);
    trackUid(first.body.user.uid);

    const state2 = await generateState();
    const { status, body } = await callCallback({ code, state: state2, isSignup: true });

    expect(status).toBe(400);
    expect(body.error).toBe("Authorization code already processed");

    // The replay check fires before state is even looked at, so the second
    // (unrelated) state was never consumed.
    expect((await getStateDoc(state2)).exists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Email collision with an existing password account
// ---------------------------------------------------------------------------

describe("OSF email collision with an existing password account", () => {
  it("KNOWN: signup is refused before any OSF-linked account is created, when the OSF email belongs to a password account", async () => {
    const passwordUid = trackUid(`password-${randomUUID()}`);
    const email = `oauth2-cb-collision-${randomUUID()}@example.test`;
    await db.doc(`users/${passwordUid}`).set({
      email,
      uid: passwordUid,
      experiments: [],
      createdAt: Date.now(),
      // No authMethod field -- exactly how an email/password account is left
      // by the rest of this codebase. oauth2-callback.ts treats any
      // authMethod !== 'osf' (including "no field at all") as a conflict.
    });

    const state = await generateState();
    const osfUserId = `osf-${randomUUID()}`;
    configureOsfHappyPath({ osfUserId, email });

    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      isSignup: true,
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/already exists using email\/password authentication/);

    const matches = await db.collection("users").where("osfUserId", "==", osfUserId).get();
    expect(matches.size).toBe(0);

    const passwordData = (await getUserDoc(passwordUid)).data();
    expect(passwordData.authMethod).toBeUndefined();
    expect(passwordData.osfUserId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. OSF profile with no usable email
// ---------------------------------------------------------------------------

describe("OSF profile with no usable email", () => {
  it("falls back to the synthetic user-{osfUserId}@osf.io address", async () => {
    const state = await generateState();
    const osfUserId = `osf-${randomUUID()}`;
    configureOsfHappyPath({ osfUserId, email: undefined, fullName: "No Email User" });

    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      isSignup: true,
    });

    expect(status).toBe(200);
    const expectedEmail = `user-${osfUserId}@osf.io`;
    expect(body.user.email).toBe(expectedEmail);
    trackUid(body.user.uid);

    const userData = (await getUserDoc(body.user.uid)).data();
    expect(userData.email).toBe(expectedEmail);
  });
});

// ---------------------------------------------------------------------------
// 8. OSF token endpoint failure
// ---------------------------------------------------------------------------

describe("OSF token exchange failure", () => {
  it("returns a clean error response with no user document and no partial writes", async () => {
    const state = await generateState();
    mockOsf.setTokenResponseText(400, "invalid_grant");

    const { status, body } = await callCallback({
      code: `code-${randomUUID()}`,
      state,
      isSignup: true,
    });

    expect(status).toBe(400);
    expect(body.error).toBe("Token exchange failed");
    expect(body.status).toBe(400);

    // Never got far enough to call the profile endpoint, so no osfUserId was
    // even obtained -- confirming no partial write could have happened.
    expect(mockOsf.getProfileCallCount()).toBe(0);

    // The state is still consumed: it's deleted before the token exchange.
    expect((await getStateDoc(state)).exists).toBe(false);
  });
});
