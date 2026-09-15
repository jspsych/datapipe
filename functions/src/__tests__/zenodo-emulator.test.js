/**
 * @jest-environment node
 */

// End-to-end coverage for the Zenodo adapter, driving the REAL deployed
// apidata/apibase64 functions inside the Functions emulator against a
// self-contained mock Zenodo -- the same shape as gdrive-emulator.test.js,
// which is the house pattern for provider write-path coverage.
//
// HOW THE MOCK IS REACHED. Zenodo's adapter allowlists zenodo.org and
// sandbox.zenodo.org (providers/zenodo.ts's ALLOWED_HOSTS), so unlike
// Dataverse there is no address a same-machine mock could bind to that the
// adapter would accept. zenodo.ts therefore reads ZENODO_API_BASE, but only
// when FUNCTIONS_EMULATOR === "true" -- set for us by the emulator, never set
// on a deployed function. functions/.env.local wires it to 127.0.0.1:3581,
// which is the port this file's mock binds. That override REPLACES the
// resolved serverUrl, so nothing in this suite can accidentally reach real
// zenodo.org even though the seeded connection/container carry a
// realistic-looking https://zenodo.org.
//
// TOKENS ARE PLAINTEXT here, exactly as in gdrive-emulator.test.js: the
// seeded encryptedToken has no "v1:" prefix, so crypto-utils.ts's decrypt()
// passes it through unchanged. That avoids needing this jest process and the
// separate Functions-emulator process to agree on TOKEN_ENCRYPTION_KEY.
//
// WHAT THIS DELIBERATELY DOES NOT COVER: createDataContainer (exercised by
// create-experiment-emulator.test.js's own path) and the response-shape
// mapping already covered in-process by providers-zenodo.test.js. What lives
// here is everything that only appears once the full stack is involved --
// the collision cache, the queue, metadata refs, and the flat-keyspace
// hazard that spans the adapter and the cache together.

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";

jest.setTimeout(30000);

const config = { projectId: "datapipe-test", storageBucket: "datapipe-test.appspot.com" };
const ZENODO_OWNER_ID = "zenodo-emulator-owner";
const ZENODO_PORT = 3581;
// Deliberately the REAL production host. The emulator override redirects
// every call to the mock regardless, so seeding this proves the redirect is
// what's carrying the traffic -- if the override ever silently stopped
// applying, these tests would try to reach zenodo.org and fail loudly rather
// than passing against a mock they were never actually using.
const ZENODO_SERVER_URL = "https://zenodo.org";
const BUCKET_ID = "mock-bucket-0000";

const sampleData = `[{"trial_type":"html-keyboard-response","trial_index":1,"time_elapsed":776}]`;

// Zenodo's real 100-file-per-record cap message, captured live at file 101
// (sandbox, spike gate E, 2026-08-11). Reproduced verbatim because the
// adapter's QUOTA_EXCEEDED mapping keys off this prose -- an approximation
// here would let a regression in that regex pass unnoticed.
const CAP_MESSAGE = "Uploading selected files will result in exceeding the max amount per record.";

