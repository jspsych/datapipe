// RED-phase unit tests for step 3b (docs/provider-migration-design.md,
// scratchpad/step3b-metadata-ref-spec.md), cases 1-2 of the test plan.
//
// putFileOSF currently discards the 201 response body entirely (see
// put-file-osf.ts: it never calls `.json()` on a successful upload). This
// step extends it to parse `{ data: { id, attributes: { name } } }` and
// surface `fileId`/`fileName`, and extends osfProvider.writeSessionFile to
// pass those through as `fileRef`/`storedFilename`. Written as a new file
// (providers-osf.test.js is left untouched per the RED-phase instructions)
// but following its mocking style exactly: put-file-osf.ts/update-file-osf.ts
// import their own `fetch` from "node-fetch" rather than using globalThis
// fetch, so "node-fetch" is mocked at the module level, and the compiled
// lib/ output is imported (same convention providers-osf.test.js and
// metadata-process.test.js use) rather than the .ts source.
const mockFetch = jest.fn();

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

import putFileOSF from "../../lib/put-file-osf.js";
import { osfProvider } from "../../lib/providers/osf.js";

function mockResponse({ status, statusText, retryAfter = null, jsonBody, jsonError }) {
  return {
    status,
    statusText,
    headers: {
      get: (header) => (header === "Retry-After" ? retryAfter : null),
    },
    json: () => (jsonError ? Promise.reject(jsonError) : Promise.resolve(jsonBody)),
  };
}

describe("putFileOSF response parsing (case 1)", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("parses fileId and fileName from a well-formed 201 body", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 201,
        statusText: "Created",
        jsonBody: { data: { id: "osfstorage/abc123", attributes: { name: "file.json" } } },
      })
    );

    const result = await putFileOSF("https://osf.io/abc123/", "test-token", "data", "file.json");

    expect(result).toEqual({
      success: true,
      errorCode: null,
      errorText: null,
      fileId: "osfstorage/abc123",
      fileName: "file.json",
    });
  });

  it("tolerates a 201 body containing only attributes.name (no id)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 201,
        statusText: "Created",
        jsonBody: { data: { attributes: { name: "file.json" } } },
      })
    );

    const result = await putFileOSF("https://osf.io/abc123/", "test-token", "data", "file.json");

    expect(result.success).toBe(true);
    expect(result.fileName).toBe("file.json");
    expect(result.fileId).toBeUndefined();
  });

  it("tolerates a missing/unparseable body on a successful upload without throwing", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 201,
        statusText: "Created",
        jsonError: new SyntaxError("Unexpected end of JSON input"),
      })
    );

    const result = await putFileOSF("https://osf.io/abc123/", "test-token", "data", "file.json");

    expect(result.success).toBe(true);
    expect(result.fileId).toBeUndefined();
    expect(result.fileName).toBeUndefined();
  });

  it("does not attempt to parse a body on a non-201 (failure) response", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 409,
        statusText: "Conflict",
        // If implementation code ever called .json() on a failure response,
        // this rejection would surface as an unhandled/uncaught test failure.
        jsonError: new Error("json() should not be called on a failed upload"),
      })
    );

    const result = await putFileOSF("https://osf.io/abc123/", "test-token", "data", "file.json");

    expect(result).toEqual({
      success: false,
      errorCode: 409,
      errorText: "Conflict",
      retryAfter: null,
    });
  });
});

describe("osfProvider.writeSessionFile fileRef surfacing (case 2)", () => {
  const auth = { token: "test-token" };
  const container = { provider: "osf", filesLink: "https://osf.io/abc123/" };

  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("surfaces fileRef.id/name parsed from the 201 body, and storedFilename from the parsed name", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 201,
        statusText: "Created",
        jsonBody: { data: { id: "osfstorage/xyz789", attributes: { name: "renamed.json" } } },
      })
    );

    const result = await osfProvider.writeSessionFile(
      auth,
      container,
      "requested.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: true,
      fileRef: { name: "renamed.json", id: "osfstorage/xyz789" },
      storedFilename: "renamed.json",
    });
  });

  it("falls back to the requested filename when the body has no name, but keeps the parsed id", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 201,
        statusText: "Created",
        jsonBody: { data: { id: "osfstorage/xyz789" } },
      })
    );

    const result = await osfProvider.writeSessionFile(
      auth,
      container,
      "requested.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: true,
      fileRef: { name: "requested.json", id: "osfstorage/xyz789" },
      storedFilename: "requested.json",
    });
  });

  it("falls back to the requested filename and an undefined id when the body is unparseable", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 201,
        statusText: "Created",
        jsonError: new SyntaxError("Unexpected end of JSON input"),
      })
    );

    const result = await osfProvider.writeSessionFile(
      auth,
      container,
      "requested.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: true,
      fileRef: { name: "requested.json", id: undefined },
      storedFilename: "requested.json",
    });
  });
});
