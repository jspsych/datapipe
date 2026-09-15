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
  // zenodoOAuthHost() reads this at CALL time, so it has to be set per test
  // rather than at import. Pinned to the sandbox so it agrees with SERVER_URL
  // below and a stray real-host URL in an assertion stands out.
  process.env.ZENODO_ENV = "sandbox.";
});

afterAll(() => {
  delete process.env.ZENODO_ENV;
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
  // decrypt() falls back to plaintext for values without the "v1:" prefix, so
  // plain strings round-trip without needing TOKEN_ENCRYPTION_KEY here. The
  // refresh path -- which encrypts and persists -- is exercised against the
  // Firestore emulator in providers-zenodo-oauth.test.js instead.
  function connected(overrides) {
    return {
      connectedAccounts: {
        zenodo: {
          authMethod: "oauth2",
          encryptedToken: "plain-token",
          encryptedRefreshToken: "plain-refresh",
          tokenExpiresAt: Date.now() + 60 * 60 * 1000,
          ...overrides,
        },
      },
    };
  }

  it("returns the stored token while it is still comfortably fresh", async () => {
    const result = await zenodoProvider.resolveToken(connected(), "owner-uid");
    expect(result).toEqual({ success: true, token: "plain-token", serverUrl: SERVER_URL });
    // No refresh request: a live token must not cost a round trip.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails with PROVIDER_NOT_CONNECTED when there is no zenodo account", async () => {
    const result = await zenodoProvider.resolveToken({ connectedAccounts: {} }, "owner-uid");
    expect(result.success).toBe(false);
    expect(result.error).toBe("PROVIDER_NOT_CONNECTED");
  });

  // The host is now deployment configuration, not per-connection data. An
  // OAuth client_id is registered against ONE installation, so a serverUrl
  // left on a stored connection -- by a migration, a hand edit, or an old
  // static-token document -- must never be able to point a live client at the
  // other Zenodo.
  it("ignores any serverUrl left on the stored connection", async () => {
    const result = await zenodoProvider.resolveToken(
      connected({ serverUrl: "https://zenodo.org" }),
      "owner-uid"
    );
    expect(result.success).toBe(true);
    expect(result.serverUrl).toBe(SERVER_URL);
  });

  it("defaults to production zenodo.org when ZENODO_ENV is unset", async () => {
    delete process.env.ZENODO_ENV;
    const result = await zenodoProvider.resolveToken(connected(), "owner-uid");
    // Never "https://undefinedzenodo.org", and never the sandbox: a
    // misconfigured production deploy must fail loudly against the real host
    // rather than quietly writing test data nobody looks at.
    expect(result.serverUrl).toBe("https://zenodo.org");
  });

  it("no longer implements the static-token hooks", () => {
    // connect-provider.ts's connectStaticTokenProvider rejects any provider
    // missing validateStaticToken, which is what stops a researcher pasting a
    // personal access token into a flow that now expects OAuth.
    expect(zenodoProvider.validateStaticToken).toBeUndefined();
    expect(zenodoProvider.staticTokenExpiry).toBeUndefined();
  });

  // Zenodo access tokens last an hour, short enough that one checked as valid
  // at the top of a request can die during a slow upload -- a compaction pass
  // moves up to MAX_BATCH_BYTES in a single call.
  it("treats a token expiring within the margin as already stale", async () => {
    const userData = connected({ tokenExpiresAt: Date.now() + 30 * 1000 });
    // Refreshing needs Firestore, which this suite has no emulator for, so
    // assert the decision rather than the outcome: it must NOT hand back the
    // nearly-dead token.
    const result = await zenodoProvider.resolveToken(userData, "owner-uid").catch(() => null);
    expect(result?.token).not.toBe("plain-token");
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
      // size/checksum are passed through for compaction.ts, which will not
      // delete a batch's originals unless the checksum the provider reports
      // for the uploaded archive matches the one it computed locally. An
      // adapter that dropped them here would make every archive unverifiable.
      fileRef: { name: "session-1.json", id: "session-1.json", size: 12, checksum: "md5:abc" },
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

// The collision cache hashes a name before the write and rehydrates a cold
// cache from listFiles, so the two must share a namespace. Zenodo's keyspace
// is flat: "data/raw/x.json" is stored, and listed, as "data_raw_x.json".
// Claiming the un-flattened name meant no rehydrated claim ever matched --
// and writeSessionFile is an OVERWRITING PUT with no NAME_CONFLICT backstop,
// so the duplicate that slipped through destroyed the earlier session's data
// silently.
describe("7b. storedNameFor (collision-cache namespace)", () => {
  it("flattens slashes exactly the way the stored key does", () => {
    expect(zenodoProvider.storedNameFor("data/raw/abc123.json")).toBe("data_raw_abc123.json");
    expect(zenodoProvider.storedNameFor("flat.json")).toBe("flat.json");
  });

  it("agrees with the key writeSessionFile PUTs to and reports back", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 201, jsonBody: { key: "data_raw_abc123.json", size: 1 } })
    );

    const result = await zenodoProvider.writeSessionFile(auth, container, "data/raw/abc123.json", "x", {
      size: 1,
      contentType: "application/json",
    });

    const claimName = zenodoProvider.storedNameFor("data/raw/abc123.json");
    expect(result.storedFilename).toBe(claimName);
    expect(callArgs(0).url).toBe(`${BUCKET_URL}/${encodeURIComponent(claimName)}`);
  });

  it("is idempotent, so a name read back from Zenodo maps to itself", () => {
    const once = zenodoProvider.storedNameFor("data/raw/abc123.json");
    expect(zenodoProvider.storedNameFor(once)).toBe(once);
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

describe("9. oauthConfig", () => {
  it("targets the installation named by ZENODO_ENV", () => {
    const config = zenodoProvider.oauthConfig();
    expect(config.authorizeUrl).toBe("https://sandbox.zenodo.org/oauth/authorize");
    expect(config.tokenUrl).toBe("https://sandbox.zenodo.org/oauth/token");
  });

  it("defaults to production when ZENODO_ENV is unset", () => {
    delete process.env.ZENODO_ENV;
    const config = zenodoProvider.oauthConfig();
    expect(config.authorizeUrl).toBe("https://zenodo.org/oauth/authorize");
  });

  // THE SCOPE LIST IS A DECISION, NOT A DETAIL. invenio-oauth2server also
  // registers a user:email scope, and asking for it would hand us the
  // researcher's identity in the token response itself. We deliberately do
  // not: identity is Firebase's job (lib/auth-providers.js), and Zenodo could
  // not serve as a sign-in provider regardless -- invenio-oauth2server
  // implements no OIDC layer at all, so there is no id_token for Firebase to
  // verify. Widening this list would widen the consent screen for nothing.
  it("requests exactly the two deposit scopes and no identity scope", () => {
    const scopes = zenodoProvider.oauthConfig().scope.split(" ").sort();
    expect(scopes).toEqual(["deposit:actions", "deposit:write"]);
  });

  // Google needs access_type=offline&prompt=consent to issue a refresh token
  // at all. Zenodo issues one unconditionally on the authorization_code
  // grant, so there is nothing to add here -- but the field must still be an
  // object, because generate-oauth-state.ts iterates it unguarded.
  it("adds no extra authorize parameters, but still supplies the object", () => {
    expect(zenodoProvider.oauthConfig().extraAuthParams).toEqual({});
  });

  it("reads client credentials from the environment at call time", () => {
    process.env.ZENODO_CLIENT_ID = "test-client";
    process.env.ZENODO_REDIRECT_URI = "https://datapipe-test.web.app/oauth2/connect";
    const config = zenodoProvider.oauthConfig();
    expect(config.clientId).toBe("test-client");
    expect(config.redirectUri).toBe("https://datapipe-test.web.app/oauth2/connect");
    delete process.env.ZENODO_CLIENT_ID;
    delete process.env.ZENODO_REDIRECT_URI;
  });
});

// 9b was a setupWarnings block warning researchers to keep Zenodo experiments
// under 100 submissions because DataPipe could not combine sessions into
// archives. It said it should be deleted along with setupWarnings once
// compaction shipped, and compaction.ts is that. What replaces it is the
// assertion below that the provider still declares its cap, since that is now
// what enrols it in compaction rather than what warns researchers away.
describe("9b. compaction eligibility", () => {
  it("declares the cap and the methods compaction needs to act on it", () => {
    // capabilities.maxFileCount is documented in types.ts as a contract that
    // these three exist. Declaring the cap without them would fail a pass
    // partway through -- possibly after uploading an archive it then cannot
    // clean up behind.
    expect(zenodoProvider.capabilities.maxFileCount).toBe(100);
    expect(typeof zenodoProvider.deleteFile).toBe("function");
    expect(typeof zenodoProvider.downloadFileBytes).toBe("function");
    expect(typeof zenodoProvider.archivePathFor).toBe("function");
  });

  it("no longer warns at setup, because there is nothing to act on", () => {
    expect(zenodoProvider.setupWarnings).toBeUndefined();
  });
});

describe("9c. deleteFile", () => {
  it("DELETEs the object by key", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 204 }));

    const result = await zenodoProvider.deleteFile(auth, container, { name: "data_raw_s-1.json" });

    expect(result).toEqual({ success: true });
    const { url, options } = callArgs(0);
    expect(url).toBe(`${BUCKET_URL}/data_raw_s-1.json`);
    expect(options.method).toBe("DELETE");
  });

  it("treats an already-missing object as success", async () => {
    // Compaction resumes an interrupted pass by re-deleting whatever is left,
    // so a 404 means "already in the state we wanted". Reporting it as a
    // failure would wedge an experiment that got interrupted mid-delete.
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 404, jsonBody: { message: "Object does not exist." } })
    );
    expect(await zenodoProvider.deleteFile(auth, container, { name: "gone.json" })).toEqual({
      success: true,
    });
  });

  it("maps a real failure into the shared taxonomy", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 401, jsonBody: { message: "Bad token" } }));
    const result = await zenodoProvider.deleteFile(auth, container, { name: "s.json" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("AUTH_EXPIRED");
  });
});

