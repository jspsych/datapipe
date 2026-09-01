/**
 * @jest-environment node
 */

// Runs in the node environment, not the project-default jsdom: the adapters
// now resolve tokens too (gdrive.ts -> gdrive-oauth.ts, osf.ts ->
// refresh-token.ts, both -> app.js -> firebase-admin/auth -> jwks-rsa ->
// jose). Under jsdom, jose resolves to its ESM-only browser build and Jest's
// CJS transform can't parse it; the node environment picks jose's CJS build.
// Mirrors resolve-token-gdrive.test.js, which has always carried this
// docblock for the same reason.

// RED-phase unit tests for step 4a (docs/provider-migration-design.md,
// scratchpad/step4a-gdrive-adapter-spec.md), cases 1-7 of the test plan.
//
// functions/src/providers/gdrive.ts does not exist yet, so the import below
// fails at module resolution -- EVERY test in this file (including the osf
// sub-test inside case 7) fails as a collateral "Cannot find module
// .../lib/providers/gdrive.js" error until the adapter is implemented. Once
// gdrive.ts exists, the osf.downloadFile sub-test in case 7 is expected to
// keep failing on its own, different (and correct) ground: osf.ts has no
// downloadFile method yet either (that's also new in this step -- see the
// "downloadFile" interface addition in the spec) -- so it fails with
// "osfProvider.downloadFile is not a function", a missing-behavior failure
// distinct from the module-not-found failures affecting cases 1-6.
//
// Style follows providers-osf.test.js: node-fetch is imported by name inside
// the (future) gdrive.ts adapter module, same as osf.ts's put-file-osf.ts /
// update-file-osf.ts, so "node-fetch" is mocked at the module level and the
// compiled lib/ output is imported rather than the .ts source.
//
// GDRIVE_API_BASE is read at CALL time (not module load, per the spec), so
// this file pins it to a distinctive, non-default sentinel value in
// beforeAll/afterAll -- this both keeps assertions independent of whatever
// the real default happens to be, and forces the implementation to actually
// read process.env.GDRIVE_API_BASE rather than hardcoding
// https://www.googleapis.com.
const mockFetch = jest.fn();

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

import { gdriveProvider } from "../../lib/providers/gdrive.js";
import { osfProvider } from "../../lib/providers/osf.js";
import { claimNameFor } from "../../lib/providers/index.js";

const API_BASE = "https://gdrive.mock.test";

const ORIGINAL_GDRIVE_API_BASE = process.env.GDRIVE_API_BASE;

beforeAll(() => {
  process.env.GDRIVE_API_BASE = API_BASE;
});

afterAll(() => {
  process.env.GDRIVE_API_BASE = ORIGINAL_GDRIVE_API_BASE;
});

beforeEach(() => {
  mockFetch.mockClear();
});

const auth = { token: "test-token" };

function mockResponse({ status, statusText, retryAfter = null, jsonBody, textBody }) {
  return {
    status,
    statusText,
    headers: {
      get: (header) => (header === "Retry-After" ? retryAfter : null),
    },
    json: () => Promise.resolve(jsonBody),
    text: () => Promise.resolve(textBody),
  };
}

// Case-insensitive header lookup -- the exact casing of the headers object
// gdrive.ts builds isn't spec'd beyond "Authorization"/"Content-Type" style
// (mirrored from osf.ts), so tests look up by name rather than assume a key.
function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function extractBoundary(contentType) {
  const match = /boundary=("?)([^;"]+)\1/.exec(contentType || "");
  return match ? match[2] : null;
}

function callArgs(index = 0) {
  const [url, options] = mockFetch.mock.calls[index];
  return { url, options };
}

