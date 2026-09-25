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
      status: 200,
      statusText: "OK",
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

  // Regression coverage: a non-OK response (403/404/410/429/...) has no
  // `data` field -- OSF returns a JSON:API error object instead -- so this
  // must be checked before the body is parsed. Left unchecked,
  // folder["data"].filter throws an opaque "Cannot read properties of
  // undefined (reading 'filter')" instead of naming OSF's real status, which
  // is exactly what reached production through the collision cache as
  // "Collision cache rehydration failed: ... Cannot read properties of
  // undefined (reading 'filter')" with no clue it was really an OSF 403.
  it.each([
    [403, "Forbidden"],
    [404, "Not Found"],
    [410, "Gone"],
    [429, "Too Many Requests"],
  ])("throws with the status and statusText on a %i response with no detail in the body", async (status, statusText) => {
    mockFetch.mockResolvedValueOnce({
      status,
      statusText,
      json: () => Promise.resolve({ errors: [{}] }),
    });

    await expect(osfProvider.listFiles(auth, container)).rejects.toThrow(
      `OSF listing failed: ${status} ${statusText}`
    );
  });

  // OSF's JSON:API error body carries its own explanation in errors[0].detail
  // -- surfaced in preference to the generic statusText whenever it's present,
  // since "403 Forbidden" alone gives a researcher nothing actionable while
  // OSF's own detail says exactly what went wrong.
  it("throws with OSF's own errors[0].detail on a 403 response, not just the statusText", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 403,
      statusText: "Forbidden",
      json: () =>
        Promise.resolve({
          errors: [{ detail: "You do not have permission to perform this action." }],
        }),
    });

    await expect(osfProvider.listFiles(auth, container)).rejects.toThrow(
      "OSF listing failed: 403 You do not have permission to perform this action."
    );
  });

  // Some error responses (a proxy timeout page, an HTML 5xx) are not JSON at
  // all -- .json() rejects instead of resolving with a body that merely lacks
  // `errors`. Must fall back to statusText rather than let that rejection
  // propagate as an unrelated, confusing failure.
  it("falls back to statusText when the error body is not JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 502,
      statusText: "Bad Gateway",
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0")),
    });

    await expect(osfProvider.listFiles(auth, container)).rejects.toThrow(
      "OSF listing failed: 502 Bad Gateway"
    );
  });

  // Same failure class as above, but with no status code to blame: a 200
  // whose body doesn't have the expected `data` array. Must not crash inside
  // the filter/map with an unhelpful TypeError.
  it("throws a clear error on a 200 response with no `data` array", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ unexpected: "shape" }),
    });

    await expect(osfProvider.listFiles(auth, container)).rejects.toThrow(
      "OSF listing failed: response body had no file list"
    );
  });
});

// Real experiment documents store osfFilesLink as the osfstorage root's
// WaterButler upload link (lib/experiment-creation.js), which already ends in
// "/providers/osfstorage/". WaterButler reports file ids WITH a provider
// prefix -- "osfstorage/<id>" -- and listFiles / putFileOSF pass that id
// through verbatim, so the adapter must drop the prefix before appending the
// id to the link. Otherwise the URL names the provider twice
// (".../providers/osfstorage/osfstorage/<id>") and every dataset_description.json
// update and download misses the file. The fake "https://osf.io/abc123/" link
// used above cannot catch this, which is why these tests use the real shape.
describe("osfProvider file URLs against a real osfstorage upload link", () => {
  const realContainer = {
    provider: "osf",
    filesLink: "https://files.osf.io/v1/resources/abc12/providers/osfstorage/",
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("updateFile addresses a listFiles id without doubling the provider segment", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      json: () =>
        Promise.resolve({
          data: [
            { attributes: { name: "dataset_description.json", kind: "file" }, id: "osfstorage/5f0e1d2c" },
          ],
        }),
    });
    const [fileRef] = await osfProvider.listFiles(auth, realContainer);

    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK" }));
    await osfProvider.updateFile(auth, realContainer, fileRef, "{}", {
      size: 2,
      contentType: "application/json",
    });

    expect(mockFetch).toHaveBeenLastCalledWith(
      "https://files.osf.io/v1/resources/abc12/providers/osfstorage/5f0e1d2c?kind=file",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("downloadFile addresses a prefixed id without doubling the provider segment", async () => {
    mockFetch.mockResolvedValueOnce({
      ...mockResponse({ status: 200, statusText: "OK" }),
      text: () => Promise.resolve("{}"),
    });

    const result = await osfProvider.downloadFile(auth, realContainer, {
      name: "dataset_description.json",
      id: "osfstorage/5f0e1d2c",
    });

    expect(result).toEqual({ success: true, content: "{}" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://files.osf.io/v1/resources/abc12/providers/osfstorage/5f0e1d2c",
      expect.anything()
    );
  });

  it("still accepts a bare id with no provider prefix", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK" }));

    await osfProvider.updateFile(
      auth,
      realContainer,
      { name: "dataset_description.json", id: "5f0e1d2c" },
      "{}",
      { size: 2, contentType: "application/json" }
    );

    expect(mockFetch).toHaveBeenLastCalledWith(
      "https://files.osf.io/v1/resources/abc12/providers/osfstorage/5f0e1d2c?kind=file",
      expect.objectContaining({ method: "PUT" })
    );
  });
});
