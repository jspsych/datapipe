/**
 * @jest-environment node
 */

// Runs in the node environment, not the project-default jsdom -- mirrors
// providers-dataverse.test.js / providers-gdrive.test.js. node-fetch is
// ESM-only with no CJS build, so it must be mocked here rather than resolved.

const mockFetch = jest.fn();

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

import { zenodoProvider, isAllowedZenodoServer } from "../../lib/providers/zenodo.js";

const SERVER_URL = "https://sandbox.zenodo.org";
const BUCKET_URL = "https://sandbox.zenodo.org/api/files/abc-123";
const DEPOSITION_ID = 987654;

beforeEach(() => {
  mockFetch.mockClear();
});

function mockResponse({ status, statusText, jsonBody, textBody, headers }) {
  return {
    status,
    statusText,
    json: () => Promise.resolve(jsonBody),
    text: () => Promise.resolve(textBody),
    headers: { get: (name) => (headers || {})[name.toLowerCase()] ?? null },
  };
}

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

const container = {
  provider: "zenodo",
  depositionId: DEPOSITION_ID,
  bucketUrl: BUCKET_URL,
  serverUrl: SERVER_URL,
};

const meta = { size: 12, contentType: "application/json" };

describe("1. resolveToken", () => {
  it("returns the decrypted token and serverUrl for a connected account", async () => {
    const userData = {
      connectedAccounts: {
        zenodo: {
          authMethod: "static-token",
          // decrypt() falls back to plaintext for values without the "v1:"
          // prefix, so a plain string round-trips without needing
          // TOKEN_ENCRYPTION_KEY set up for this test.
          encryptedToken: "plain-token",
          serverUrl: SERVER_URL,
        },
      },
    };
    const result = await zenodoProvider.resolveToken(userData, "owner-uid");
    expect(result).toEqual({ success: true, token: "plain-token", serverUrl: SERVER_URL });
  });

  it("fails with PROVIDER_NOT_CONNECTED when there is no zenodo account", async () => {
    const result = await zenodoProvider.resolveToken({ connectedAccounts: {} }, "owner-uid");
    expect(result.success).toBe(false);
    expect(result.error).toBe("PROVIDER_NOT_CONNECTED");
  });

  // Zenodo tokens have no documented expiry so tokenExpiresAt is normally
  // absent -- but if one is ever stored it must still be honored rather than
  // ignored.
  it("honors a stored tokenExpiresAt in the past", async () => {
    const userData = {
      connectedAccounts: {
        zenodo: {
          authMethod: "static-token",
          encryptedToken: "plain-token",
          serverUrl: SERVER_URL,
          tokenExpiresAt: Date.now() - 1000,
        },
      },
    };
    const result = await zenodoProvider.resolveToken(userData, "owner-uid");
    expect(result.success).toBe(false);
    expect(result.error).toBe("PROVIDER_TOKEN_EXPIRED");
  });

  it("does not implement staticTokenExpiry (Zenodo reports no expiry)", () => {
    expect(zenodoProvider.staticTokenExpiry).toBeUndefined();
  });
});