describe("1. writeSessionFile success", () => {
  it("POSTs a multipart/related upload containing both the JSON metadata and the payload, and parses the returned fileRef", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { id: "gdrive-file-1", name: "file.json" },
      })
    );

    const container = { provider: "gdrive", folderId: "folder-abc" };
    const result = await gdriveProvider.writeSessionFile(
      auth,
      container,
      "file.json",
      "a,b,c\n1,2,3",
      { size: 11, contentType: "text/csv" }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, options } = callArgs(0);

    expect(url).toBe(`${API_BASE}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`);
    expect(options.method).toBe("POST");
    expect(header(options.headers, "Authorization")).toBe("Bearer test-token");

    const contentType = header(options.headers, "Content-Type");
    expect(contentType).toMatch(/^multipart\/related; boundary=/);
    const boundary = extractBoundary(contentType);
    expect(boundary).toBeTruthy();

    const body = options.body.toString();
    expect(body).toContain(`--${boundary}`);
    expect(body).toContain('"name":"file.json"');
    expect(body).toContain('"parents":["folder-abc"]');
    expect(body).toContain("application/json; charset=UTF-8");
    expect(body).toContain("text/csv");
    expect(body).toContain("a,b,c\n1,2,3");
    // Metadata part must precede the data part.
    expect(body.indexOf('"name":"file.json"')).toBeLessThan(body.indexOf("a,b,c\n1,2,3"));

    expect(result).toEqual({
      success: true,
      fileRef: { id: "gdrive-file-1", name: "file.json" },
      storedFilename: "file.json",
    });
  });

  it("also treats a 201 response as success (per the '200/201' contract)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 201,
        statusText: "Created",
        jsonBody: { id: "gdrive-file-2", name: "file2.json" },
      })
    );

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "file2.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: true,
      fileRef: { id: "gdrive-file-2", name: "file2.json" },
      storedFilename: "file2.json",
    });
  });

  it("falls back to the requested filename as storedFilename when the response omits name", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { id: "gdrive-file-3" },
      })
    );

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "file3.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: true,
      fileRef: { id: "gdrive-file-3", name: undefined },
      storedFilename: "file3.json",
    });
  });
});

describe("2. writeSessionFile subfolder", () => {
  it("finds-or-creates the subfolder by name under the container, then uploads parented to it", async () => {
    // 1) folder query -- absent
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { files: [] } }));
    // 2) folder create
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "sub-folder-id", name: "sub" } })
    );
    // 3) upload into the new subfolder
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "gdrive-file-4", name: "file.csv" } })
    );

    const container = { provider: "gdrive", folderId: "folder-abc" };
    const result = await gdriveProvider.writeSessionFile(auth, container, "sub/file.csv", "csv-data", {
      size: 8,
      contentType: "text/csv",
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);

    const findCall = callArgs(0);
    const findUrl = new URL(findCall.url);
    expect(findCall.options.method).toBe("GET");
    expect(findUrl.searchParams.get("q")).toContain("name='sub'");
    expect(findUrl.searchParams.get("q")).toContain("'folder-abc' in parents");
    expect(findUrl.searchParams.get("q")).toContain("mimeType='application/vnd.google-apps.folder'");
    expect(findUrl.searchParams.get("q")).toContain("trashed=false");

    const createCall = callArgs(1);
    expect(createCall.options.method).toBe("POST");
    expect(JSON.parse(createCall.options.body)).toEqual({
      name: "sub",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["folder-abc"],
    });

    const uploadCall = callArgs(2);
    expect(uploadCall.url).toBe(`${API_BASE}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`);
    const uploadBody = uploadCall.options.body.toString();
    expect(uploadBody).toContain('"name":"file.csv"');
    expect(uploadBody).toContain('"parents":["sub-folder-id"]');
    expect(uploadBody).toContain("csv-data");

    expect(result).toEqual({
      success: true,
      fileRef: { id: "gdrive-file-4", name: "file.csv" },
      storedFilename: "file.csv",
    });
  });

  it("uploads directly into an existing subfolder without creating a duplicate", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { files: [{ id: "existing-sub-id", name: "sub", mimeType: "application/vnd.google-apps.folder" }] },
      })
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "gdrive-file-5", name: "file2.csv" } })
    );

    const container = { provider: "gdrive", folderId: "folder-abc" };
    await gdriveProvider.writeSessionFile(auth, container, "sub/file2.csv", "csv-data-2", {
      size: 10,
      contentType: "text/csv",
    });

    // Exactly 2 calls: the find query, then the upload. No create call.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const uploadBody = callArgs(1).options.body.toString();
    expect(uploadBody).toContain('"parents":["existing-sub-id"]');
  });
});

