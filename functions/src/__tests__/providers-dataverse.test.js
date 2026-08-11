/**
 * @jest-environment node
 */

// Runs in the node environment, not the project-default jsdom -- mirrors
// providers-gdrive.test.js's docblock. dataverse.ts does not itself pull in
// app.js/firebase-admin (it has no refreshExpiringTokens pass, so there's no
// db query to make), but it does import crypto-utils.ts and interfaces.ts,
// and the docblock + node-fetch mock convention is kept for consistency with
// every other adapter suite (see commit 0664bd5/313abbf/9008f67).

const mockFetch = jest.fn();

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

import { dataverseProvider, supportsTabIngest, parseTokenExpiry } from "../../lib/providers/dataverse.js";

const SERVER_URL = "https://dataverse.mock.test";

beforeEach(() => {
  mockFetch.mockClear();
});

function mockResponse({ status, statusText, jsonBody, textBody }) {
  return {
    status,
    statusText,
    json: () => Promise.resolve(jsonBody),
    text: () => Promise.resolve(textBody),
  };
}

// Case-insensitive header lookup -- mirrors providers-gdrive.test.js's
// convention, since the exact casing of the headers object isn't spec'd
// beyond "X-Dataverse-key" style.
function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function callArgs(index = 0) {
  const [url, options] = mockFetch.mock.calls[index];
  return { url, options };
}

const auth = { token: "test-token", serverUrl: SERVER_URL };

describe("1. resolveToken", () => {
  it("returns the decrypted token AND serverUrl for a connected account", async () => {
    const userData = {
      connectedAccounts: {
        dataverse: {
          authMethod: "static-token",
          // decrypt() falls back to plaintext for values without the "v1:"
          // prefix, so a plain string round-trips through decrypt() intact
          // without needing to set up TOKEN_ENCRYPTION_KEY for this test.
          encryptedToken: "plaintext-dataverse-token",
          serverUrl: SERVER_URL,
        },
      },
    };

    const result = await dataverseProvider.resolveToken(userData, "owner-uid");

    expect(result).toEqual({
      success: true,
      token: "plaintext-dataverse-token",
      serverUrl: SERVER_URL,
    });
  });

  it("returns PROVIDER_NOT_CONNECTED when the owner has no dataverse connection", async () => {
    const result = await dataverseProvider.resolveToken({ connectedAccounts: {} }, "owner-uid");

    expect(result).toEqual({
      success: false,
      error: "PROVIDER_NOT_CONNECTED",
      detail: "No connected Dataverse account for this experiment's owner",
    });
  });

  it("returns PROVIDER_TOKEN_EXPIRED when tokenExpiresAt has passed", async () => {
    const userData = {
      connectedAccounts: {
        dataverse: {
          authMethod: "static-token",
          encryptedToken: "plaintext-dataverse-token",
          serverUrl: SERVER_URL,
          tokenExpiresAt: Date.now() - 1000,
        },
      },
    };

    const result = await dataverseProvider.resolveToken(userData, "owner-uid");

    expect(result).toEqual({
      success: false,
      error: "PROVIDER_TOKEN_EXPIRED",
      detail: "The Dataverse API token for this experiment's owner has expired",
    });
  });
});

