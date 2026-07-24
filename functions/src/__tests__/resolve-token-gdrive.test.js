/**
 * @jest-environment node
 */

// RED-phase unit tests for step 4a (docs/provider-migration-design.md,
// scratchpad/step4a-gdrive-adapter-spec.md), cases 8-11 of the test plan.
//
// resolve-token.ts currently only understands the OSF/PAT dispatch (see
// resolveToken's source: it branches on user_data.usingPersonalToken and
// user_data.authTokenExpires with no awareness of exp_data.storageProvider
// at all). Cases 8-10 below exercise a gdrive branch that does not exist yet:
//   - case 8 fails because resolveToken falls through to the OAuth/OSF path,
//     which reads user_data.authToken (undefined for a gdrive-only user) and
//     returns { success: true, token: undefined } instead of dispatching on
//     exp_data.storageProvider === "gdrive".
//   - case 9/10 fail for the same reason: no refresh-POST is ever made (the
//     OSF path calls refreshAndUpdateUser against the OSF token endpoint, not
//     GDRIVE_TOKEN_URL), so global.fetch is never called and nothing is
//     persisted to connectedAccounts.gdrive.
//   - case 11 is a regression guard: it exercises the existing
//     usingPersonalToken branch, completely untouched by the gdrive
//     generalization, and is expected to PASS today. If a future edit to
//     resolve-token.ts ever breaks it, that's a real regression, not an
//     artifact of this RED phase.
//
// Persistence style follows collision-cache.test.js / upload-queue.test.js:
// a Firestore-emulator-backed app imported by its compiled lib/ output, one
// freshly-generated uid per test.
//
// Token encoding: per crypto-utils.ts, decrypt() has a plaintext fallback --
// any value not prefixed with "v1:" is returned unchanged. Seeded tokens that
// are never expected to be *re-encrypted and re-read back* by this file use
// that fallback directly (mirrors how existing OSF emulator tests seed
// osfToken: "valid"). Case 9 is the exception: it asserts that resolveToken
// itself calls encrypt() when persisting the refreshed token, so this file
// sets its own TOKEN_ENCRYPTION_KEY and decrypts the persisted value back --
// entirely self-consistent within this one process, and unrelated to
// whatever key the Functions emulator loads from functions/.env for the
// separate gdrive-emulator.test.js integration run (which never exercises
// real encryption -- see that file's header comment).
//
// resolve-token.ts's existing refresh call (refreshAndUpdateUser, in
// refresh-token.ts) uses the runtime's global `fetch`, not the "node-fetch"
// package -- only the OSF file-upload modules (put-file-osf.ts,
// update-file-osf.ts) import node-fetch explicitly, per providers-osf.test.js's
// header comment. The gdrive refresh branch is expected to follow its
// sibling module's convention, so this file mocks global.fetch rather than
// the "node-fetch" module.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import resolveToken from "../../lib/resolve-token.js";
import { decrypt } from "../../lib/crypto-utils.js";

// TOKEN_ENCRYPTION_KEY is read lazily inside crypto-utils.ts's encrypt()/
// decrypt() (via getKey(), called per-invocation, not cached at module
// load), so it's safe to import resolveToken/crypto-utils statically here
// and only set the key in beforeAll below, before any test actually calls
// them.
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };

let db;

const ORIGINAL_ENV = {
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
  GDRIVE_TOKEN_URL: process.env.GDRIVE_TOKEN_URL,
  GDRIVE_CLIENT_ID: process.env.GDRIVE_CLIENT_ID,
  GDRIVE_CLIENT_SECRET: process.env.GDRIVE_CLIENT_SECRET,
};
const ORIGINAL_FETCH = global.fetch;

beforeAll(async () => {
  let app;
  try {
    app = getApp("resolve-token-gdrive-test");
  } catch {
    app = initializeApp(config, "resolve-token-gdrive-test");
  }
  db = getFirestore(app);

  // A valid-shaped (64 hex char) key, scoped to this process only -- see
  // header comment on why this doesn't need to match functions/.env.
  process.env.TOKEN_ENCRYPTION_KEY = "11".repeat(32);
  process.env.GDRIVE_TOKEN_URL = "https://gdrive-token.mock.test/token";
  process.env.GDRIVE_CLIENT_ID = "test-gdrive-client-id";
  process.env.GDRIVE_CLIENT_SECRET = "test-gdrive-client-secret";
});

afterAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_ENV.TOKEN_ENCRYPTION_KEY;
  process.env.GDRIVE_TOKEN_URL = ORIGINAL_ENV.GDRIVE_TOKEN_URL;
  process.env.GDRIVE_CLIENT_ID = ORIGINAL_ENV.GDRIVE_CLIENT_ID;
  process.env.GDRIVE_CLIENT_SECRET = ORIGINAL_ENV.GDRIVE_CLIENT_SECRET;
  global.fetch = ORIGINAL_FETCH;
});

beforeEach(() => {
  global.fetch = jest.fn();
});

// A tolerance window for timestamp assertions -- generous enough to absorb
// emulator/test round-trip latency without hiding a genuinely wrong duration
// (mirrors collision-cache.test.js's TOLERANCE_MS).
const TOLERANCE_MS = 5000;

function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

async function createGdriveUser(uid, overrides = {}) {
  const gdrive = {
    authMethod: "oauth2",
    encryptedToken: "plain-access-token",
    encryptedRefreshToken: "plain-refresh-token",
    tokenExpiresAt: Date.now() + 60 * 60 * 1000,
    providerAccountId: "acct-1",
    ...overrides,
  };
  await db.collection("users").doc(uid).set({ connectedAccounts: { gdrive } });
  return gdrive;
}