describe("3. error mapping", () => {
  it("maps 401 to AUTH_EXPIRED", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 401, statusText: "Unauthorized" }));

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
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

  it("maps 403 storageQuotaExceeded to QUOTA_EXCEEDED", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 403,
        statusText: "Forbidden",
        jsonBody: { errors: [{ reason: "storageQuotaExceeded", message: "quota" }] },
      })
    );

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "QUOTA_EXCEEDED",
      providerStatus: 403,
      providerMessage: "Forbidden",
      retryAfter: null,
    });
  });

  it("maps 403 userRateLimitExceeded to RATE_LIMITED", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 403,
        statusText: "Forbidden",
        jsonBody: { errors: [{ reason: "userRateLimitExceeded", message: "slow down" }] },
      })
    );

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "RATE_LIMITED",
      providerStatus: 403,
      providerMessage: "Forbidden",
      retryAfter: null,
    });
  });

  it("maps any other 403 reason to AUTH_EXPIRED", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 403,
        statusText: "Forbidden",
        jsonBody: { errors: [{ reason: "insufficientFilePermissions", message: "nope" }] },
      })
    );

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "AUTH_EXPIRED",
      providerStatus: 403,
      providerMessage: "Forbidden",
      retryAfter: null,
    });
  });

  it("maps 403 rateLimitExceeded to RATE_LIMITED", async () => {
    // mapDriveError's RATE_LIMITED branch lists three reason strings
    // (userRateLimitExceeded, rateLimitExceeded, dailyLimitExceeded). Only
    // the first was covered above -- this and the next test close the gap so
    // a future edit that narrows or reorders that list gets caught.
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 403,
        statusText: "Forbidden",
        jsonBody: { errors: [{ reason: "rateLimitExceeded", message: "slow down" }] },
      })
    );

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "RATE_LIMITED",
      providerStatus: 403,
      providerMessage: "Forbidden",
      retryAfter: null,
    });
  });

  it("maps 403 dailyLimitExceeded to RATE_LIMITED", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 403,
        statusText: "Forbidden",
        jsonBody: { errors: [{ reason: "dailyLimitExceeded", message: "daily cap" }] },
      })
    );

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result.error).toBe("RATE_LIMITED");
  });

  it("defaults to AUTH_EXPIRED on a 403 whose body isn't valid JSON (safe fallback, not a crash)", async () => {
    // mapErrorResponse only parses the body on a 403 (to read the reason),
    // and swallows a JSON-parse failure into `body = undefined` -- exercised
    // here directly rather than assumed, since a throw escaping instead would
    // turn a routine provider error into an unhandled rejection.
    mockFetch.mockResolvedValueOnce({
      status: 403,
      statusText: "Forbidden",
      headers: { get: () => null },
      json: () => Promise.reject(new Error("not json")),
    });

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "AUTH_EXPIRED",
      providerStatus: 403,
      providerMessage: "Forbidden",
      retryAfter: null,
    });
  });

  it("maps 429 to RATE_LIMITED and passes through Retry-After", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 429, statusText: "Too Many Requests", retryAfter: "15" })
    );

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "RATE_LIMITED",
      providerStatus: 429,
      providerMessage: "Too Many Requests",
      retryAfter: 15,
    });
  });

  it("maps 500 to UNAVAILABLE", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 500, statusText: "Internal Server Error" }));

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
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