describe("2. writeSessionFile", () => {
  it("sends X-Dataverse-key, POSTs to the dataset's /add URL, and includes tabIngest:\"false\"", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: {
          status: "OK",
          data: { files: [{ label: "data.json", dataFile: { id: 42 } }] },
        },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.writeSessionFile(auth, container, "data.json", '{"a":1}', {
      size: 8,
      contentType: "application/json",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, options } = callArgs(0);

    expect(url).toBe(`${SERVER_URL}/api/datasets/7/add`);
    expect(options.method).toBe("POST");
    expect(header(options.headers, "X-Dataverse-key")).toBe("test-token");

    const contentType = header(options.headers, "Content-Type");
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);

    const body = options.body.toString();
    expect(body).toContain('name="file"; filename="data.json"');
    expect(body).toContain('name="jsonData"');
    expect(body).toContain('"tabIngest":"false"');

    expect(result).toEqual({
      success: true,
      fileRef: { name: "data.json", id: "42" },
      storedFilename: "data.json",
    });
  });

  it("returns storedFilename from the response label when Dataverse silently renamed the file", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: {
          status: "OK",
          data: { files: [{ label: "data-1.json", dataFile: { id: 99 } }] },
        },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.writeSessionFile(auth, container, "data.json", '{"a":1}', {
      size: 8,
      contentType: "application/json",
    });

    // The request asked for "data.json" -- the response label is "data-1.json"
    // (Dataverse's silent-rename behavior on a duplicate name). storedFilename
    // MUST reflect the renamed label, not the requested name.
    const requestBody = callArgs(0).options.body.toString();
    expect(requestBody).toContain('filename="data.json"');

    expect(result).toEqual({
      success: true,
      fileRef: { name: "data-1.json", id: "99" },
      storedFilename: "data-1.json",
    });
  });

  it("also treats a 201 response as success (defensive per the docs-vs-source discrepancy)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 201,
        statusText: "Created",
        jsonBody: { status: "OK", data: { files: [{ label: "data.json", dataFile: { id: 1 } }] } },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.writeSessionFile(auth, container, "data.json", "x", {
      size: 1,
      contentType: "text/plain",
    });

    expect(result.success).toBe(true);
  });

  it("sets directoryLabel and strips the path prefix from the uploaded file name", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: {
          status: "OK",
          data: { files: [{ label: "abc123.json", directoryLabel: "data/raw", dataFile: { id: 5 } }] },
        },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.writeSessionFile(auth, container, "data/raw/abc123.json", "x", {
      size: 1,
      contentType: "application/json",
    });

    const body = callArgs(0).options.body.toString();
    expect(body).toContain('filename="abc123.json"');
    expect(body).not.toContain('filename="data/raw/abc123.json"');
    expect(body).toContain('"directoryLabel":"data/raw"');

    expect(result).toEqual({
      success: true,
      fileRef: { name: "abc123.json", id: "5" },
      storedFilename: "abc123.json",
    });
  });

  it("omits directoryLabel entirely when the filename has no path prefix", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { status: "OK", data: { files: [{ label: "flat.json", dataFile: { id: 6 } }] } },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    await dataverseProvider.writeSessionFile(auth, container, "flat.json", "x", {
      size: 1,
      contentType: "application/json",
    });

    const body = callArgs(0).options.body.toString();
    expect(body).not.toContain("directoryLabel");
  });

  // The filename arrives from the participant's POST body with no character
  // validation. Interpolated raw, a quote closed the Content-Disposition
  // parameter and a CRLF ended the header block, which was enough to forge a
  // second jsonData part and pick the directoryLabel the file landed in.
  it("escapes quotes and strips CRLF from the filename in Content-Disposition", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { status: "OK", data: { files: [{ label: "evil.json", dataFile: { id: 9 } }] } },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    // No "/" anywhere: writeSessionFile would split a slashed name into
    // directoryLabel + label, and the point here is the leaf that actually
    // reaches the Content-Disposition header.
    const hostile =
      'evil";\r\n\r\n--x\r\nContent-Disposition: form-data; name="jsonData"\r\n\r\n{"directoryLabel":"pwned"}\r\n.json';

    await dataverseProvider.writeSessionFile(auth, container, hostile, "x", {
      size: 1,
      contentType: "application/json",
    });

    const body = callArgs(0).options.body.toString();
    // Exactly one jsonData part survives -- the one this adapter built. The
    // forged one is inert: its quotes are escaped, so it is header TEXT.
    expect(body.match(/name="jsonData"/g)).toHaveLength(1);
    expect(body).not.toContain('"directoryLabel":"pwned"');
    // The quote is escaped rather than closing the parameter, and the CRLFs
    // that would have ended the header block are gone.
    expect(body).toContain('filename="evil\\";');
    expect(body.split("Content-Type: application/json")).toHaveLength(2);
  });

  it("uses an unguessable per-request boundary that matches the Content-Type header", async () => {
    const respond = () =>
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { status: "OK", data: { files: [{ label: "a.json", dataFile: { id: 1 } }] } },
      });
    mockFetch.mockResolvedValueOnce(respond()).mockResolvedValueOnce(respond());

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const meta = { size: 1, contentType: "application/json" };
    await dataverseProvider.writeSessionFile(auth, container, "a.json", "x", meta);
    await dataverseProvider.writeSessionFile(auth, container, "a.json", "x", meta);

    const boundaryOf = (i) => {
      const { options } = callArgs(i);
      const boundary = header(options.headers, "Content-Type").replace(
        /^multipart\/form-data; boundary=/,
        ""
      );
      // The header's boundary is the one the body was actually built with.
      expect(options.body.toString()).toContain(`--${boundary}\r\n`);
      expect(options.body.toString().endsWith(`--${boundary}--`)).toBe(true);
      return boundary;
    };

    // Unguessable: not a fixed constant a participant could embed in their
    // own submission to close the file part early.
    expect(boundaryOf(0)).not.toBe(boundaryOf(1));
  });

  // String(undefined) yields the truthy string "undefined", which sails
  // through metadata-block.ts's `if (response.fileRef.id)` guard and gets
  // persisted as a ref addressing /api/files/undefined.
  it("omits fileRef.id rather than stringifying it when the response carries no dataFile id", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { status: "OK", data: { files: [{ label: "data.json" }] } },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.writeSessionFile(auth, container, "data.json", "x", {
      size: 1,
      contentType: "application/json",
    });

    expect(result.success).toBe(true);
    expect(result.fileRef).toEqual({ name: "data.json" });
    expect(result.fileRef.id).toBeUndefined();
  });

  it("falls back to the requested name when the response carries no label", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: {} } })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.writeSessionFile(auth, container, "data/raw/x.json", "x", {
      size: 1,
      contentType: "application/json",
    });

    // The write succeeded; an unreadable body only costs us rename detection.
    expect(result).toEqual({
      success: true,
      fileRef: { name: "x.json" },
      storedFilename: "x.json",
    });
  });
});

