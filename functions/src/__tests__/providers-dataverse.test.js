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

import { dataverseProvider } from "../../lib/providers/dataverse.js";

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