describe("4. listFiles pagination", () => {
  it("follows nextPageToken until exhausted, concatenates results, recurses into subfolders, and same-level requests carry the same q filter", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: {
          nextPageToken: "page2tok",
          files: [
            { id: "f1", name: "a.csv", mimeType: "text/csv" },
            { id: "folder1", name: "subdir", mimeType: "application/vnd.google-apps.folder" },
          ],
        },
      })
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { files: [{ id: "f2", name: "b.csv", mimeType: "text/csv" }] },
      })
    );
    // Recursion: a third request lists the "subdir" folder (folder1) found
    // above, since listFiles now walks into subfolders (nested Psych-DS
    // paths like data/raw/ live there) instead of only listing the top level.
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { files: [{ id: "f3", name: "c.csv", mimeType: "text/csv" }] },
      })
    );

    const container = { provider: "gdrive", folderId: "folder-xyz" };
    const result = await gdriveProvider.listFiles(auth, container);

    // Files from every level are concatenated, each QUALIFIED BY THE FOLDER
    // PATH it was found under (relative to the container root), so hashing
    // `salt:name` matches the claim a write makes -- storedNameFor is
    // identity on this adapter. "c.csv" sits inside "subdir", so it comes
    // back as "subdir/c.csv", not a bare leaf that would collide with any
    // other c.csv elsewhere in the tree.
    expect(result).toEqual([
      { name: "a.csv", id: "f1" },
      { name: "b.csv", id: "f2" },
      { name: "subdir/c.csv", id: "f3" },
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(3);

    const url1 = new URL(callArgs(0).url);
    const url2 = new URL(callArgs(1).url);
    const url3 = new URL(callArgs(2).url);

    expect(url1.searchParams.get("q")).toBe("'folder-xyz' in parents and trashed=false");
    expect(url2.searchParams.get("q")).toBe(url1.searchParams.get("q"));
    expect(url3.searchParams.get("q")).toBe("'folder1' in parents and trashed=false");
    expect(url1.searchParams.get("fields")).toBe("nextPageToken,files(id,name,mimeType)");
    expect(url1.searchParams.get("pageSize")).toBe("1000");

    // The defining pagination assertion: only the second request (same
    // folder, page 2) carries the page token from the first response.
    expect(url1.searchParams.get("pageToken")).toBeNull();
    expect(url2.searchParams.get("pageToken")).toBe("page2tok");
    expect(url3.searchParams.get("pageToken")).toBeNull();
  });

  it("stops after a single page when no nextPageToken is returned", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { files: [{ id: "f1", name: "only.csv", mimeType: "text/csv" }] },
      })
    );

    const result = await gdriveProvider.listFiles(auth, { provider: "gdrive", folderId: "folder-solo" });

    expect(result).toEqual([{ name: "only.csv", id: "f1" }]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws (never returns a partial/empty list) when the listing request fails", async () => {
    // Load-bearing for collision-cache rehydration: Drive has no 409
    // backstop, so a swallowed listing failure would warm the cache empty
    // and silently accept duplicate filenames. The throw is what surfaces
    // as CollisionCacheUnavailableError upstream.
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 401,
        statusText: "Unauthorized",
        jsonBody: { error: { message: "Invalid Credentials" } },
      })
    );

    await expect(
      gdriveProvider.listFiles(auth, { provider: "gdrive", folderId: "folder-err" })
    ).rejects.toThrow(/listing failed/i);
  });

  it("throws (never returns the partial list already collected) when a SUBFOLDER listing fails mid-recursion", async () => {
    // The single-request-failure case above only proves the top-level listing
    // is never swallowed. This is the case the "never a partial list" comment
    // in listFiles is actually guarding: the top level succeeds and yields
    // real files PLUS a subfolder to recurse into, and only the second
    // request (that subfolder) fails. If that failure were swallowed instead
    // of thrown, callers would get a partial list containing everything
    // found before the failure, which is exactly the silently-incomplete
    // rehydration the design note warns about.
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: {
          files: [
            { id: "top-1", name: "top.csv", mimeType: "text/csv" },
            { id: "folder1", name: "subdir", mimeType: "application/vnd.google-apps.folder" },
          ],
        },
      })
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 500,
        statusText: "Internal Server Error",
        jsonBody: undefined,
      })
    );

    await expect(
      gdriveProvider.listFiles(auth, { provider: "gdrive", folderId: "folder-partial" })
    ).rejects.toThrow(/listing failed/i);

    // Both requests were actually made (top level succeeded, subfolder is
    // what failed) -- confirms the throw is coming from the recursion step,
    // not a coincidental early exit.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("5. updateFile", () => {
  it("PATCHes the media upload endpoint keyed by the ref id and returns a WriteResult on success", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK" }));

    const existingFileRef = { id: "gdrive-existing-1", name: "data.json" };
    const result = await gdriveProvider.updateFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      existingFileRef,
      "updated-data",
      { size: 12, contentType: "application/json" }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, options } = callArgs(0);
    expect(url).toBe(`${API_BASE}/upload/drive/v3/files/gdrive-existing-1?uploadType=media&supportsAllDrives=true`);
    expect(options.method).toBe("PATCH");
    expect(header(options.headers, "Authorization")).toBe("Bearer test-token");
    expect(options.body).toBe("updated-data");

    expect(result).toEqual({
      success: true,
      fileRef: existingFileRef,
      storedFilename: "data.json",
    });
  });

  it("returns a failure WriteResult (does not throw) when the PATCH fails", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 404, statusText: "Not Found" }));

    const existingFileRef = { id: "gdrive-stale-1", name: "data.json" };

    await expect(
      gdriveProvider.updateFile(
        auth,
        { provider: "gdrive", folderId: "folder-abc" },
        existingFileRef,
        "updated-data",
        { size: 12, contentType: "application/json" }
      )
    ).resolves.toEqual({
      success: false,
      error: "UNAVAILABLE",
      providerStatus: 404,
      providerMessage: "Not Found",
      retryAfter: null,
    });
  });
});