// The collision cache hashes a name before the write and rehydrates a cold
// cache from listFiles, so the two must share a namespace. Dataverse splits a
// path into directoryLabel + label on write and listFiles re-joins them, so
// the requested path round-trips and this is identity -- unlike Zenodo, which
// flattens, and Drive, which keeps only the leaf.
describe("2b. storedNameFor (collision-cache namespace)", () => {
  it("is identity, matching what listFiles re-joins", () => {
    expect(dataverseProvider.storedNameFor("data/raw/abc123.json")).toBe("data/raw/abc123.json");
    expect(dataverseProvider.storedNameFor("flat.json")).toBe("flat.json");
  });
});

describe("3. error mapping", () => {
  const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };

  it("maps 401 to AUTH_EXPIRED", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 401,
        statusText: "Unauthorized",
        jsonBody: { status: "ERROR", message: "Bad API key" },
      })
    );

    const result = await dataverseProvider.writeSessionFile(auth, container, "file.json", "data", {
      size: 4,
      contentType: "application/json",
    });

    expect(result).toEqual({
      success: false,
      error: "AUTH_EXPIRED",
      providerStatus: 401,
      providerMessage: "Bad API key",
      retryAfter: null,
    });
  });

  it("maps a 403 dataset-lock message to UNAVAILABLE", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 403,
        statusText: "Forbidden",
        jsonBody: { status: "ERROR", message: "Dataset cannot be edited due to dataset lock." },
      })
    );

    const result = await dataverseProvider.writeSessionFile(auth, container, "file.json", "data", {
      size: 4,
      contentType: "application/json",
    });

    expect(result).toEqual({
      success: false,
      error: "UNAVAILABLE",
      providerStatus: 403,
      providerMessage: "Dataset cannot be edited due to dataset lock.",
      retryAfter: null,
    });
  });

  it("maps a 400 size-limit message to QUOTA_EXCEEDED", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        statusText: "Bad Request",
        jsonBody: { status: "ERROR", message: "the file exceeds the size limit of 1000 bytes" },
      })
    );

    const result = await dataverseProvider.writeSessionFile(auth, container, "file.json", "data", {
      size: 4,
      contentType: "application/json",
    });

    expect(result).toEqual({
      success: false,
      error: "QUOTA_EXCEEDED",
      providerStatus: 400,
      providerMessage: "the file exceeds the size limit of 1000 bytes",
      retryAfter: null,
    });
  });

  it("maps a 400 quota message (\"remaining storage quota\") to QUOTA_EXCEEDED", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        statusText: "Bad Request",
        jsonBody: { status: "ERROR", message: "this file exceeds the remaining storage quota" },
      })
    );

    const result = await dataverseProvider.writeSessionFile(auth, container, "file.json", "data", {
      size: 4,
      contentType: "application/json",
    });

    expect(result.error).toBe("QUOTA_EXCEEDED");
  });

  it("maps 429 to RATE_LIMITED with retryAfter always null (Dataverse never sends Retry-After)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 429,
        statusText: "Too Many Requests",
        jsonBody: { status: "ERROR", message: "slow down" },
      })
    );

    const result = await dataverseProvider.writeSessionFile(auth, container, "file.json", "data", {
      size: 4,
      contentType: "application/json",
    });

    expect(result).toEqual({
      success: false,
      error: "RATE_LIMITED",
      providerStatus: 429,
      providerMessage: "slow down",
      retryAfter: null,
    });
  });

  it("maps a 400 'Failed to add file to dataset.' to CONTENTION (concurrent write rejected)", async () => {
    // Live-verified against demo.dataverse.org, 2026-07-26: exactly one
    // concurrent write per dataset succeeds, every other in-flight write is
    // rejected with this generic 400 in ~250ms. It clears in seconds, so the
    // upload queue should retry it on the fast tier rather than the
    // outage-scale backoff UNAVAILABLE gets.
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        statusText: "Bad Request",
        jsonBody: { status: "ERROR", message: "Failed to add file to dataset." },
      })
    );

    const result = await dataverseProvider.writeSessionFile(auth, container, "file.json", "data", {
      size: 4,
      contentType: "application/json",
    });

    expect(result).toEqual({
      success: false,
      error: "CONTENTION",
      providerStatus: 400,
      providerMessage: "Failed to add file to dataset.",
      retryAfter: null,
    });
  });

  it("does NOT map a 400 'same content' rejection to CONTENTION (regression guard for the exclusion)", async () => {
    // Dataverse also rejects byte-identical content with this message, which
    // also contains "Failed to add file to dataset." -- but re-uploading
    // identical content is not transient the way a concurrent-write
    // collision is, so this must NOT be treated as CONTENTION (retrying fast
    // would just spin uselessly). It falls through to the existing
    // UNAVAILABLE mapping instead.
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        statusText: "Bad Request",
        jsonBody: {
          status: "ERROR",
          message: "This file has the same content as an existing file. \nFailed to add file to dataset.",
        },
      })
    );

    const result = await dataverseProvider.writeSessionFile(auth, container, "file.json", "data", {
      size: 4,
      contentType: "application/json",
    });

    expect(result.error).toBe("UNAVAILABLE");
    expect(result.error).not.toBe("CONTENTION");
  });

  it("still maps the existing size-limit 400 to QUOTA_EXCEEDED, not CONTENTION (order-of-checks regression guard)", async () => {
    // The size-limit/quota checks must keep winning over the new CONTENTION
    // check for their own 400 messages -- they don't mention "failed to add
    // file" so this mostly documents the existing behavior stays intact
    // after the new branch was inserted between them and the 429 check.
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        statusText: "Bad Request",
        jsonBody: { status: "ERROR", message: "the file exceeds the size limit of 1000 bytes" },
      })
    );

    const result = await dataverseProvider.writeSessionFile(auth, container, "file.json", "data", {
      size: 4,
      contentType: "application/json",
    });

    expect(result.error).toBe("QUOTA_EXCEEDED");
  });

  it("maps anything else (e.g. 500) to UNAVAILABLE", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 500, statusText: "Internal Server Error", jsonBody: undefined }));

    const result = await dataverseProvider.writeSessionFile(auth, container, "file.json", "data", {
      size: 4,
      contentType: "application/json",
    });

    expect(result).toEqual({
      success: false,
      error: "UNAVAILABLE",
      providerStatus: 500,
      providerMessage: "Internal Server Error",
      retryAfter: null,
    });
  });

  it("tolerates a non-JSON error body and falls back to statusText", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 401,
      statusText: "Unauthorized",
      json: () => Promise.reject(new Error("not json")),
    });

    const result = await dataverseProvider.writeSessionFile(auth, container, "file.json", "data", {
      size: 4,
      contentType: "application/json",
    });

    expect(result).toEqual({
      success: false,
      error: "AUTH_EXPIRED",
      providerStatus: 401,
      providerMessage: "Unauthorized",
      retryAfter: null,
    });
  });
});