async function postTo(fn, body) {
  const response = await fetch(`http://localhost:5001/datapipe-test/us-central1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body),
  });
  // Parse defensively: an uncaught exception in the function yields a
  // plain-text "Internal Server Error", and letting response.json() throw
  // would disguise a real behavior failure as a harness bug.
  const text = await response.text();
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    message = { rawBody: text };
  }
  return { status: response.status, body: message };
}

const saveData = (body) => postTo("apidata", body);
const saveBase64 = (body) => postTo("apibase64", body);

// A self-contained mock Zenodo covering the legacy deposit API plus the
// files-REST bucket endpoint -- the exact pair the adapter targets, and only
// the routes it actually calls.
function createMockZenodoServer() {
  const app = express();
  // One raw parser for every content type: the bucket PUT sends raw bytes
  // (text or binary) and must arrive untouched for the round-trip assertions.
  app.use(express.raw({ type: () => true, limit: "20mb" }));

  // key -> {content, contentType}
  const filesByKey = new Map();
  const putCountsByKey = new Map();
  const putContentTypes = new Map();
  const forcedStatus = new Map();
  let fileCap = 100;

  function bucketPath(bucketId, key) {
    return `${bucketId}/${key}`;
  }

  // GET /api/deposit/depositions -- validateStaticToken's probe.
  app.get("/api/deposit/depositions", (req, res) => {
    res.status(200).json([]);
  });

  // POST /api/deposit/depositions -- createDataContainer.
  app.post("/api/deposit/depositions", (req, res) => {
    const id = 5551212;
    res.status(201).json({
      id,
      links: {
        // Same origin as the server URL the adapter resolved, which
        // resolveBucketUrl re-checks before every write.
        bucket: `http://127.0.0.1:${ZENODO_PORT}/api/files/${BUCKET_ID}`,
        html: `http://127.0.0.1:${ZENODO_PORT}/deposit/${id}`,
      },
    });
  });

  // PUT /api/files/:bucketId/:key -- the one-request-per-file write path.
  //
  // Note the route has exactly ONE :key segment. That is not a simplification
  // -- it reproduces real Zenodo, where a key containing a literal slash
  // addresses a bucket path that does not exist and 404s (spike gate B). If
  // the adapter ever stopped flattening slashes, this mock would 404 exactly
  // as production does, rather than quietly accepting a nested key.
  app.put("/api/files/:bucketId/:key", (req, res) => {
    const key = decodeURIComponent(req.params.key);
    putCountsByKey.set(key, (putCountsByKey.get(key) || 0) + 1);
    putContentTypes.set(key, req.headers["content-type"] || null);

    const forced = forcedStatus.get(key);
    if (forced) {
      res.status(forced.status).json({ status: forced.status, message: forced.message });
      return;
    }

    // The bucket endpoint accepts application/octet-stream and nothing else
    // -- a real mimetype draws a hard 415 (live sandbox, spike gate A). This
    // bug shipped once already and every write failed, so the mock enforces
    // it rather than trusting the header.
    if (req.headers["content-type"] !== "application/octet-stream") {
      res.status(415).json({
        status: 415,
        message: "Invalid 'Content-Type' header. Expected one of: application/octet-stream",
      });
      return;
    }

    const path = bucketPath(req.params.bucketId, key);
    // The cap counts files already in the record; replacing an existing key
    // is not a new file, matching the overwrite semantics gate A confirmed.
    if (!filesByKey.has(path) && filesByKey.size >= fileCap) {
      res.status(400).json({ status: 400, message: CAP_MESSAGE });
      return;
    }

    const content = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
    filesByKey.set(path, { content, key });
    res.status(200).json({ key, size: content.length, checksum: `md5:mock-${content.length}` });
  });

  app.get("/api/files/:bucketId/:key", (req, res) => {
    const key = decodeURIComponent(req.params.key);
    const file = filesByKey.get(bucketPath(req.params.bucketId, key));
    if (!file) {
      res.status(404).json({ status: 404, message: "Object does not exist." });
      return;
    }
    res.status(200).send(file.content);
  });

  // GET /api/deposit/depositions/:id/files -- the listing the collision cache
  // rehydrates from. Reports names as `filename`, the legacy shape.
  app.get("/api/deposit/depositions/:id/files", (req, res) => {
    const files = Array.from(filesByKey.entries()).map(([path, file]) => ({
      id: `file-${file.key}`,
      filename: file.key,
      filesize: file.content.length,
      checksum: `mock-${path.length}`,
    }));
    res.status(200).json(files);
  });

  return new Promise((resolve, reject) => {
    // Retry on EADDRINUSE with backoff, matching gdrive-emulator.test.js:
    // jest may schedule another suite holding a fixed port onto a concurrent
    // worker. Defensive only -- no other suite binds 3581 today.
    const tryListen = (retriesLeft) => {
      const server = app.listen(ZENODO_PORT);
      server.once("listening", () => {
        resolve({
          server,
          getPutCount: (key) => putCountsByKey.get(key) || 0,
          getContentType: (key) => putContentTypes.get(key) ?? null,
          getStoredKeys: () => Array.from(filesByKey.values()).map((f) => f.key),
          getContent: (key) => {
            const entry = filesByKey.get(bucketPath(BUCKET_ID, key));
            return entry ? entry.content : null;
          },
          // Seeds a file directly, without going through a PUT -- used to
          // stage a container the collision cache has never seen so
          // rehydration has something to find.
          seedFile: (key, content = "seeded") => {
            filesByKey.set(bucketPath(BUCKET_ID, key), { content: Buffer.from(content), key });
          },
          forceStatus: (key, status, message) => forcedStatus.set(key, { status, message }),
          setFileCap: (n) => {
            fileCap = n;
          },
          reset: () => {
            filesByKey.clear();
            putCountsByKey.clear();
            putContentTypes.clear();
            forcedStatus.clear();
            fileCap = 100;
          },
        });
      });
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && retriesLeft > 0) {
          setTimeout(() => tryListen(retriesLeft - 1), 500);
        } else {
          reject(err);
        }
      });
    };
    tryListen(60);
  });
}