describe("6. createDataContainer", () => {
  it("only creates the child folder when the DataPipe root already exists", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: {
          files: [{ id: "root-existing-id", name: "DataPipe", mimeType: "application/vnd.google-apps.folder" }],
        },
      })
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "child-id-A", name: "My Experiment" } })
    );

    // The Psych-DS chain is now created up front (find+create for "data",
    // then find+create for "raw") so the write path never races to make it.
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { files: [] } }));
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "data-folder-id", name: "data" } })
    );
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { files: [] } }));
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "raw-folder-id", name: "raw" } })
    );

    const result = await gdriveProvider.createDataContainer(auth, { name: "My Experiment" });

    expect(mockFetch).toHaveBeenCalledTimes(6);

    const findUrl = new URL(callArgs(0).url);
    expect(findUrl.searchParams.get("q")).toContain("name='DataPipe'");
    expect(findUrl.searchParams.get("q")).toContain("'root' in parents");
    expect(findUrl.searchParams.get("q")).toContain("mimeType='application/vnd.google-apps.folder'");
    expect(findUrl.searchParams.get("q")).toContain("trashed=false");

    expect(JSON.parse(callArgs(1).options.body)).toEqual({
      name: "My Experiment",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root-existing-id"],
    });

    expect(result).toEqual({ provider: "gdrive", folderId: "child-id-A" });
  });

  it("creates the DataPipe root first, then the child, when the root is absent", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { files: [] } }));
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "root-new-id", name: "DataPipe" } })
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "child-id-B", name: "My Experiment 2" } })
    );

    // The Psych-DS chain is now created up front (find+create for "data",
    // then find+create for "raw") so the write path never races to make it.
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { files: [] } }));
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "data-folder-id", name: "data" } })
    );
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { files: [] } }));
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "raw-folder-id", name: "raw" } })
    );

    const result = await gdriveProvider.createDataContainer(auth, { name: "My Experiment 2" });

    expect(mockFetch).toHaveBeenCalledTimes(7);

    expect(JSON.parse(callArgs(1).options.body)).toEqual({
      name: "DataPipe",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root"],
    });
    expect(JSON.parse(callArgs(2).options.body)).toEqual({
      name: "My Experiment 2",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root-new-id"],
    });

    expect(result).toEqual({ provider: "gdrive", folderId: "child-id-B" });
  });

  it("skips the DataPipe-root lookup entirely when researcherInput carries a parentId (Picker-supplied folder)", async () => {
    // The other two tests above only exercise the no-parentId fallback path.
    // A researcher-chosen parent (via the Google Picker) is meant to bypass
    // the shared "DataPipe" root convention entirely -- this is the one
    // request shape where that matters and it was untested.
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "child-id-C", name: "My Experiment 3" } })
    );
    // Then the Psych-DS chain, same as the other two paths.
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { files: [] } }));
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "data-folder-id", name: "data" } })
    );
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { files: [] } }));
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "raw-folder-id", name: "raw" } })
    );

    const result = await gdriveProvider.createDataContainer(auth, {
      name: "My Experiment 3",
      parentId: "picker-chosen-folder-id",
    });

    // One call for the experiment folder -- no root find, no root create --
    // then four for the Psych-DS chain.
    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(JSON.parse(callArgs(0).options.body)).toEqual({
      name: "My Experiment 3",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["picker-chosen-folder-id"],
    });

    expect(result).toEqual({ provider: "gdrive", folderId: "child-id-C" });
  });

  it("propagates a rejection (does not swallow it) when the DataPipe-root lookup fails", async () => {
    // createDataContainer has no try/catch of its own around findFolder --
    // unlike writeSessionFile's segment walk (see "8. nested folder-creation
    // failure" below), a failure here is expected to surface as a thrown
    // Error, not get remapped into a WriteResult-shaped value (this method
    // returns a bare ContainerRef, not a WriteResult, so there is nowhere to
    // put an error code even if it wanted to).
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 401, statusText: "Unauthorized", jsonBody: undefined }));

    await expect(
      gdriveProvider.createDataContainer(auth, { name: "Doomed Experiment" })
    ).rejects.toThrow(/folder lookup failed/i);
  });
});