describe("2. server allowlist", () => {
  it("accepts the two real Zenodo hosts", () => {
    expect(isAllowedZenodoServer("https://zenodo.org")).toBe(true);
    expect(isAllowedZenodoServer("https://sandbox.zenodo.org")).toBe(true);
  });

  it("rejects lookalike and unrelated hosts", () => {
    expect(isAllowedZenodoServer("https://zenodo.org.evil.test")).toBe(false);
    expect(isAllowedZenodoServer("https://evil.test")).toBe(false);
    expect(isAllowedZenodoServer("not-a-url")).toBe(false);
  });

  it("refuses to make a request against a non-Zenodo server", async () => {
    await expect(
      zenodoProvider.listFiles(
        { token: "t", serverUrl: "https://evil.test" },
        { ...container, serverUrl: "https://evil.test" }
      )
    ).rejects.toThrow(/not a recognized zenodo installation/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The bucket URL is Firestore-stored data that every byte flows through,
  // and downloadFile echoes the response body back to the caller.
  it("rejects a bucketUrl whose origin does not match the container's server", async () => {
    const tampered = { ...container, bucketUrl: "https://evil.test/api/files/abc-123" };
    const result = await zenodoProvider
      .writeSessionFile(auth, tampered, "s.json", "{}", meta)
      .catch((e) => e);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toMatch(/bucketurl origin does not match/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("3. createDataContainer", () => {
  it("creates a dataset deposition and returns the ref", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 201,
        jsonBody: { id: DEPOSITION_ID, links: { bucket: BUCKET_URL } },
      })
    );

    const ref = await zenodoProvider.createDataContainer(auth, {
      title: "My Experiment",
      creatorName: "Doe, Jane",
      description: "A study.",
      affiliation: "Test University",
    });

    expect(ref).toEqual({
      provider: "zenodo",
      depositionId: DEPOSITION_ID,
      bucketUrl: BUCKET_URL,
      serverUrl: SERVER_URL,
    });

    const { url, options } = callArgs(0);
    expect(url).toBe(`${SERVER_URL}/api/deposit/depositions`);
    expect(options.method).toBe("POST");
    expect(header(options.headers, "Authorization")).toBe("Bearer test-token");

    const body = JSON.parse(options.body);
    expect(body.metadata.upload_type).toBe("dataset");
    expect(body.metadata.title).toBe("My Experiment");
    expect(body.metadata.creators).toEqual([{ name: "Doe, Jane", affiliation: "Test University" }]);
  });

  it("omits affiliation when not supplied", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 201, jsonBody: { id: DEPOSITION_ID, links: { bucket: BUCKET_URL } } })
    );
    await zenodoProvider.createDataContainer(auth, {
      title: "T",
      creatorName: "Doe, Jane",
      description: "D",
    });
    const body = JSON.parse(callArgs(0).options.body);
    expect(body.metadata.creators).toEqual([{ name: "Doe, Jane" }]);
  });

  // Both fields are load-bearing for every later write, so a malformed
  // success body must fail here rather than at the first participant.
  it("throws when the response omits the bucket link", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 201, jsonBody: { id: DEPOSITION_ID, links: {} } }));
    await expect(
      zenodoProvider.createDataContainer(auth, { title: "T", creatorName: "C", description: "D" })
    ).rejects.toThrow(/no id or bucket link/i);
  });

  it("throws with the provider's field-level detail on a validation error", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        jsonBody: {
          message: "Validation error.",
          errors: [{ field: "metadata.description", message: "Field may not be null." }],
        },
      })
    );
    await expect(
      zenodoProvider.createDataContainer(auth, { title: "T", creatorName: "C", description: "" })
    ).rejects.toThrow(/metadata\.description: Field may not be null/);
  });
});

