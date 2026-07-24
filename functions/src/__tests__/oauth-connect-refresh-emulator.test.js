/**
 * @jest-environment node
 */

// RED-phase test for step 4b (scratchpad/step4b-oauth-connect-spec.md), case
// 10 of the test plan.
//
// refreshExpiringGdriveTokens does not exist yet -- the spec calls for it to
// be extracted out of scheduled-token-refresh.ts (which today only knows the
// OSF refresh pass) as a new exported helper, sharing its actual refresh
// logic with resolve-token.ts via a shared providers/gdrive-oauth.ts module.
// Importing a named export that the compiled module doesn't provide fails at
// ESM module-evaluation time ("does not provide an export named
// 'refreshExpiringGdriveTokens'"), which fails EVERY test in whatever file
// performs the import -- so this case lives in its own file, per the
// build-step instructions, to keep that red from masking the
// connectProvider/disconnectProvider/generateOAuthState cases in
// oauth-connect-emulator.test.js or the OSF regression guard in
// oauth-connect-scheduled-regression.test.js.
//
// This test never touches port 3580 (the mock token server used by the
// connectProvider tests): it mocks global.fetch directly, in-process, the
// same way resolve-token-gdrive.test.js's cases 9-10 do for resolveToken's
// gdrive refresh path. TOKEN_ENCRYPTION_KEY/GDRIVE_* env vars here are
// scoped to this jest process only and don't need to match
// functions/.env.datapipe-test (which is loaded by the separate Functions-
// emulator process for the HTTP-endpoint tests).

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { refreshExpiringGdriveTokens } from "../../lib/scheduled-token-refresh.js";
import { decrypt } from "../../lib/crypto-utils.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };

let db;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = {
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
  GDRIVE_TOKEN_URL: process.env.GDRIVE_TOKEN_URL,
  GDRIVE_CLIENT_ID: process.env.GDRIVE_CLIENT_ID,
  GDRIVE_CLIENT_SECRET: process.env.GDRIVE_CLIENT_SECRET,
};

beforeAll(async () => {
  let app;
  try {
    app = getApp("oauth-connect-refresh-test");
  } catch {
    app = initializeApp(config, "oauth-connect-refresh-test");
  }
  db = getFirestore(app);

  // Scoped to this process only -- mirrors resolve-token-gdrive.test.js.
  process.env.TOKEN_ENCRYPTION_KEY = "22".repeat(32);
  process.env.GDRIVE_TOKEN_URL = "https://gdrive-token.mock.test/token";
  process.env.GDRIVE_CLIENT_ID = "test-gdrive-client-id-refresh";
  process.env.GDRIVE_CLIENT_SECRET = "test-gdrive-client-secret-refresh";
});

afterAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_ENV.TOKEN_ENCRYPTION_KEY;
  process.env.GDRIVE_TOKEN_URL = ORIGINAL_ENV.GDRIVE_TOKEN_URL;
  process.env.GDRIVE_CLIENT_ID = ORIGINAL_ENV.GDRIVE_CLIENT_ID;
  process.env.GDRIVE_CLIENT_SECRET = ORIGINAL_ENV.GDRIVE_CLIENT_SECRET;
  global.fetch = ORIGINAL_FETCH;
});

// The helper legitimately scans the ENTIRE users collection, and the
// Firestore emulator is shared across parallel jest workers — other suites
// (resolve-token-gdrive, gdrive-emulator, oauth-connect) seed their own
// gdrive users, some deliberately expired, which this helper WILL pick up
// mid-run. Two isolation rules follow:
//   1. Never assert on global fetch call counts — only on calls carrying
//      THIS test's (unique) refresh token.
//   2. The fetch mock must answer foreign refresh tokens with a failure —
//      the helper's failure path leaves the user untouched, so we can't
//      corrupt another suite's seeded tokens.
function installDiscriminatingFetchMock(ownToken, ownResponse) {
  global.fetch = jest.fn(async (_url, options) => {
    const params = new URLSearchParams(options?.body);
    if (params.get("refresh_token") === ownToken) {
      return ownResponse;
    }
    return { ok: false, status: 400, text: () => Promise.resolve("foreign-token-rejected") };
  });
}