describe("4. updateFile", () => {
  it("issues the DELETE then re-adds the file, returning the new WriteResult", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK" } }));
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { status: "OK", data: { files: [{ label: "data.json", dataFile: { id: 55 } }] } },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const existingFileRef = { id: "42", name: "data.json" };

    const result = await dataverseProvider.updateFile(auth, container, existingFileRef, "new-data", {
      size: 8,
      contentType: "application/json",
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const deleteCall = callArgs(0);
    expect(deleteCall.url).toBe(`${SERVER_URL}/api/files/42`);
    expect(deleteCall.options.method).toBe("DELETE");
    expect(header(deleteCall.options.headers, "X-Dataverse-key")).toBe("test-token");

    const addCall = callArgs(1);
    expect(addCall.url).toBe(`${SERVER_URL}/api/datasets/7/add`);
    expect(addCall.options.method).toBe("POST");

    expect(result).toEqual({
      success: true,
      fileRef: { name: "data.json", id: "55" },
      storedFilename: "data.json",
    });
  });

  it("returns a failure WriteResult (does not proceed to re-add) when the DELETE fails", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 401, statusText: "Unauthorized", jsonBody: { status: "ERROR", message: "Bad API key" } })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const existingFileRef = { id: "42", name: "data.json" };

    const result = await dataverseProvider.updateFile(auth, container, existingFileRef, "new-data", {
      size: 8,
      contentType: "application/json",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: false,
      error: "AUTH_EXPIRED",
      providerStatus: 401,
      providerMessage: "Bad API key",
      retryAfter: null,
    });
  });
});