let db;
let mockZenodo;

beforeAll(async () => {
  mockZenodo = await createMockZenodoServer();

  initializeApp(config);
  db = getFirestore();

  await db.collection("users").doc(ZENODO_OWNER_ID).set({
    connectedAccounts: {
      zenodo: {
        authMethod: "oauth2",
        // Zenodo moved from a pasted personal access token to OAuth2 on
        // 2026-08-21. tokenExpiresAt has to sit comfortably in the future or
        // resolveToken would try to refresh -- these suites exercise the write
        // path against the mock, not the OAuth path, which
        // providers-zenodo-oauth.test.js covers against the emulator.
        // serverUrl is deliberately absent: it is deployment config now, and
        // in any case ZENODO_API_BASE overrides it for every call here.
        encryptedToken: "zenodo-integration-token", // plaintext fallback, see header
        encryptedRefreshToken: "zenodo-integration-refresh",
        tokenExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
      },
    },
  });
});

afterEach(() => {
  mockZenodo.reset();
});

afterAll(() => {
  mockZenodo.server.close();
});

async function createZenodoExperiment(experimentID, overrides = {}) {
  await db
    .collection("experiments")
    .doc(experimentID)
    .set({
      active: true,
      activeBase64: true,
      metadataActive: false,
      owner: ZENODO_OWNER_ID,
      storageProvider: "zenodo",
      providerContainer: {
        provider: "zenodo",
        depositionId: 5551212,
        bucketUrl: `http://127.0.0.1:${ZENODO_PORT}/api/files/${BUCKET_ID}`,
        serverUrl: ZENODO_SERVER_URL,
      },
      ...overrides,
    });
}

describe("Z1. zenodo experiment: apidata POST succeeds and warms the collision cache", () => {
  it("returns 201, PUTs the file once as application/octet-stream, and leaves collisionCache warm", async () => {
    const experimentID = `zenodo-e2e-1-${randomUUID()}`;
    const filename = `z1-${randomUUID()}.json`;
    await createZenodoExperiment(experimentID);

    const before = Date.now();
    const response = await saveData({ experimentID, data: sampleData, filename });

    expect(response.status).toBe(201);
    expect(mockZenodo.getPutCount(filename)).toBe(1);
    // Guards the shipped-once regression the spike caught: sending the real
    // mimetype here is a hard 415 and every write fails.
    expect(mockZenodo.getContentType(filename)).toBe("application/octet-stream");
    expect(mockZenodo.getContent(filename).toString("utf8")).toBe(sampleData);

    const expDataAfter = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(typeof expDataAfter.collisionCache.salt).toBe("string");
    expect(expDataAfter.collisionCache.warmUntil.toMillis()).toBeGreaterThan(before);
  });
});

describe("Z2. duplicate filename is rejected without a second provider write", () => {
  it("second POST for the same filename gets OSF_FILE_EXISTS and the mock sees exactly one PUT", async () => {
    const experimentID = `zenodo-e2e-2-${randomUUID()}`;
    const filename = `z2-dup-${randomUUID()}.json`;
    await createZenodoExperiment(experimentID);

    const first = await saveData({ experimentID, data: sampleData, filename });
    expect(first.status).toBe(201);

    const second = await saveData({ experimentID, data: sampleData, filename });
    expect(second.status).toBe(400);
    expect(second.body).toEqual({ ...MESSAGES.OSF_FILE_EXISTS, metadataMessage: "" });

    // This assertion is the whole point on Zenodo specifically. Its write is
    // an OVERWRITING PUT with no NAME_CONFLICT to fall back on, so a second
    // PUT here would have silently destroyed the first session's data --
    // the cache is the only thing standing between a duplicate name and
    // data loss.
    expect(mockZenodo.getPutCount(filename)).toBe(1);
    expect(mockZenodo.getContent(filename).toString("utf8")).toBe(sampleData);
  });
});