function callsForToken(token) {
  return global.fetch.mock.calls.filter(([, options]) => {
    const params = new URLSearchParams(options?.body);
    return params.get("refresh_token") === token;
  });
}

const WINDOW_MS = 10 * 60 * 1000; // matches the spec's default window

async function createGdriveUser(uid, overrides = {}) {
  const gdrive = {
    authMethod: "oauth2",
    encryptedToken: "plain-access-token",
    encryptedRefreshToken: "plain-refresh-token",
    tokenExpiresAt: Date.now() + 60 * 60 * 1000,
    ...overrides,
  };
  await db.collection("users").doc(uid).set({ connectedAccounts: { gdrive } });
  return gdrive;
}

async function getUserData(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.data();
}

describe("10. refreshExpiringGdriveTokens", () => {
  it("refreshes and persists a new encrypted token for a user inside the window", async () => {
    const uid = `refresh-window-${randomUUID()}`;
    const ownRefreshToken = `own-refresh-${randomUUID()}`;
    await createGdriveUser(uid, {
      tokenExpiresAt: Date.now() + 2 * 60 * 1000,
      encryptedRefreshToken: ownRefreshToken,
    });

    installDiscriminatingFetchMock(ownRefreshToken, {
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "refreshed-token",
          expires_in: 3600,
          refresh_token: "refreshed-refresh-token",
        }),
    });

    const before = Date.now();
    await refreshExpiringGdriveTokens(WINDOW_MS);
    const after = Date.now();

    expect(callsForToken(ownRefreshToken)).toHaveLength(1);
    const persisted = await getUserData(uid);
    const gdrive = persisted.connectedAccounts.gdrive;
    expect(decrypt(gdrive.encryptedToken)).toBe("refreshed-token");
    expect(decrypt(gdrive.encryptedRefreshToken)).toBe("refreshed-refresh-token");
    expect(gdrive.tokenExpiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 5000);
    expect(gdrive.tokenExpiresAt).toBeLessThanOrEqual(after + 3600 * 1000 + 5000);
  });

  it("leaves a user outside the window untouched and never calls fetch for them", async () => {
    const uid = `refresh-outside-${randomUUID()}`;
    const ownRefreshToken = `outside-refresh-${randomUUID()}`;
    const original = await createGdriveUser(uid, {
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      encryptedRefreshToken: ownRefreshToken,
    });

    installDiscriminatingFetchMock(ownRefreshToken, {
      ok: true,
      json: () => Promise.resolve({ access_token: "should-never-be-used", expires_in: 3600 }),
    });

    await refreshExpiringGdriveTokens(WINDOW_MS);

    expect(callsForToken(ownRefreshToken)).toHaveLength(0);
    const persisted = await getUserData(uid);
    expect(persisted.connectedAccounts.gdrive).toEqual(original);
  });

  it("leaves the connection as-was and does not throw when the refresh request fails", async () => {
    const uid = `refresh-fail-${randomUUID()}`;
    const ownRefreshToken = `fail-refresh-${randomUUID()}`;
    const original = await createGdriveUser(uid, {
      tokenExpiresAt: Date.now() + 2 * 60 * 1000,
      encryptedRefreshToken: ownRefreshToken,
    });

    installDiscriminatingFetchMock(ownRefreshToken, {
      ok: false,
      status: 400,
      text: () => Promise.resolve("invalid_grant"),
    });

    await expect(refreshExpiringGdriveTokens(WINDOW_MS)).resolves.not.toThrow();

    expect(callsForToken(ownRefreshToken)).toHaveLength(1);
    const persisted = await getUserData(uid);
    expect(persisted.connectedAccounts.gdrive).toEqual(original);
  });
});