describe("4. writeSessionFile", () => {
  it("PUTs raw bytes to the bucket and reports the stored key", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 201, jsonBody: { key: "session-1.json", size: 12, checksum: "md5:abc" } })
    );

    const result = await zenodoProvider.writeSessionFile(auth, container, "session-1.json", "{}", meta);

    expect(result).toEqual({
      success: true,
      fileRef: { name: "session-1.json", id: "session-1.json" },
      storedFilename: "session-1.json",
    });

    const { url, options } = callArgs(0);
    expect(url).toBe(`${BUCKET_URL}/session-1.json`);
    expect(options.method).toBe("PUT");
    // Must be octet-stream, not meta.contentType. The bucket endpoint rejects
    // anything else with a hard 415 (live sandbox, spike gate A, 2026-08-11),
    // and `meta` here declares application/json -- so this assertion is
    // specifically guarding against reintroducing that bug.
    expect(header(options.headers, "Content-Type")).toBe("application/octet-stream");
    expect(Buffer.isBuffer(options.body)).toBe(true);
  });

  // Zenodo's keyspace is FLAT -- a slash cannot be stored by any route, and
  // the legacy multipart endpoint silently rewrites "a/b.json" to "a_b.json".
  // The adapter therefore flattens up front so the name it reports is the name
  // Zenodo actually holds. See toZenodoKey in providers/zenodo.ts.
  it("flattens path separators into the key and encodes the result", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 201, jsonBody: { key: "data_raw set_a b.json" } })
    );
    const result = await zenodoProvider.writeSessionFile(
      auth,
      container,
      "data/raw set/a b.json",
      "{}",
      meta
    );
    expect(callArgs(0).url).toBe(`${BUCKET_URL}/data_raw%20set_a%20b.json`);
    expect(result.storedFilename).toBe("data_raw set_a b.json");
  });

  // metadataActive experiments upload to data/raw/<name>, so this is the
  // ordinary path for them, not an edge case.
  it("collapses backslashes and runs of separators too", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 201, jsonBody: { key: "a_b.json" } }));
    await zenodoProvider.writeSessionFile(auth, container, "a//\\b.json", "{}", meta);
    expect(callArgs(0).url).toBe(`${BUCKET_URL}/a_b.json`);
  });

  // The whole point of WriteResult.storedFilename: never assume the provider
  // kept the name we asked for.
  it("reports a server-renamed key rather than the requested name", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, jsonBody: { key: "renamed.json" } }));
    const result = await zenodoProvider.writeSessionFile(auth, container, "asked.json", "{}", meta);
    expect(result.storedFilename).toBe("renamed.json");
    expect(result.fileRef).toEqual({ name: "renamed.json", id: "renamed.json" });
  });

  it("falls back to the requested name when the response has no key", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 201, jsonBody: {} }));
    const result = await zenodoProvider.writeSessionFile(auth, container, "asked.json", "{}", meta);
    expect(result.storedFilename).toBe("asked.json");
  });

  // The fallback must report the FLATTENED name, not the raw request: the
  // collision cache matches names exactly, so recording "data/raw/x.json" for
  // an object Zenodo stored as "data_raw_x.json" would silently break dedup.
  it("falls back to the flattened name, not the raw slashed one", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 201, jsonBody: {} }));
    const result = await zenodoProvider.writeSessionFile(auth, container, "data/raw/x.json", "{}", meta);
    expect(result.storedFilename).toBe("data_raw_x.json");
    expect(result.fileRef).toEqual({ name: "data_raw_x.json", id: "data_raw_x.json" });
  });

  it("accepts a Buffer body unchanged", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 201, jsonBody: { key: "b.bin" } }));
    const buf = Buffer.from([1, 2, 3]);
    await zenodoProvider.writeSessionFile(auth, container, "b.bin", buf, {
      size: 3,
      contentType: "application/octet-stream",
    });
    expect(callArgs(0).options.body).toEqual(buf);
  });
});