describe("9d. downloadFileBytes", () => {
  it("returns raw bytes rather than decoded text", async () => {
    // The reason this exists alongside downloadFile: /api/base64 submissions
    // are images and audio, and reading them through response.text() would
    // replace every invalid UTF-8 sequence with U+FFFD -- silently corrupting
    // the archive that is about to replace the originals.
    const media = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80]);
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => media.buffer.slice(media.byteOffset, media.byteOffset + media.length),
    });

    const result = await zenodoProvider.downloadFileBytes(auth, container, { name: "m.png" });

    expect(result.success).toBe(true);
    expect(Buffer.isBuffer(result.content)).toBe(true);
    expect(result.content.equals(media)).toBe(true);
  });

  it("reports failures as a result rather than throwing", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 404, jsonBody: { message: "Object does not exist." } })
    );
    const result = await zenodoProvider.downloadFileBytes(auth, container, { name: "gone.json" });
    expect(result.success).toBe(false);
    expect(result.providerStatus).toBe(404);
  });
});

// Finalization streams a merged archive straight from Cloud Storage instead
// of buffering it, because writeSessionFile's Buffer signature caps the
// largest file an adapter can move at function memory -- fine for one
// session, wrong for a study's entire archive (docs/finalization-spec.md).
// Same contract as writeSessionFile otherwise: same bucket PUT, same
// error mapping, same defensive read of key/checksum off the response.
describe("9e. writeStreamedFile", () => {
  // Reads a Node Readable to completion, the same way a real HTTP client
  // consumes a request body -- proves the bytes fetch was handed are the
  // bytes that would actually go over the wire, not just a stream reference.
  function drain(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  function streamOf(content) {
    const { Readable } = require("stream");
    return Readable.from([Buffer.from(content)]);
  }

  it("PUTs the stream to the bucket URL with an explicit Content-Length and octet-stream type", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: 200, jsonBody: { key: "final.zip", size: 9, checksum: "md5:abc" } })
    );

    const payload = "streamed!";
    const result = await zenodoProvider.writeStreamedFile(
      auth,
      container,
      "final.zip",
      streamOf(payload),
      Buffer.byteLength(payload),
      { size: Buffer.byteLength(payload), contentType: "application/zip" }
    );

    const { url, options } = callArgs(0);
    expect(url).toBe(`${BUCKET_URL}/final.zip`);
    expect(options.method).toBe("PUT");
    // Same hard requirement as writeSessionFile: a real mimetype here is a
    // 415. `meta.contentType` deliberately says application/zip, so this
    // guards against that leaking through for the streamed path too.
    expect(header(options.headers, "Content-Type")).toBe("application/octet-stream");
    expect(header(options.headers, "Content-Length")).toBe(String(Buffer.byteLength(payload)));

    const bodyBytes = await drain(options.body);
    expect(bodyBytes.toString()).toBe(payload);

    expect(result).toEqual({
      success: true,
      fileRef: { name: "final.zip", id: "final.zip", size: 9, checksum: "md5:abc" },
      storedFilename: "final.zip",
    });
  });

  // Node's built-in fetch (undici) -- what the emulator suites alias
  // node-fetch to for real HTTP calls -- throws "duplex option is required
  // when sending a body" for any stream body. Verified live against a real
  // local server (not assumed): node-fetch's own implementation tolerates the
  // option fine, but only undici enforces it, so it must always be sent for
  // the streamed path to work under both.
  it("sends duplex: half so a stream body works under Node's native fetch too", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, jsonBody: { key: "final.zip" } }));
    await zenodoProvider.writeStreamedFile(auth, container, "final.zip", streamOf("x"), 1, meta);
    expect(callArgs(0).options.duplex).toBe("half");
  });

  it("flattens path separators into the key, same as writeSessionFile", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, jsonBody: { key: "data_raw_x.zip" } }));
    await zenodoProvider.writeStreamedFile(auth, container, "data/raw/x.zip", streamOf("x"), 1, meta);
    expect(callArgs(0).url).toBe(`${BUCKET_URL}/data_raw_x.zip`);
  });

  it("reports a server-renamed key rather than the requested name", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 200, jsonBody: { key: "renamed.zip" } }));
    const result = await zenodoProvider.writeStreamedFile(auth, container, "asked.zip", streamOf("x"), 1, meta);
    expect(result.storedFilename).toBe("renamed.zip");
  });

  it("falls back to the flattened requested name when the response has no key", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 201, jsonBody: {} }));
    const result = await zenodoProvider.writeStreamedFile(
      auth,
      container,
      "data/raw/x.zip",
      streamOf("x"),
      1,
      meta
    );
    expect(result.storedFilename).toBe("data_raw_x.zip");
  });

  // Same taxonomy as writeSessionFile -- the retry queue and compaction's
  // callers must not need to special-case the streamed path.
  it("maps failures through the same error taxonomy as writeSessionFile", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 413, jsonBody: { message: "Too large" } }));
    const result = await zenodoProvider.writeStreamedFile(auth, container, "final.zip", streamOf("x"), 1, meta);
    expect(result.success).toBe(false);
    expect(result.error).toBe("QUOTA_EXCEEDED");
    expect(result.providerStatus).toBe(413);
  });

  it("survives a non-JSON error body", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 502,
      statusText: "Bad Gateway",
      json: () => Promise.reject(new Error("not json")),
      headers: { get: () => null },
    });
    const result = await zenodoProvider.writeStreamedFile(auth, container, "final.zip", streamOf("x"), 1, meta);
    expect(result.success).toBe(false);
    expect(result.error).toBe("UNAVAILABLE");
    expect(result.providerMessage).toBe("Bad Gateway");
  });

  it("rejects a tampered bucketUrl the same way writeSessionFile does", async () => {
    const tampered = { ...container, bucketUrl: "https://evil.test/api/files/abc-123" };
    const result = await zenodoProvider
      .writeStreamedFile(auth, tampered, "final.zip", streamOf("x"), 1, meta)
      .catch((e) => e);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toMatch(/bucketurl origin does not match/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("10. registry wiring", () => {
  it("declares the capability surface the framework reads", () => {
    expect(zenodoProvider.id).toBe("zenodo");
    expect(zenodoProvider.authMethod).toBe("oauth2");
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