describe("5. listFiles pagination", () => {
  it("paginates across two pages and returns the flattened list", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: {
          status: "OK",
          totalCount: 3,
          data: [
            { label: "a.csv", dataFile: { id: 1 } },
            { label: "b.csv", dataFile: { id: 2 } },
          ],
        },
      })
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: {
          status: "OK",
          totalCount: 3,
          data: [{ label: "c.csv", dataFile: { id: 3 } }],
        },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.listFiles(auth, container);

    expect(result).toEqual([
      { name: "a.csv", id: "1" },
      { name: "b.csv", id: "2" },
      { name: "c.csv", id: "3" },
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const url1 = new URL(callArgs(0).url);
    const url2 = new URL(callArgs(1).url);
    expect(url1.pathname).toBe("/api/datasets/7/versions/:draft/files");
    expect(url1.searchParams.get("limit")).toBe("1000");
    expect(url1.searchParams.get("offset")).toBe("0");
    expect(url2.searchParams.get("offset")).toBe("2");
  });

  it("re-joins directoryLabel with label so names round-trip with writeSessionFile's path-prefixed filenames", async () => {
    // Regression guard. Returning the bare `label` here would break two
    // things: updateFile re-adds under existingFileRef.name and would drop a
    // subfolder file back to the dataset root, and the collision cache claims
    // PREFIXED filenames -- so rehydration would fail to match an existing
    // file and let a duplicate through, which Dataverse silently renames
    // rather than rejecting.
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: {
          status: "OK",
          totalCount: 3,
          data: [
            { label: "data.json", directoryLabel: "condition-A", dataFile: { id: 11 } },
            // Same label, different directory -- these must stay distinct.
            { label: "data.json", directoryLabel: "condition-B", dataFile: { id: 12 } },
            // No directoryLabel at all -- stays bare, no leading slash.
            { label: "dataset_description.json", dataFile: { id: 13 } },
          ],
        },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.listFiles(auth, container);

    expect(result).toEqual([
      { name: "condition-A/data.json", id: "11" },
      { name: "condition-B/data.json", id: "12" },
      { name: "dataset_description.json", id: "13" },
    ]);
  });

  it("stops when a page comes back empty even if totalCount was never reached (infinite-loop guard)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { status: "OK", totalCount: 100, data: [] },
      })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.listFiles(auth, container);

    expect(result).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws (never returns a partial/empty list) when the listing request fails", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 401, statusText: "Unauthorized", jsonBody: { status: "ERROR", message: "Bad API key" } })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };

    await expect(dataverseProvider.listFiles(auth, container)).rejects.toThrow(/listing failed/i);
  });
});

describe("6. downloadFile", () => {
  it("GETs the access/datafile endpoint and returns the body text as content", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", textBody: "file body text" }));

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.downloadFile(auth, container, { id: "42", name: "data.json" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, options } = callArgs(0);
    expect(url).toBe(`${SERVER_URL}/api/access/datafile/42`);
    expect(options.method).toBe("GET");
    expect(header(options.headers, "X-Dataverse-key")).toBe("test-token");

    expect(result).toEqual({ success: true, content: "file body text" });
  });

  it("maps a 401 on download the same way as writes", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 401, statusText: "Unauthorized", jsonBody: { status: "ERROR", message: "Bad API key" } })
    );

    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc", serverUrl: SERVER_URL };
    const result = await dataverseProvider.downloadFile(auth, container, { id: "42", name: "data.json" });

    expect(result).toEqual({
      success: false,
      error: "AUTH_EXPIRED",
      providerStatus: 401,
      providerMessage: "Bad API key",
    });
  });
});