describe("Z3. metadata on zenodo", () => {
  it("creates dataset_description.json, stores the ref, then overwrites it in place with no second listing entry", async () => {
    const experimentID = `zenodo-e2e-3-${randomUUID()}`;
    await createZenodoExperiment(experimentID, { metadataActive: true });

    const first = await saveData({
      experimentID,
      data: sampleData,
      filename: `z3-a-${randomUUID()}.json`,
    });
    expect(first.status).toBe(201);
    expect(mockZenodo.getPutCount("dataset_description.json")).toBe(1);

    const metadataDoc = (await db.collection("metadata").doc(experimentID).get()).data();
    expect(metadataDoc.metadataFileRef).toBeDefined();
    expect(metadataDoc.metadataFileRef).not.toBeNull();
    // Zenodo addresses every object by key, so the ref's id IS the key.
    expect(metadataDoc.metadataFileRef.id).toBe("dataset_description.json");

    const second = await saveData({
      experimentID,
      data: sampleData,
      filename: `z3-b-${randomUUID()}.json`,
    });
    expect(second.status).toBe(201);

    // Two PUTs to the same key, but still ONE file -- this is the atomic
    // in-place replace gate A established, and the reason zenodo.ts's
    // updateFile has no delete step (unlike dataverse.ts and Figshare).
    expect(mockZenodo.getPutCount("dataset_description.json")).toBe(2);
    const descriptionEntries = mockZenodo
      .getStoredKeys()
      .filter((k) => k === "dataset_description.json");
    expect(descriptionEntries).toHaveLength(1);
  });
});

describe("Z4. flat keyspace: Psych-DS paths are flattened consistently across write, cache and listing", () => {
  it("a metadataActive submission stores data_raw_<name>, never a slashed key, and the cache hashes the flattened name", async () => {
    const experimentID = `zenodo-e2e-4-${randomUUID()}`;
    const filename = `z4-${randomUUID()}.json`;
    await createZenodoExperiment(experimentID, { metadataActive: true });

    const first = await saveData({ experimentID, data: sampleData, filename });
    expect(first.status).toBe(201);

    // metadata-derived-files.ts routes a metadataActive raw upload to
    // data/raw/<name>; Zenodo cannot hold a slash, so the stored key is the
    // flattened form. If the adapter stopped flattening, the mock's
    // single-segment bucket route would 404 exactly as production does.
    const storedKeys = mockZenodo.getStoredKeys();
    expect(storedKeys).toContain(`data_raw_${filename}`);
    expect(storedKeys.every((k) => !k.includes("/"))).toBe(true);
    // The derived Psych-DS CSVs land flattened too, not just the raw file.
    expect(storedKeys.some((k) => k.startsWith("data_") && k.endsWith("_data.csv"))).toBe(true);

    // And the claim went into the FLATTENED namespace: resubmitting the same
    // name is caught as a duplicate. If claimNameFor/storedNameFor disagreed,
    // this second PUT would overwrite the first session's data instead.
    const second = await saveData({ experimentID, data: sampleData, filename });
    expect(second.status).toBe(400);
    // objectContaining, not toEqual: a metadataActive experiment also reports
    // its metadata state alongside the duplicate error, which the
    // metadata-off cases above (Z2) do not.
    expect(second.body).toEqual(expect.objectContaining(MESSAGES.OSF_FILE_EXISTS));
    expect(mockZenodo.getPutCount(`data_raw_${filename}`)).toBe(1);
  });
});

