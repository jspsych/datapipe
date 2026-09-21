/**
 * @jest-environment node
 */

// Firestore-emulator-backed tests for zenodo-oauth.ts, following
// resolve-token-gdrive.test.js's harness exactly (own admin app for fixtures,
// one fresh uid per test, global.fetch mocked because zenodo-oauth.ts uses the
// runtime's fetch rather than the node-fetch package).
//
// WHAT MAKES THIS WORTH A SEPARATE FILE FROM providers-zenodo.test.js: Zenodo
// rotates the refresh token on EVERY refresh and deletes the previous one
// server-side (invenio-oauth2server's save_token: "make sure that every client
// has only one token connected to a user"). That is not a detail -- it means
// persistence is part of the refresh's correctness, not a side effect, so
// these cases have to assert what landed in Firestore rather than just what
// the function returned. Mocks alone cannot express the failure it guards
// against.

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { refreshZenodoToken, EXPIRY_MARGIN_MS } from "../../lib/providers/zenodo-oauth.js";
import { decrypt, encrypt } from "../../lib/crypto-utils.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

jest.setTimeout(30000);

let db;

const ORIGINAL_ENV = {
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
  ZENODO_TOKEN_URL: process.env.ZENODO_TOKEN_URL,
  ZENODO_CLIENT_ID: process.env.ZENODO_CLIENT_ID,
  ZENODO_CLIENT_SECRET: process.env.ZENODO_CLIENT_SECRET,
};
const ORIGINAL_FETCH = global.fetch;

const TOLERANCE_MS = 5000;

beforeAll(() => {
  let app;
  try {
    app = getApp("zenodo-oauth-test");
  } catch {
    app = initializeApp({ projectId: "datapipe-test" }, "zenodo-oauth-test");
  }
  db = getFirestore(app);

  process.env.TOKEN_ENCRYPTION_KEY = "22".repeat(32);
  process.env.ZENODO_TOKEN_URL = "https://zenodo-token.mock.test/oauth/token";
  process.env.ZENODO_CLIENT_ID = "test-zenodo-client-id";
  process.env.ZENODO_CLIENT_SECRET = "test-zenodo-client-secret";
});

afterAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_ENV.TOKEN_ENCRYPTION_KEY;
  process.env.ZENODO_TOKEN_URL = ORIGINAL_ENV.ZENODO_TOKEN_URL;
  process.env.ZENODO_CLIENT_ID = ORIGINAL_ENV.ZENODO_CLIENT_ID;
  process.env.ZENODO_CLIENT_SECRET = ORIGINAL_ENV.ZENODO_CLIENT_SECRET;
  global.fetch = ORIGINAL_FETCH;
});

beforeEach(() => {
  global.fetch = jest.fn();
});

function tokenResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function errorResponse(text, status = 400) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(text),
  };
}

// Seeds users/{uid} and returns both the uid and the connection object a
// caller would have read a moment earlier. Tests that model a race pass a
// DIFFERENT connection than what was stored.
async function seedUser(overrides = {}) {
  const uid = `zenodo-oauth-${randomUUID()}`;
  const connection = {
    authMethod: "oauth2",
    encryptedToken: encrypt("access-old"),
    encryptedRefreshToken: encrypt("refresh-old"),
    tokenExpiresAt: Date.now() - 1000,
    ...overrides,
  };
  await db.doc(`users/${uid}`).set({ connectedAccounts: { zenodo: connection } });
  return { uid, connection };
}

async function readConnection(uid) {
  const snap = await db.doc(`users/${uid}`).get();
  return snap.data().connectedAccounts.zenodo;
}