describe("7. downloadFile", () => {
  it("gdrive: GETs the alt=media endpoint and returns the body text as content", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", textBody: "file body text" }));

    const container = { provider: "gdrive", folderId: "folder-abc" };
    const result = await gdriveProvider.downloadFile(auth, container, { id: "gdrive-file-9", name: "data.json" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, options } = callArgs(0);
    expect(url).toBe(`${API_BASE}/drive/v3/files/gdrive-file-9?alt=media&supportsAllDrives=true`);
    expect(options.method).toBe("GET");
    expect(header(options.headers, "Authorization")).toBe("Bearer test-token");

    expect(result).toEqual({ success: true, content: "file body text" });
  });

  it("gdrive: maps a 401 on download the same way as writes (shared mapDriveError)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 401, statusText: "Unauthorized" }));

    const result = await gdriveProvider.downloadFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      { id: "gdrive-file-10", name: "data.json" }
    );

    expect(result).toEqual({
      success: false,
      error: "AUTH_EXPIRED",
      providerStatus: 401,
      providerMessage: "Unauthorized",
    });
  });

  it("osf: GETs filesLink+id and returns the body text as content", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", textBody: "osf file content" }));

    const container = { provider: "osf", filesLink: "https://osf.io/abc123/" };
    const result = await osfProvider.downloadFile(auth, container, { id: "osfstorage/111", name: "data.json" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, options } = callArgs(0);
    expect(url).toBe("https://osf.io/abc123/osfstorage/111");
    expect(options.method).toBe("GET");
    expect(header(options.headers, "Authorization")).toBe("Bearer test-token");

    expect(result).toEqual({ success: true, content: "osf file content" });
  });
});

