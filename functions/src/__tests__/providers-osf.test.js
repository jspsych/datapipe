/**
 * @jest-environment node
 */

// Runs in the node environment, not the project-default jsdom: osfProvider
// now resolves tokens too (osf.ts -> refresh-token.ts -> app.js ->
// firebase-admin/auth -> jwks-rsa -> jose). Under jsdom, jose resolves to its
// ESM-only browser build and Jest's CJS transform can't parse it; the node
// environment picks jose's CJS build. Mirrors resolve-token-gdrive.test.js,
// which has always carried this docblock for the same reason.

// osfProvider delegates its writes to put-file-osf.js / update-file-osf.js,
// which both import their own `fetch` from the "node-fetch" package rather
// than using the global fetch. Mocking global.fetch (the pattern used by
// metadata-process.test.js) would have no effect on this code path, since
// node-fetch's fetch is a distinct implementation from globalThis.fetch.
// We mock the "node-fetch" module itself instead.
const mockFetch = jest.fn();

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

import { osfProvider } from "../../lib/providers/osf.js";

function mockResponse({ status, statusText, retryAfter = null }) {
  return {
    status,
    statusText,
    headers: {
      get: (header) => (header === "Retry-After" ? retryAfter : null),
    },
  };
}

const auth = { token: "test-token" };
const container = { provider: "osf", filesLink: "https://osf.io/abc123/" };

describe("osfProvider.writeSessionFile", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("maps a 201 response to a success WriteResult", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 201, statusText: "Created" }));

    const result = await osfProvider.writeSessionFile(
      auth,
      container,
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: true,
      fileRef: { name: "file.json" },
      storedFilename: "file.json",
    });
  });

  it("maps a 409 response to NAME_CONFLICT", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 409, statusText: "Conflict" }));

    const result = await osfProvider.writeSessionFile(
      auth,
      container,
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "NAME_CONFLICT",
      providerStatus: 409,
      providerMessage: "Conflict",
      retryAfter: null,
    });
  });

  it("maps a 429 response to RATE_LIMITED and passes through retryAfter", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 429, statusText: "Too Many Requests", retryAfter: "30" })
    );

    const result = await osfProvider.writeSessionFile(
      auth,
      container,
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "RATE_LIMITED",
      providerStatus: 429,
      providerMessage: "Too Many Requests",
      retryAfter: 30,
    });
  });

  it("maps a 401 response to AUTH_EXPIRED", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 401, statusText: "Unauthorized" }));

    const result = await osfProvider.writeSessionFile(
      auth,
      container,
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "AUTH_EXPIRED",
      providerStatus: 401,
      providerMessage: "Unauthorized",
      retryAfter: null,
    });
  });

  it("maps a 500 response to UNAVAILABLE and preserves providerStatus/providerMessage", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 500, statusText: "Internal Server Error" })
    );

    const result = await osfProvider.writeSessionFile(
      auth,
      container,
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "UNAVAILABLE",
      providerStatus: 500,
      providerMessage: "Internal Server Error",
      retryAfter: null,
    });
  });
});

describe("osfProvider.listFiles", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("returns name/id pairs and filters out folder entries", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          data: [
            { attributes: { name: "data.json", kind: "file" }, id: "osfstorage/111" },
            { attributes: { name: "subfolder", kind: "folder" }, id: "osfstorage/222" },
            { attributes: { name: "dataset_description.json", kind: "file" }, id: "osfstorage/333" },
          ],
        }),
    });

    const result = await osfProvider.listFiles(auth, container);

    expect(result).toEqual([
      { name: "data.json", id: "osfstorage/111" },
      { name: "dataset_description.json", id: "osfstorage/333" },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://osf.io/abc123/?meta=",
      expect.objectContaining({ method: "GET" })
    );
  });
});
