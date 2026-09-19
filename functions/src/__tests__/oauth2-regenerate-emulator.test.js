/**
 * @jest-environment node
 */

// Emulator integration tests for oauth2-regenerate.ts, the endpoint that
// mints a fresh OSF access token from a stored refresh token. Like
// oauth2-callback.ts, this had ZERO tests before this change.
//
// SCOPE: this file covers the ownership check (401/403) and every
// pre-refresh validation gate (missing uid, no user doc, not using OAuth, no
// refresh token on file) -- all of which return before refreshAndUpdateUser
// (refresh-token.ts) makes its real fetch() call to OSF's accounts.osf.io.
//
// It deliberately does NOT cover the happy path (a successful token
// refresh). Doing that would require refresh-token.ts to have the same
// emulator-only transport seam this task added to oauth2-callback.ts -- and
// the task scoped that production-code change to oauth2-callback.ts only, to
// keep this a pure coverage change. Without a seam, a happy-path test here
// would either mock module internals (fragile, and not how any sibling
// emulator suite in this repo works) or make a REAL network call to OSF's
// accounts.osf.io -- exactly the hazard docs/provider-migration-design.md
// records happening once already. So: not covered here. If the owner wants
// this closed, refresh-token.ts needs its own OSF_API_BASE_OVERRIDE-style
// seam (or an injectable fetch), then a follow-up test.
//
// Harness conventions match oauth2-callback-emulator.test.js /
// contact-email-verify-emulator.test.js: emulator env vars at module scope,
// a named admin app, real Auth-emulator idTokens, real HTTP calls against
// the Functions emulator (onRequest exports aren't plain callables).

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { fnUrl } from "./helpers/fn-url.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
const REGENERATE_URL = fnUrl("/api/oauth2regenerate");
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

let db;

beforeAll(() => {
  let app;
  try {
    app = getApp("oauth2-regenerate-test");
  } catch {
    app = initializeApp(config, "oauth2-regenerate-test");
  }
  db = getFirestore(app);
});

const created = { uids: [] };

afterEach(async () => {
  const batch = db.batch();
  for (const uid of created.uids) {
    batch.delete(db.doc(`users/${uid}`));
  }
  await batch.commit();
  created.uids.length = 0;
});

async function signUpEmulatorUser() {
  const email = `oauth2-regenerate-${randomUUID()}@example.test`;
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

async function callRegenerate(uid, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken !== undefined) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(REGENERATE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(uid !== undefined ? { uid } : {}),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function trackUid(uid) {
  created.uids.push(uid);
  return uid;
}

describe("auth and request shape", () => {
  it("rejects non-POST methods", async () => {
    const res = await fetch(REGENERATE_URL, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("400 when uid is missing", async () => {
    const { status } = await callRegenerate(undefined, "irrelevant");
    expect(status).toBe(400);
  });

  it("401 when the Authorization header is missing", async () => {
    const { status, body } = await callRegenerate(`oauth2-regen-${randomUUID()}`, undefined);
    expect(status).toBe(401);
    expect(body.error).toBe("Authentication required");
  });

  it("401 for a garbage bearer token", async () => {
    const { status, body } = await callRegenerate(`oauth2-regen-${randomUUID()}`, "not-a-real-token");
    expect(status).toBe(401);
    expect(body.error).toBe("Invalid authentication token");
  });

  it("403 when uid does not match the authenticated idToken, and reads nothing from Firestore", async () => {
    const userA = await signUpEmulatorUser();
    const userB = await signUpEmulatorUser();
    trackUid(userA.uid);
    trackUid(userB.uid);
    await db.doc(`users/${userA.uid}`).set({
      email: `oauth2-regen-a-${randomUUID()}@example.test`,
      uid: userA.uid,
      experiments: [],
      usingPersonalToken: false,
      refreshToken: "irrelevant-would-only-be-read-past-this-check",
    });

    const { status, body } = await callRegenerate(userA.uid, userB.idToken);
    expect(status).toBe(403);
    expect(body.error).toBe("User ID does not match authenticated user");
  });
});

describe("pre-refresh validation gates", () => {
  it("INVALID_OWNER when there is no user document for uid", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    trackUid(uid);
    // Deliberately no users/{uid} doc.

    const { status, body } = await callRegenerate(uid, idToken);
    expect(status).toBe(400);
    expect(body.error).toBe("INVALID_OWNER");
  });

  it("NOT_USING_OAUTH when the user is on a personal token, not OAuth", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    trackUid(uid);
    await db.doc(`users/${uid}`).set({
      email: `oauth2-regen-pat-${randomUUID()}@example.test`,
      uid,
      experiments: [],
      usingPersonalToken: true,
      osfToken: "some-static-token",
    });

    const { status, body } = await callRegenerate(uid, idToken);
    expect(status).toBe(400);
    expect(body.error).toBe("NOT_USING_OAUTH");
  });

  it("OAUTH_NOT_SETUP when usingPersonalToken is false but there is no refreshToken on file", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    trackUid(uid);
    await db.doc(`users/${uid}`).set({
      email: `oauth2-regen-norefresh-${randomUUID()}@example.test`,
      uid,
      experiments: [],
      usingPersonalToken: false,
      // no refreshToken field
    });

    const { status, body } = await callRegenerate(uid, idToken);
    expect(status).toBe(400);
    expect(body.error).toBe("OAUTH_NOT_SETUP");
  });
});