describe("7. createDataContainer", () => {
  it("accepts a 201 Created, which is what a real Dataverse returns", async () => {
    // Regression guard, found live against demo.dataverse.org on 2026-07-26:
    // the guides say dataset creation returns 200, but the server returns 201.
    // This method used to hardcode `status !== 200`, so EVERY real dataset
    // creation threw. (The docs are wrong both ways -- they also claim /add
    // returns 201 when it actually returns 200.)
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 201,
        statusText: "Created",
        jsonBody: { status: "OK", data: { id: 456, persistentId: "doi:10.5072/FK2/CREATED" } },
      })
    );

    const result = await dataverseProvider.createDataContainer(auth, {
      collectionAlias: "my-collection",
      title: "My Study",
      authorName: "Ada Lovelace",
      contactEmail: "ada@example.edu",
      description: "A study",
    });

    expect(result).toEqual({
      provider: "dataverse",
      datasetId: 456,
      persistentId: "doi:10.5072/FK2/CREATED",
      serverUrl: SERVER_URL,
    });
  });

  it("posts the citation metadata block and returns datasetId/persistentId/serverUrl", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { status: "OK", data: { id: 123, persistentId: "doi:10.5072/FK2/ABC123" } },
      })
    );

    const result = await dataverseProvider.createDataContainer(auth, {
      collectionAlias: "my-collection",
      title: "My Study",
      authorName: "Ada Lovelace",
      contactEmail: "ada@example.com",
      description: "A study about things.",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, options } = callArgs(0);
    expect(url).toBe(`${SERVER_URL}/api/dataverses/my-collection/datasets`);
    expect(options.method).toBe("POST");
    expect(header(options.headers, "Content-Type")).toBe("application/json");
    expect(header(options.headers, "X-Dataverse-key")).toBe("test-token");

    const body = JSON.parse(options.body);
    const fields = body.datasetVersion.metadataBlocks.citation.fields;

    const title = fields.find((f) => f.typeName === "title");
    expect(title).toEqual({ typeName: "title", typeClass: "primitive", multiple: false, value: "My Study" });

    const author = fields.find((f) => f.typeName === "author");
    expect(author.value[0].authorName.value).toBe("Ada Lovelace");

    const contact = fields.find((f) => f.typeName === "datasetContact");
    expect(contact.value[0].datasetContactEmail.value).toBe("ada@example.com");

    const desc = fields.find((f) => f.typeName === "dsDescription");
    expect(desc.value[0].dsDescriptionValue.value).toBe("A study about things.");

    const subject = fields.find((f) => f.typeName === "subject");
    expect(subject).toEqual({
      typeName: "subject",
      typeClass: "controlledVocabulary",
      multiple: true,
      value: ["Social Sciences"],
    });

    expect(result).toEqual({
      provider: "dataverse",
      datasetId: 123,
      persistentId: "doi:10.5072/FK2/ABC123",
      serverUrl: SERVER_URL,
    });
  });

  it("uses a caller-supplied subject instead of the default", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { status: "OK", data: { id: 124, persistentId: "doi:10.5072/FK2/DEF456" } },
      })
    );

    await dataverseProvider.createDataContainer(auth, {
      collectionAlias: "my-collection",
      title: "My Study",
      authorName: "Ada Lovelace",
      contactEmail: "ada@example.com",
      description: "A study about things.",
      subject: "Computer and Information Science",
    });

    const body = JSON.parse(callArgs(0).options.body);
    const subject = body.datasetVersion.metadataBlocks.citation.fields.find((f) => f.typeName === "subject");
    expect(subject.value).toEqual(["Computer and Information Science"]);
  });

  it("throws an informative error when dataset creation fails", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 401,
        statusText: "Unauthorized",
        jsonBody: { status: "ERROR", message: "Bad API key" },
      })
    );

    await expect(
      dataverseProvider.createDataContainer(auth, {
        collectionAlias: "my-collection",
        title: "My Study",
        authorName: "Ada Lovelace",
        contactEmail: "ada@example.com",
        description: "A study about things.",
      })
    ).rejects.toThrow(/dataset creation failed/i);
  });

  // Casting the optionality away instead returned a ContainerRef with
  // undefined fields; create-experiment.ts handed that to Firestore, which
  // rejects undefined values, so the batch commit threw and the researcher
  // got a generic 500 with an orphaned draft dataset already created.
  it.each([
    ["no id", { status: "OK", data: { persistentId: "doi:10/abc" } }],
    ["no persistentId", { status: "OK", data: { id: 456 } }],
    ["no data at all", { status: "OK" }],
  ])("throws on a 2xx whose body has %s, rather than returning undefined fields", async (_label, jsonBody) => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 201, statusText: "Created", jsonBody }));

    await expect(
      dataverseProvider.createDataContainer(auth, {
        collectionAlias: "my-collection",
        title: "My Study",
        authorName: "Ada Lovelace",
        contactEmail: "ada@example.com",
        description: "A study about things.",
      })
    ).rejects.toThrow(/no id or persistent id/i);
  });
});