// Found while auditing this suite against providers-dataverse.test.js's
// coverage, not requested directly -- documents CURRENT (not obviously
// desired) behavior, the same way dataverse-emulator.test.js's D10 does.
//
// writeSessionFile wraps its whole segment-by-segment folder walk (the loop
// that finds-or-creates "data", then "raw", etc.) in one try/catch that maps
// ANY failure -- regardless of what actually went wrong -- to a generic
// { error: "UNAVAILABLE", providerStatus: null }. That collapses a real 401
// mid-walk (an expired/revoked Drive token, discovered while looking up the
// "data" folder rather than during the final upload) into the SAME
// UNAVAILABLE code a genuine outage would produce, instead of the
// AUTH_EXPIRED that mapDriveError would assign a 401 hit directly against the
// upload endpoint (see "3. error mapping" above).
//
// This is user-facing, not just a logging nicety: components/dashboard/
// QueuePanel.js shows researchers a distinct "your storage provider
// connection may need to be refreshed" message for AUTH_EXPIRED, versus a
// generic "temporarily unavailable" message for UNAVAILABLE. A researcher
// with an expired token submitting to a Psych-DS nested path (data/raw/...,
// i.e. any metadataActive experiment) would see the wrong guidance -- while
// the SAME expired token, on a flat (non-nested) filename, correctly reaches
// mapDriveError and gets AUTH_EXPIRED. Reported rather than fixed per this
// task's brief; see the audit notes for detail.
describe("8. a failure inside the nested folder walk keeps its real error code", () => {
  // Regression. findFolder/createFolder compute a MappedDriveError and used to
  // stringify it into a plain Error, so any failure part-way through a nested
  // path collapsed to a generic UNAVAILABLE with providerStatus null.
  //
  // That is user-facing rather than cosmetic: QueuePanel.js prints "your
  // storage provider connection may need to be refreshed" for AUTH_EXPIRED and
  // "temporarily unavailable" for UNAVAILABLE, so a researcher whose Drive
  // token had expired was told to wait out an outage that would never end.
  //
  // It only misfired on NESTED paths -- every metadataActive experiment, since
  // those write to data/raw/... -- while the same expired token on a flat
  // filename classified correctly. That asymmetry is why it survived: the
  // obvious test case passes.

  it("a 401 while resolving an intermediate folder is AUTH_EXPIRED", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 401, statusText: "Unauthorized", jsonBody: undefined })
    );

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "data/raw/file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("AUTH_EXPIRED");
    // The status survives too -- it was being flattened to null.
    expect(result.providerStatus).toBe(401);
  });

  it("classifies a nested-path failure the same as the identical flat-path one", async () => {
    // The invariant that matters: which code comes back must not depend on
    // whether the filename happened to contain a slash.
    const call = async (filename) => {
      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce(mockResponse({ status: 401, statusText: "Unauthorized" }));
      return gdriveProvider.writeSessionFile(
        auth,
        { provider: "gdrive", folderId: "folder-abc" },
        filename,
        "data",
        { size: 4, contentType: "application/json" }
      );
    };

    expect((await call("data/raw/file.json")).error).toBe((await call("file.json")).error);
  });

  it("still falls back to UNAVAILABLE for a non-provider throw", async () => {
    // The fallback must remain for genuine network errors and bugs -- the fix
    // narrows it to those, rather than removing it.
    mockFetch.mockRejectedValueOnce(new Error("socket hang up"));

    const result = await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "folder-abc" },
      "data/raw/file.json",
      "data",
      { size: 4, contentType: "application/json" }
    );

    expect(result).toEqual({
      success: false,
      error: "UNAVAILABLE",
      providerStatus: null,
      providerMessage: expect.stringContaining("socket hang up"),
      retryAfter: null,
    });
  });
});