async function getUserData(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.data();
}

describe("8. unexpired gdrive token", () => {
  it("returns the decrypted token directly, without calling the token endpoint", async () => {
    const uid = `gdrive-resolve-8-${randomUUID()}`;
    await createGdriveUser(uid, { encryptedToken: "unexpired-access-token-8" });
    const userData = await getUserData(uid);
    const expData = { storageProvider: "gdrive", owner: uid };

    const result = await resolveToken(userData, expData);

    expect(result).toEqual({ success: true, token: "unexpired-access-token-8" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("9. expired gdrive token triggers a refresh", () => {
  it("POSTs the refresh grant with client credentials, and persists the new token/expiry encrypted, including refresh-token rotation", async () => {
    const uid = `gdrive-resolve-9-${randomUUID()}`;
    await createGdriveUser(uid, {
      encryptedToken: "stale-access-token-9",
      encryptedRefreshToken: "refresh-token-9",
      tokenExpiresAt: Date.now() - 1000, // already expired
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-access-token-9",
          expires_in: 3600,
          refresh_token: "new-refresh-token-9",
        }),
    });

    const userData = await getUserData(uid);
    const expData = { storageProvider: "gdrive", owner: uid };

    const before = Date.now();
    const result = await resolveToken(userData, expData);
    const after = Date.now();

    expect(result).toEqual({ success: true, token: "new-access-token-9" });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(process.env.GDRIVE_TOKEN_URL);
    expect(options.method).toBe("POST");
    expect(header(options.headers, "Content-Type")).toContain("application/x-www-form-urlencoded");

    const bodyParams = new URLSearchParams(options.body);
    expect(bodyParams.get("grant_type")).toBe("refresh_token");
    expect(bodyParams.get("refresh_token")).toBe("refresh-token-9");
    expect(bodyParams.get("client_id")).toBe("test-gdrive-client-id");
    expect(bodyParams.get("client_secret")).toBe("test-gdrive-client-secret");

    const persisted = await getUserData(uid);
    const gdrive = persisted.connectedAccounts.gdrive;
    expect(decrypt(gdrive.encryptedToken)).toBe("new-access-token-9");
    expect(decrypt(gdrive.encryptedRefreshToken)).toBe("new-refresh-token-9"); // rotated
    expect(gdrive.tokenExpiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - TOLERANCE_MS);
    expect(gdrive.tokenExpiresAt).toBeLessThanOrEqual(after + 3600 * 1000 + TOLERANCE_MS);
  });

  it("keeps the existing refresh token when the response does not include a rotated one", async () => {
    const uid = `gdrive-resolve-9b-${randomUUID()}`;
    await createGdriveUser(uid, {
      encryptedToken: "stale-access-token-9b",
      encryptedRefreshToken: "refresh-token-9b-unrotated",
      tokenExpiresAt: Date.now() - 1000,
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-access-token-9b",
          expires_in: 1800,
          // no refresh_token field -- no rotation offered
        }),
    });

    const userData = await getUserData(uid);
    const expData = { storageProvider: "gdrive", owner: uid };

    const result = await resolveToken(userData, expData);

    expect(result).toEqual({ success: true, token: "new-access-token-9b" });

    const persisted = await getUserData(uid);
    const gdrive = persisted.connectedAccounts.gdrive;
    expect(decrypt(gdrive.encryptedToken)).toBe("new-access-token-9b");
    expect(decrypt(gdrive.encryptedRefreshToken)).toBe("refresh-token-9b-unrotated");
  });
});

describe("10. resolve failures", () => {
  it("returns INVALID_REFRESH_TOKEN when the refresh request fails", async () => {
    const uid = `gdrive-resolve-10a-${randomUUID()}`;
    await createGdriveUser(uid, {
      encryptedToken: "stale-access-token-10a",
      encryptedRefreshToken: "bad-refresh-token-10a",
      tokenExpiresAt: Date.now() - 1000,
    });

    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve("invalid_grant"),
    });

    const userData = await getUserData(uid);
    const expData = { storageProvider: "gdrive", owner: uid };

    const result = await resolveToken(userData, expData);

    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_REFRESH_TOKEN");
    expect(typeof result.detail).toBe("string");
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it("returns PROVIDER_NOT_CONNECTED when the user has no connectedAccounts.gdrive at all", async () => {
    const uid = `gdrive-resolve-10b-${randomUUID()}`;
    await db.collection("users").doc(uid).set({}); // no connectedAccounts field whatsoever

    const userData = await getUserData(uid);
    const expData = { storageProvider: "gdrive", owner: uid };

    const result = await resolveToken(userData, expData);

    expect(result.success).toBe(false);
    expect(result.error).toBe("PROVIDER_NOT_CONNECTED");
    expect(typeof result.detail).toBe("string");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("11. osf-experiment dispatch unchanged (regression guard)", () => {
  it("still returns the decrypted PAT for a personal-token OSF user -- expected to PASS today, unaffected by the gdrive generalization", async () => {
    const userData = {
      usingPersonalToken: true,
      osfTokenValid: true,
      osfToken: "valid-osf-pat-11",
    };
    // storageProvider deliberately absent -- legacy OSF experiment.
    const expData = { owner: "osf-owner-11" };

    const result = await resolveToken(userData, expData);

    expect(result).toEqual({ success: true, token: "valid-osf-pat-11" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