describe("8. federated serverUrl resolution", () => {
  it("falls back to auth.serverUrl when the container doesn't carry one", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", textBody: "content" }));

    // Container deliberately omits serverUrl.
    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc" };
    const result = await dataverseProvider.downloadFile(auth, container, { id: "42", name: "data.json" });

    expect(callArgs(0).url).toBe(`${SERVER_URL}/api/access/datafile/42`);
    expect(result).toEqual({ success: true, content: "content" });
  });

  it("prefers the container's serverUrl over auth's when both are present", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", textBody: "content" }));

    const container = {
      provider: "dataverse",
      datasetId: 7,
      persistentId: "doi:10/abc",
      serverUrl: "https://institution.example.edu",
    };
    await dataverseProvider.downloadFile(auth, container, { id: "42", name: "data.json" });

    expect(callArgs(0).url).toBe("https://institution.example.edu/api/access/datafile/42");
  });

  it("throws a clear error when neither the container nor auth carries a serverUrl", async () => {
    const authWithoutServer = { token: "test-token" };
    const container = { provider: "dataverse", datasetId: 7, persistentId: "doi:10/abc" };

    await expect(
      dataverseProvider.downloadFile(authWithoutServer, container, { id: "42", name: "data.json" })
    ).rejects.toThrow(/serverUrl/i);
  });
});

describe("10. supportsTabIngest (version parsing, lenient by design)", () => {
  // tabIngest was added in Dataverse 5.11. Real installations return version
  // strings in inconsistent shapes -- verified live, 2026-07-26 -- so parsing
  // must tolerate all of them rather than requiring strict semver.
  it("returns true for demo.dataverse.org's \"6.11\"", () => {
    expect(supportsTabIngest("6.11")).toBe(true);
  });

  it("returns true for dataverse.harvard.edu's \"6.10.1\"", () => {
    expect(supportsTabIngest("6.10.1")).toBe(true);
  });

  it("returns true for borealisdata.ca's \"v6.8.2-SP\" (leading v, trailing -SP suffix)", () => {
    expect(supportsTabIngest("v6.8.2-SP")).toBe(true);
  });

  it("returns true at the exact boundary, \"5.11\" (supported)", () => {
    expect(supportsTabIngest("5.11")).toBe(true);
  });

  it("returns false just below the boundary, \"5.10\" (unsupported)", () => {
    expect(supportsTabIngest("5.10")).toBe(false);
  });

  it("returns false for an old major version, \"4.20\" (unsupported)", () => {
    expect(supportsTabIngest("4.20")).toBe(false);
  });

  it("returns null for an unparseable version string", () => {
    expect(supportsTabIngest("unknown")).toBeNull();
  });
});

