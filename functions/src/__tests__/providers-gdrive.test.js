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

    expect(url).toBe(`${API_BASE}/upload/drive/v3/files?uploadType=multipart`);
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
    expect(uploadCall.url).toBe(`${API_BASE}/upload/drive/v3/files?uploadType=multipart`);
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

    // Files from every level are concatenated, keyed by their own leaf name
    // (not qualified by folder) so hashing `salt:name` matches a claim made
    // on the raw leaf filename.
    expect(result).toEqual([
      { name: "a.csv", id: "f1" },
      { name: "b.csv", id: "f2" },
      { name: "c.csv", id: "f3" },
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
    expect(url).toBe(`${API_BASE}/upload/drive/v3/files/gdrive-existing-1?uploadType=media`);
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

    const result = await gdriveProvider.createDataContainer(auth, { name: "My Experiment" });

    expect(mockFetch).toHaveBeenCalledTimes(2);

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

    const result = await gdriveProvider.createDataContainer(auth, { name: "My Experiment 2" });

    expect(mockFetch).toHaveBeenCalledTimes(3);

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
});

describe("7. downloadFile", () => {
  it("gdrive: GETs the alt=media endpoint and returns the body text as content", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", textBody: "file body text" }));

    const container = { provider: "gdrive", folderId: "folder-abc" };
    const result = await gdriveProvider.downloadFile(auth, container, { id: "gdrive-file-9", name: "data.json" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, options } = callArgs(0);
    expect(url).toBe(`${API_BASE}/drive/v3/files/gdrive-file-9?alt=media`);
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