// The collision cache hashes a name before the write and rehydrates a cold
// cache from listFiles, so the two must share a namespace. Drive stores a
// path prefix as real nested FOLDERS and the file under its bare leaf name,
// and listFiles collects every file it finds under that leaf regardless of
// which folder it came from -- so the leaf is what the cache must hash.
describe("9. the findOrCreateFolder race (spike gate H)", () => {
  // Confirmed live, not theorised: 8 concurrent writes to one brand-new nested
  // path produced 8 sibling folders with the same name (gate H, 2026-08-21).
  // findOrCreateFolder is find-then-create and Drive has no create-if-absent.
  //
  // It fires under exactly the designed-for load -- requirement 6 is 30-100
  // students inside a minute, and on a fresh metadataActive experiment those
  // are all first-time writes to data/raw/. No data is lost (listFiles
  // recurses and collects by leaf) but the researcher's Drive tree ends up
  // duplicated, which is not a valid Psych-DS layout.

  it("pre-creates the data/raw chain so the write path never has to", async () => {
    // The actual fix: make the folders at container-creation time, when there
    // is exactly one caller and therefore no race.
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "exp-folder", name: "E" } })
    );
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { files: [] } }));
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "data-id", name: "data" } })
    );
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { files: [] } }));
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "raw-id", name: "raw" } })
    );

    await gdriveProvider.createDataContainer(auth, { name: "E", parentId: "p" });

    const created = mockFetch.mock.calls
      .filter(([, opts]) => opts.method === "POST")
      .map(([, opts]) => JSON.parse(opts.body));
    expect(created).toEqual([
      { name: "E", mimeType: "application/vnd.google-apps.folder", parents: ["p"] },
      { name: "data", mimeType: "application/vnd.google-apps.folder", parents: ["exp-folder"] },
      { name: "raw", mimeType: "application/vnd.google-apps.folder", parents: ["data-id"] },
    ]);
  });

  it("does not fail experiment creation if the chain cannot be pre-made", async () => {
    // Best-effort: the write path can still create them on demand, so a
    // failure here must not cost the researcher their experiment.
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "exp-folder-2", name: "E2" } })
    );
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 500, statusText: "Server Error" }));

    const result = await gdriveProvider.createDataContainer(auth, { name: "E2", parentId: "p" });
    expect(result).toEqual({ provider: "gdrive", folderId: "exp-folder-2" });
  });

  it("converges on one folder when duplicates already exist", async () => {
    // The backstop, for experiments created before the fix above. Drive does
    // not document an ordering for a name query, so returning files[0] let two
    // concurrent writers pick DIFFERENT folders and keep fragmenting the tree.
    // Sorting makes every caller agree.
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { files: [{ id: "zzz-late" }, { id: "aaa-first" }, { id: "mmm-mid" }] },
      })
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { id: "file-id", name: "x.json" } })
    );

    await gdriveProvider.writeSessionFile(
      auth,
      { provider: "gdrive", folderId: "root-folder" },
      "data/x.json",
      "{}",
      { size: 2, contentType: "application/json" }
    );

    // The upload names the deterministic winner, not whichever Drive listed
    // first.
    const upload = mockFetch.mock.calls.at(-1)[1].body;
    expect(String(upload)).toContain("aaa-first");
  });
});

describe("storedNameFor (collision-cache namespace)", () => {
  // gdrive declares no storedNameFor at all: it stores path prefixes as real
  // nested folders and listFiles reports every file under its full
  // container-relative path, so identity is already correct and omitting the
  // hook is how the interface spells that (see StorageProvider.storedNameFor).
  //
  // It used to keep only the leaf, deliberately over-claiming so two folders
  // could not hide a duplicate from a leaf-only listing. That cost more than
  // it bought: Drive returns no NAME_CONFLICT, so the cache is the only
  // duplicate gate, and the over-claim rejected legitimate submissions that
  // differed only by folder.
  it("is absent, so claimNameFor passes the path through unchanged", () => {
    expect(gdriveProvider.storedNameFor).toBeUndefined();
    expect(claimNameFor(gdriveProvider, "data/raw/abc123.json")).toBe("data/raw/abc123.json");
    expect(claimNameFor(gdriveProvider, "condition-A/abc.json")).toBe("condition-A/abc.json");
    expect(claimNameFor(gdriveProvider, "flat.json")).toBe("flat.json");
  });

  // Two paths sharing a leaf must stay distinct claims -- the regression this
  // adapter used to have.
  it("keeps same-leaf files in different folders in separate claim namespaces", () => {
    expect(claimNameFor(gdriveProvider, "condition-A/abc.json")).not.toBe(
      claimNameFor(gdriveProvider, "condition-B/abc.json")
    );
  });

  // OSF agrees, by a different route: it keeps the path as real nested folders
  // AND answers a duplicate write with 409.
  it("matches osf, which also keeps the whole path", () => {
    expect(osfProvider.storedNameFor("data/raw/abc123.json")).toBe("data/raw/abc123.json");
  });
});