describe("refreshZenodoToken: the ordinary path", () => {
  it("exchanges the refresh token and persists the new access token", async () => {
    const { uid, connection } = await seedUser();
    global.fetch.mockResolvedValueOnce(
      tokenResponse({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600 })
    );

    const result = await refreshZenodoToken(uid, connection);

    expect(result).toEqual({ success: true, accessToken: "access-new" });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("https://zenodo-token.mock.test/oauth/token");
    const body = new URLSearchParams(options.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-old");
    expect(body.get("client_id")).toBe("test-zenodo-client-id");

    const stored = await readConnection(uid);
    expect(decrypt(stored.encryptedToken)).toBe("access-new");
    expect(stored.tokenExpiresAt).toBeGreaterThan(Date.now() + 3600 * 1000 - TOLERANCE_MS);
  });

  // THE ONE THAT MATTERS MOST. Zenodo has already deleted "refresh-old" by the
  // time we get this response; failing to store "refresh-new" would leave the
  // researcher permanently unable to write data, mid-experiment, with no
  // symptom until the access token lapses an hour later.
  it("persists the rotated refresh token, not just the access token", async () => {
    const { uid, connection } = await seedUser();
    global.fetch.mockResolvedValueOnce(
      tokenResponse({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600 })
    );

    await refreshZenodoToken(uid, connection);

    const stored = await readConnection(uid);
    expect(decrypt(stored.encryptedRefreshToken)).toBe("refresh-new");
  });

  it("keeps the previous refresh token when the response omits one", async () => {
    const { uid, connection } = await seedUser();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch.mockResolvedValueOnce(
      tokenResponse({ access_token: "access-new", expires_in: 3600 })
    );

    const result = await refreshZenodoToken(uid, connection);

    expect(result.success).toBe(true);
    // Keeping a probably-dead token beats clearing the field: it leaves the
    // next refresh something to fail loudly on rather than a missing property.
    expect(decrypt((await readConnection(uid)).encryptedRefreshToken)).toBe("refresh-old");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reports a response missing access_token as a failure", async () => {
    const { uid, connection } = await seedUser();
    global.fetch.mockResolvedValueOnce(tokenResponse({ expires_in: 3600 }));

    const result = await refreshZenodoToken(uid, connection);

    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_REFRESH_TOKEN");
    // Nothing partial written.
    expect(decrypt((await readConnection(uid)).encryptedToken)).toBe("access-old");
  });
});

describe("refreshZenodoToken: the rotation race", () => {
  // Two submissions arrive after an idle hour, both see an expired access
  // token, both refresh. The first rotates refresh-old -> refresh-winner; the
  // second still holds refresh-old in memory and Zenodo no longer knows it.
  // The connection is HEALTHY -- treating this as a dead grant would tear down
  // a working account in the middle of data collection.
  it("recovers by using the credentials the winner persisted", async () => {
    const { uid } = await seedUser({
      encryptedToken: encrypt("access-winner"),
      encryptedRefreshToken: encrypt("refresh-winner"),
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
    });
    const staleConnection = {
      authMethod: "oauth2",
      encryptedToken: encrypt("access-old"),
      encryptedRefreshToken: encrypt("refresh-old"),
      tokenExpiresAt: Date.now() - 1000,
    };
    global.fetch.mockResolvedValueOnce(errorResponse('{"error": "invalid_grant"}'));

    const result = await refreshZenodoToken(uid, staleConnection);

    expect(result).toEqual({ success: true, accessToken: "access-winner" });
    // One exchange only -- the winner's token was still fresh, so there was
    // nothing to ask Zenodo for.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("exchanges once more when the winner's access token is also stale", async () => {
    const { uid } = await seedUser({
      encryptedToken: encrypt("access-winner"),
      encryptedRefreshToken: encrypt("refresh-winner"),
      tokenExpiresAt: Date.now() + EXPIRY_MARGIN_MS - 1000,
    });
    const staleConnection = {
      authMethod: "oauth2",
      encryptedToken: encrypt("access-old"),
      encryptedRefreshToken: encrypt("refresh-old"),
      tokenExpiresAt: Date.now() - 1000,
    };
    global.fetch
      .mockResolvedValueOnce(errorResponse('{"error": "invalid_grant"}'))
      .mockResolvedValueOnce(
        tokenResponse({ access_token: "access-final", refresh_token: "refresh-final", expires_in: 3600 })
      );

    const result = await refreshZenodoToken(uid, staleConnection);

    expect(result).toEqual({ success: true, accessToken: "access-final" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // The retry must present the WINNER's refresh token, not the dead one.
    expect(new URLSearchParams(global.fetch.mock.calls[1][1].body).get("refresh_token")).toBe(
      "refresh-winner"
    );
    expect(decrypt((await readConnection(uid)).encryptedRefreshToken)).toBe("refresh-final");
  });

  // Same invalid_grant, but nothing rotated -- the stored token is still the
  // one we presented. This is a genuinely revoked grant and must be reported
  // as such, or a researcher who disconnected DataPipe on Zenodo would see
  // retries forever instead of being told to reconnect.
  it("reports a genuinely revoked grant when nothing rotated", async () => {
    const { uid, connection } = await seedUser();
    global.fetch.mockResolvedValueOnce(errorResponse('{"error": "invalid_grant"}'));

    const result = await refreshZenodoToken(uid, connection);

    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_REFRESH_TOKEN");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("reports PROVIDER_NOT_CONNECTED when the account vanished mid-flight", async () => {
    const { uid, connection } = await seedUser();
    await db.doc(`users/${uid}`).set({ connectedAccounts: {} });
    global.fetch.mockResolvedValueOnce(errorResponse('{"error": "invalid_grant"}'));

    const result = await refreshZenodoToken(uid, connection);

    expect(result.success).toBe(false);
    expect(result.error).toBe("PROVIDER_NOT_CONNECTED");
  });

  // invalid_client and unsupported_grant_type are also 400s, but they are
  // configuration faults -- a wrong client secret, say. Sending those down the
  // race-recovery path would waste a Firestore read hunting for a rotation
  // that never happened, and could mask a broken deployment as a transient.
  it("does not treat other 400s as a race", async () => {
    const { uid, connection } = await seedUser();
    global.fetch.mockResolvedValueOnce(errorResponse('{"error": "invalid_client"}'));

    const result = await refreshZenodoToken(uid, connection);

    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_REFRESH_TOKEN");
    expect(result.detail).toContain("invalid_client");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a network error without touching stored credentials", async () => {
    const { uid, connection } = await seedUser();
    global.fetch.mockRejectedValueOnce(new Error("socket hang up"));

    const result = await refreshZenodoToken(uid, connection);

    expect(result.success).toBe(false);
    expect(result.detail).toContain("socket hang up");
    expect(decrypt((await readConnection(uid)).encryptedRefreshToken)).toBe("refresh-old");
  });
});
