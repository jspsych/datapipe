/**
 * @jest-environment node
 */

// Pure unit tests for revokeGdriveToken (functions/src/providers/
// gdrive-oauth.ts), added alongside the disconnectProvider / purgeUserData
// revocation work (docs/privacy.js promises disconnecting Drive revokes
// DataPipe's authorization with Google, so this has to actually be true).
//
// Runs in the node environment, not the project-default jsdom, for the same
// reason resolve-token-gdrive.test.js and providers-gdrive.test.js do:
// gdrive-oauth.ts imports app.js -> firebase-admin/auth -> jwks-rsa -> jose,
// and jose's ESM-only browser build only parses under Jest's CJS transform
// when the environment is "node".
//
// No Firestore emulator needed -- revokeGdriveToken never touches `db`, it
// only calls the runtime's global `fetch` (mirrors refreshGdriveToken in the
// same module, see that function's header comment on why global fetch and
// not "node-fetch").

import { revokeGdriveToken } from "../../lib/providers/gdrive-oauth.js";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_GDRIVE_REVOKE_URL = process.env.GDRIVE_REVOKE_URL;

beforeAll(() => {
  // Pins the endpoint to a distinctive sentinel so a test that forgets to
  // assert on it can't accidentally pass against the real Google default.
  process.env.GDRIVE_REVOKE_URL = "https://gdrive-revoke.mock.test/revoke";
});

afterAll(() => {
  process.env.GDRIVE_REVOKE_URL = ORIGINAL_GDRIVE_REVOKE_URL;
  global.fetch = ORIGINAL_FETCH;
});

let warnSpy;
let errorSpy;

beforeEach(() => {
  global.fetch = jest.fn();
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

// Every console.warn/error call, flattened to strings, so tests can assert a
// secret never appears in any of them regardless of argument shape.
function allLoggedText() {
  return [...warnSpy.mock.calls, ...errorSpy.mock.calls]
    .flat()
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join("\n");
}

const SECRET_TOKEN = "super-secret-refresh-token-do-not-log-me";

describe("revokeGdriveToken", () => {
  it("POSTs the token, form-encoded, to GDRIVE_REVOKE_URL", async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await revokeGdriveToken(SECRET_TOKEN);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(process.env.GDRIVE_REVOKE_URL);
    expect(options.method).toBe("POST");
    expect(header(options.headers, "Content-Type")).toContain(
      "application/x-www-form-urlencoded"
    );
    const params = new URLSearchParams(options.body);
    expect(params.get("token")).toBe(SECRET_TOKEN);
  });

  it("returns ok:true on a 200 response", async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await revokeGdriveToken(SECRET_TOKEN);

    expect(result).toEqual({ ok: true, status: 200 });
  });

  it("treats a 400 invalid_token response as ok:true (the grant is already gone)", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"invalid_token"}'),
    });

    const result = await revokeGdriveToken(SECRET_TOKEN);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(400);
  });

  it("returns ok:false with the status on a 500 response", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("internal error"),
    });

    const result = await revokeGdriveToken(SECRET_TOKEN);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("returns ok:false on a 400 that is not invalid_token", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve("some_other_error"),
    });

    const result = await revokeGdriveToken(SECRET_TOKEN);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("returns ok:false, never throws, when fetch itself rejects (network error)", async () => {
    global.fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(revokeGdriveToken(SECRET_TOKEN)).resolves.toEqual(
      expect.objectContaining({ ok: false })
    );
  });

  it("never logs the token itself, on any code path", async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 });
    await revokeGdriveToken(SECRET_TOKEN);

    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("internal error"),
    });
    await revokeGdriveToken(SECRET_TOKEN);

    global.fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await revokeGdriveToken(SECRET_TOKEN);

    expect(allLoggedText()).not.toContain(SECRET_TOKEN);
  });
});