describe("5. error mapping", () => {
  const cases = [
    { status: 401, jsonBody: { message: "Unauthorized" }, expected: "AUTH_EXPIRED" },
    // Under-scoped tokens 403 -- same fix as an invalid one, so same code.
    { status: 403, jsonBody: { message: "Insufficient scope" }, expected: "AUTH_EXPIRED" },
    { status: 413, jsonBody: { message: "Too large" }, expected: "QUOTA_EXCEEDED" },
    { status: 507, jsonBody: { message: "Insufficient storage" }, expected: "QUOTA_EXCEEDED" },
    { status: 400, jsonBody: { message: "File exceeds the size limit" }, expected: "QUOTA_EXCEEDED" },
    // VERBATIM message Zenodo returns at the 101st file, captured live
    // (sandbox, spike gate E, 2026-08-11). Note "exceeding" -- an earlier
    // pattern matched only "exceeds" and sent this to UNAVAILABLE, which the
    // queue retries forever against a record that can never accept a file
    // again. This case exists to keep that regression from returning.
    {
      status: 400,
      jsonBody: { message: "Uploading selected files will result in exceeding the max amount per record." },
      expected: "QUOTA_EXCEEDED",
    },
    { status: 429, jsonBody: { message: "Rate limit exceeded" }, expected: "RATE_LIMITED" },
    { status: 500, jsonBody: { message: "Internal server error" }, expected: "UNAVAILABLE" },
    { status: 502, jsonBody: { message: "Bad gateway" }, expected: "UNAVAILABLE" },
    // A generic 400 is NOT quota -- it must not be misfiled as one.
    { status: 400, jsonBody: { message: "Validation error." }, expected: "UNAVAILABLE" },
  ];

  it.each(cases)("maps $status to $expected", async ({ status, jsonBody, expected }) => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status, jsonBody }));
    const result = await zenodoProvider.writeSessionFile(auth, container, "s.json", "{}", meta);
    expect(result.success).toBe(false);
    expect(result.error).toBe(expected);
    expect(result.providerStatus).toBe(status);
  });

  it("honors a numeric Retry-After header", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 429, jsonBody: { message: "slow down" }, headers: { "retry-after": "45" } })
    );
    const result = await zenodoProvider.writeSessionFile(auth, container, "s.json", "{}", meta);
    expect(result.retryAfter).toBe(45);
  });

  // Invenio signals rate limiting mainly through X-RateLimit-Reset (an
  // absolute epoch), so Retry-After is often absent -- never invent one.
  it("returns a null retryAfter when the header is absent or unparseable", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 429, jsonBody: { message: "slow down" } }));
    expect((await zenodoProvider.writeSessionFile(auth, container, "s.json", "{}", meta)).retryAfter).toBeNull();

    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 429, jsonBody: { message: "x" }, headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } })
    );
    expect((await zenodoProvider.writeSessionFile(auth, container, "s.json", "{}", meta)).retryAfter).toBeNull();
  });

  it("survives a non-JSON error body", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 502,
      statusText: "Bad Gateway",
      json: () => Promise.reject(new Error("not json")),
      headers: { get: () => null },
    });
    const result = await zenodoProvider.writeSessionFile(auth, container, "s.json", "{}", meta);
    expect(result.success).toBe(false);
    expect(result.error).toBe("UNAVAILABLE");
    expect(result.providerMessage).toBe("Bad Gateway");
  });
});