describe("Z5. provider failure queues the upload and tags it with the zenodo container", () => {
  it("a forced 500 yields a 202 queued response with claimToken, storageProvider and providerContainer on the queue doc", async () => {
    const experimentID = `zenodo-e2e-5-${randomUUID()}`;
    const filename = `z5-${randomUUID()}.json`;
    await createZenodoExperiment(experimentID);

    mockZenodo.forceStatus(filename, 500, "Internal server error");

    const response = await saveData({ experimentID, data: sampleData, filename });
    expect(response.status).toBe(202);
    expect(response.body).toEqual(
      expect.objectContaining({ ...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage: "" })
    );

    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    const queueData = (await db.collection("uploadQueue").doc(docId).get()).data();
    expect(queueData).toBeDefined();
    expect(typeof queueData.claimToken).toBe("string");
    expect(queueData.claimToken.length).toBeGreaterThan(0);
    expect(queueData.storageProvider).toBe("zenodo");
    expect(queueData.providerContainer.depositionId).toBe(5551212);
    expect(queueData.providerErrorCode).toBe("UNAVAILABLE");
  });
});

describe("Z6. the 100-file cap surfaces as QUOTA_EXCEEDED, not an endlessly-retried outage", () => {
  it("a full record queues the submission tagged QUOTA_EXCEEDED on the slow tier", async () => {
    const experimentID = `zenodo-e2e-6-${randomUUID()}`;
    const filename = `z6-${randomUUID()}.json`;
    await createZenodoExperiment(experimentID);

    // Cap of 0: the very next write is the 101st file as far as the mock is
    // concerned, returning Zenodo's real cap prose.
    mockZenodo.setFileCap(0);

    const queuedAt = Date.now();
    const response = await saveData({ experimentID, data: sampleData, filename });
    expect(response.status).toBe(202);

    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    const queueData = (await db.collection("uploadQueue").doc(docId).get()).data();
    // "exceeding", not "exceeds" -- the inflection that originally sent a
    // permanently-full record to UNAVAILABLE, where the queue would have
    // retried it forever.
    expect(queueData.providerErrorCode).toBe("QUOTA_EXCEEDED");
    // Slow tier: only CONTENTION gets the 60-second retry. A full record
    // needs human action (compaction), so it must not spin on the fast tier.
    expect(queueData.nextRetryAt.toMillis()).toBeGreaterThan(queuedAt + 30 * 60 * 1000);
  });
});

describe("Z7. base64 media path", () => {
  it("apibase64 stores the decoded bytes intact under the requested key", async () => {
    const experimentID = `zenodo-e2e-7-${randomUUID()}`;
    const filename = `z7-${randomUUID()}.bin`;
    await createZenodoExperiment(experimentID);

    // Bytes that are NOT valid UTF-8 text, so a transport that stringified
    // the payload anywhere along the way would corrupt them detectably.
    const raw = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x42, 0x00, 0x7f]);
    const response = await saveBase64({
      experimentID,
      data: raw.toString("base64"),
      filename,
    });

    expect(response.status).toBe(201);
    expect(mockZenodo.getPutCount(filename)).toBe(1);
    expect(mockZenodo.getContentType(filename)).toBe("application/octet-stream");
    expect(Buffer.compare(mockZenodo.getContent(filename), raw)).toBe(0);
  });
});

describe("Z8. cold collision cache rehydrates from the deposition listing", () => {
  it("a filename already present in the deposition is caught as a duplicate after the cache goes cold", async () => {
    const experimentID = `zenodo-e2e-8-${randomUUID()}`;
    const filename = `z8-${randomUUID()}.json`;
    await createZenodoExperiment(experimentID, {
      // An experiment that collected data, went cold, and had its claims
      // expire -- the salt is retained permanently, warmUntil is not.
      collisionCache: {
        salt: "z8-retained-salt",
        warmUntil: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
      },
    });
    // The file exists on the provider but has no claim in Firestore, which
    // is exactly the state rehydration exists to recover from.
    mockZenodo.seedFile(filename, "an earlier session");

    const response = await saveData({ experimentID, data: sampleData, filename });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ ...MESSAGES.OSF_FILE_EXISTS, metadataMessage: "" });
    // Never overwritten: the earlier session's bytes are still there.
    expect(mockZenodo.getPutCount(filename)).toBe(0);
    expect(mockZenodo.getContent(filename).toString("utf8")).toBe("an earlier session");

    const expDataAfter = (await db.collection("experiments").doc(experimentID).get()).data();
    // Rehydration re-warms the cache and keeps the original salt (claims
    // hashed under a new salt would never match the old ones).
    expect(expDataAfter.collisionCache.salt).toBe("z8-retained-salt");
    expect(expDataAfter.collisionCache.warmUntil.toMillis()).toBeGreaterThan(Date.now());
  });
});