describe("11. setupWarnings", () => {
  it("returns [] when the installation reports a version >= 5.11 and the token isn't near expiry", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: { version: "6.11" } } })
    );
    // setupWarnings also runs the (independent) expiry check -- see suite
    // 12 below -- so a second call against /api/users/token happens here
    // too. A far-future expiry keeps this scenario warning-free.
    const farFuture = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: { status: "OK", data: { message: `Token abc expires on ${farFuture}` } },
      })
    );

    const result = await dataverseProvider.setupWarnings(auth);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const { url, options } = callArgs(0);
    expect(url).toBe(`${SERVER_URL}/api/info/version`);
    expect(options.method).toBe("GET");
    // The key is sent for consistency even though the endpoint is
    // unauthenticated and ignores it.
    expect(header(options.headers, "X-Dataverse-key")).toBe("test-token");
    expect(result).toEqual([]);
  });

  it("returns a single warning naming the detected version when it predates 5.11", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: { version: "5.10" } } })
    );

    const result = await dataverseProvider.setupWarnings(auth);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/5\.10/);
    expect(result[0]).toMatch(/5\.11/i);
  });

  it("returns [] (fails open) on a non-OK response", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 500, statusText: "Internal Server Error", jsonBody: undefined })
    );

    const result = await dataverseProvider.setupWarnings(auth);

    expect(result).toEqual([]);
  });

  it("returns [] (fails open) when fetch rejects", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const result = await dataverseProvider.setupWarnings(auth);

    expect(result).toEqual([]);
  });

  it("returns an expiry warning naming the date when the token expires within 60 days", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: { version: "6.11" } } })
    );
    const tenDaysOut = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const message = `Token abc expires on ${tenDaysOut.toISOString().slice(0, 10)} 14:14:52.317`;
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: { message } } })
    );

    const result = await dataverseProvider.setupWarnings(auth);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain(tenDaysOut.toISOString().slice(0, 10));
    expect(result[0]).toMatch(/recreated and reconnected/i);
  });

  it("returns an expired-token warning when the token's expiry is in the past", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: { version: "6.11" } } })
    );
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const message = `Token abc expires on ${yesterday.toISOString().slice(0, 10)} 14:14:52.317`;
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: { message } } })
    );

    const result = await dataverseProvider.setupWarnings(auth);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/expired/i);
    expect(result[0]).toMatch(/recreated and reconnected/i);
  });

  it("returns no expiry warning when the token expires 2 years out", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: { version: "6.11" } } })
    );
    const twoYearsOut = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);
    const message = `Token abc expires on ${twoYearsOut.toISOString().slice(0, 10)} 14:14:52.317`;
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: { message } } })
    );

    const result = await dataverseProvider.setupWarnings(auth);

    expect(result).toEqual([]);
  });

  it("returns BOTH warnings when an old version AND a near expiry apply together", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: { version: "5.10" } } })
    );
    const tenDaysOut = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const message = `Token abc expires on ${tenDaysOut.toISOString().slice(0, 10)} 14:14:52.317`;
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, statusText: "OK", jsonBody: { status: "OK", data: { message } } })
    );

    const result = await dataverseProvider.setupWarnings(auth);

    expect(result).toHaveLength(2);
    expect(result.some((w) => /5\.10/.test(w) && /5\.11/i.test(w))).toBe(true);
    expect(result.some((w) => w.includes(tenDaysOut.toISOString().slice(0, 10)))).toBe(true);
  });
});

describe("12. parseTokenExpiry", () => {
  it("parses the real live-verified message into a time in 2027", () => {
    const ms = parseTokenExpiry("Token 72211678-a30c-4523-81bf-e703c904656e expires on 2027-07-26 14:14:52.317");

    expect(ms).not.toBeNull();
    expect(new Date(ms).getUTCFullYear()).toBe(2027);
  });

  it("returns null for a reworded message", () => {
    expect(parseTokenExpiry("Your token will no longer be valid after 2027-07-26 14:14:52.317")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseTokenExpiry("")).toBeNull();
  });

  it("returns null for a message with an unparseable date", () => {
    expect(parseTokenExpiry("Token abc expires on not-a-real-date")).toBeNull();
  });
});

describe("13. staticTokenExpiry", () => {
  it("returns epoch ms on a 200 response with a valid message", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        statusText: "OK",
        jsonBody: {
          status: "OK",
          data: { message: "Token 72211678-a30c-4523-81bf-e703c904656e expires on 2027-07-26 14:14:52.317" },
        },
      })
    );

    const result = await dataverseProvider.staticTokenExpiry(auth);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, options } = callArgs(0);
    expect(url).toBe(`${SERVER_URL}/api/users/token`);
    expect(options.method).toBe("GET");
    expect(header(options.headers, "X-Dataverse-key")).toBe("test-token");
    expect(result).not.toBeNull();
    expect(new Date(result).getUTCFullYear()).toBe(2027);
  });

  it("returns null on a 404", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 404, statusText: "Not Found", jsonBody: { status: "ERROR", message: "not found" } })
    );

    const result = await dataverseProvider.staticTokenExpiry(auth);

    expect(result).toBeNull();
  });

  it("returns null (never throws) when fetch rejects", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const result = await dataverseProvider.staticTokenExpiry(auth);

    expect(result).toBeNull();
  });
});

describe("9. validateStaticToken", () => {
  it("returns true on a 200 response from /api/users/:me", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, statusText: "OK", jsonBody: {} }));

    const result = await dataverseProvider.validateStaticToken(auth);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, options } = callArgs(0);
    expect(url).toBe(`${SERVER_URL}/api/users/:me`);
    expect(options.method).toBe("GET");
    expect(header(options.headers, "X-Dataverse-key")).toBe("test-token");
    expect(result).toBe(true);
  });

  it("returns false (never throws) on a non-200 response", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 401, statusText: "Unauthorized", jsonBody: { status: "ERROR", message: "Bad API key" } })
    );

    const result = await dataverseProvider.validateStaticToken(auth);

    expect(result).toBe(false);
  });
});