// updateFile was delete-then-PUT until spike gate A established live that a
// bucket PUT to an existing key replaces it in place and leaves exactly one
// listing entry (sandbox, 2026-08-11). It is now a single atomic call, with no
// window where the file does not exist -- so the assertions below are mostly
// about the DELETE never coming back.
describe("6. updateFile", () => {
  it("overwrites with a single PUT and no preceding delete", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 201, jsonBody: { key: "dataset_description.json" } })
    );

    const result = await zenodoProvider.updateFile(
      auth,
      container,
      { name: "dataset_description.json", id: "dataset_description.json" },
      "{}",
      meta
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(callArgs(0).options.method).toBe("PUT");
    expect(callArgs(0).url).toBe(`${BUCKET_URL}/dataset_description.json`);
    expect(mockFetch.mock.calls.some(([, o]) => o.method === "DELETE")).toBe(false);
  });

  it("addresses the existing ref's name, not a re-derived one", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, jsonBody: { key: "m.json" } }));
    const result = await zenodoProvider.updateFile(auth, container, { name: "m.json" }, "{}", meta);
    expect(result.success).toBe(true);
    expect(result.fileRef).toEqual({ name: "m.json", id: "m.json" });
  });

  it("returns a mapped failure rather than throwing", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 403, jsonBody: { message: "Forbidden" } }));

    const result = await zenodoProvider.updateFile(auth, container, { name: "m.json" }, "{}", meta);
    expect(result.success).toBe(false);
    expect(result.error).toBe("AUTH_EXPIRED");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("7. listFiles", () => {
  it("returns refs from the deposition files listing", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        jsonBody: [
          { id: "uuid-1", filename: "a.json" },
          { id: "uuid-2", filename: "data/raw/b.json" },
        ],
      })
    );

    const files = await zenodoProvider.listFiles(auth, container);

    // id is the KEY, not the deposition-file UUID: every operation this
    // adapter performs addresses objects by key, so refs from listFiles and
    // from writeSessionFile must be interchangeable.
    expect(files).toEqual([
      { name: "a.json", id: "a.json" },
      { name: "data/raw/b.json", id: "data/raw/b.json" },
    ]);
    expect(callArgs(0).url).toBe(`${SERVER_URL}/api/deposit/depositions/${DEPOSITION_ID}/files`);
  });

  it("reads the bucket-shaped `key` field as well as `filename`", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, jsonBody: [{ key: "c.json" }, { filename: "d.json" }] })
    );
    const files = await zenodoProvider.listFiles(auth, container);
    expect(files.map((f) => f.name)).toEqual(["c.json", "d.json"]);
  });

  // The collision cache matches on exact names, so a ref with an undefined
  // name would let a duplicate session filename through.
  it("drops entries that carry no usable name", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, jsonBody: [{ id: "uuid-1" }, { filename: "" }, { filename: "ok.json" }] })
    );
    const files = await zenodoProvider.listFiles(auth, container);
    expect(files).toEqual([{ name: "ok.json", id: "ok.json" }]);
  });

  it("throws on a failed listing", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 500, jsonBody: { message: "boom" } }));
    await expect(zenodoProvider.listFiles(auth, container)).rejects.toThrow(/Zenodo listing failed: 500 boom/);
  });
});

describe("8. downloadFile", () => {
  it("GETs the key from the bucket and returns its text", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, textBody: '{"a":1}' }));
    const result = await zenodoProvider.downloadFile(auth, container, { name: "m.json", id: "m.json" });
    expect(result).toEqual({ success: true, content: '{"a":1}' });
    expect(callArgs(0).url).toBe(`${BUCKET_URL}/m.json`);
    expect(callArgs(0).options.method).toBe("GET");
  });

  it("returns a mapped failure rather than throwing", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 404, jsonBody: { message: "Not found" } }));
    const result = await zenodoProvider.downloadFile(auth, container, { name: "gone.json" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("UNAVAILABLE");
    expect(result.providerStatus).toBe(404);
  });
});

describe("9. validateStaticToken", () => {
  it("returns true on 200", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, jsonBody: [] }));
    expect(await zenodoProvider.validateStaticToken(auth)).toBe(true);
    expect(callArgs(0).url).toBe(`${SERVER_URL}/api/deposit/depositions?size=1`);
  });

  // An under-scoped token is "not valid" here rather than an exception --
  // catching it at connect time is the point.
  it("returns false on 403 without throwing", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 403, jsonBody: { message: "Insufficient scope" } }));
    expect(await zenodoProvider.validateStaticToken(auth)).toBe(false);
  });
});

describe("10. registry wiring", () => {
  it("declares the capability surface the framework reads", () => {
    expect(zenodoProvider.id).toBe("zenodo");
    expect(zenodoProvider.authMethod).toBe("static-token");
    // No folder concept in either Zenodo API generation -- the framework's
    // filename-prefix fallback has to apply.
    expect(zenodoProvider.capabilities.nativeSubfolders).toBe(false);
    expect(zenodoProvider.capabilities.maxFileSizeBytes).toBe(50 * 1024 * 1024 * 1024);
  });

  // lib/provider-config.js mirrors this by hand and must stay in sync.
  it("declares the containerInput fields the new-experiment form renders", () => {
    expect(zenodoProvider.containerInput.map((f) => f.name)).toEqual([
      "creatorName",
      "description",
      "affiliation",
    ]);
    expect(zenodoProvider.containerInput.filter((f) => f.required).map((f) => f.name)).toEqual([
      "creatorName",
      "description",
    ]);
  });
});
