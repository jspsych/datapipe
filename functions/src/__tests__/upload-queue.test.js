/**
 * @jest-environment node
 */

import { initializeApp, deleteApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
// app.js (imported transitively by the compiled queue-upload.js below, via a
// dynamic import so it runs AFTER these process.env assignments) calls
// initializeApp() with no args, which reads the default bucket from
// FIREBASE_CONFIG -- set it so storage.bucket() resolves to the same
// emulator bucket used elsewhere in the suite. Mirrors
// early-persist-emulator.test.js / scheduled-pending-recovery-emulator.test.js.
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

// Importing the compiled scheduled-upload-retry.js pulls in providers/index.js
// and therefore every adapter, each of which imports "node-fetch" at module
// scope. node-fetch is ESM-only and Jest's CJS transform can't parse it. This
// suite never makes a provider HTTP call (its queue items fail at token
// resolution, before any network use), so a bare stub is enough -- same
// convention as providers-*.test.js.
// Configurable rather than a bare stub: the "exercised through the real retry
// worker" block below needs the worker's provider write to come back with a
// specific mapped error code, which is the whole point of the tier it then
// picks. Every other test in this suite makes no provider call at all.
const mockFetch = jest.fn();

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

const config = { projectId: "datapipe-test" };

jest.setTimeout(30000);

let db;
let app;
let queueUpload;
let isFastRetry;
let isProbeRetry;

beforeAll(async () => {
  try {
    app = getApp("upload-queue-test");
  } catch {
    app = initializeApp(config, "upload-queue-test");
  }
  db = getFirestore(app);

  // Dynamic import, deferred until after the process.env assignments above
  // run — same seam as pending-recovery-provider-regression.test.js's
  // `await import("../../lib/scheduled-pending-recovery.js")`. queue-upload.js
  // is the COMPILED module (functions/lib/, so `npm run build` must run
  // first), and its app.js does a bare, unnamed initializeApp() -- distinct
  // from this suite's own NAMED "upload-queue-test" app above, so the two
  // don't collide.
  ({ default: queueUpload, isFastRetry, isProbeRetry } = await import("../../lib/queue-upload.js"));
});

// Only the docs THIS suite created. A collection-wide wipe here used to
// delete uploadQueue docs belonging to whatever suite was running in parallel
// (scheduled-pending-recovery-emulator, metadata-derived-upload-emulator,
// pending-recovery-provider-regression), which was one half of the
// long-standing cross-suite flake. Every doc this suite touches is written
// directly under a known id -- it never calls the production queueUpload --
// so registering them here is complete.
const createdQueueDocIds = [];

function queueDoc(docId) {
  createdQueueDocIds.push(docId);
  return db.collection("uploadQueue").doc(docId);
}

afterEach(async () => {
  if (createdQueueDocIds.length === 0) return;
  const batch = db.batch();
  for (const docId of createdQueueDocIds) {
    batch.delete(db.collection("uploadQueue").doc(docId));
  }
  await batch.commit();
  createdQueueDocIds.length = 0;
});

describe("queueUpload deduplication", () => {
  test("uses deterministic document ID from experimentID and filename", async () => {
    const docId = "exp123:data.csv".replace(/[/\\]/g, "_");
    const docRef = queueDoc(docId);

    await docRef.set({
      experimentID: "exp123",
      owner: "user1",
      filename: "data.csv",
      storagePath: `upload-queue/${docId}`,
      dataType: "data",
      osfFilesLink: "https://osf.io/files/",
      status: "pending",
      errorCode: 0,
      retryCount: 0,
      maxRetries: 5,
      createdAt: Timestamp.now(),
      lastAttemptAt: null,
      nextRetryAt: Timestamp.fromMillis(Date.now() + 3600000),
      completedAt: null,
      failureReason: "Upload exception: timeout",
      deduplicationKey: "exp123:data.csv",
      sessionIncremented: true,
    });

    // Verify the doc exists at the expected deterministic ID
    const doc = await docRef.get();
    expect(doc.exists).toBe(true);
    expect(doc.data().experimentID).toBe("exp123");
    expect(doc.data().filename).toBe("data.csv");
    expect(doc.data().failureReason).toBe("Upload exception: timeout");
  });

  test("deterministic ID handles filenames with slashes", async () => {
    const docId = "exp123:subfolder/data.csv".replace(/[/\\]/g, "_");
    expect(docId).toBe("exp123:subfolder_data.csv");
  });

  test("same deduplicationKey produces same document ID", () => {
    const key1 = "exp123:data.csv".replace(/[/\\]/g, "_");
    const key2 = "exp123:data.csv".replace(/[/\\]/g, "_");
    expect(key1).toBe(key2);
  });

  test("different experiments produce different document IDs", () => {
    const key1 = "exp123:data.csv".replace(/[/\\]/g, "_");
    const key2 = "exp456:data.csv".replace(/[/\\]/g, "_");
    expect(key1).not.toBe(key2);
  });
});

describe("handleRetryFailure backoff", () => {
  test("exponential backoff doubles each retry", () => {
    const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

    for (let retryCount = 1; retryCount <= 5; retryCount++) {
      const backoffMs = Math.min(
        Math.pow(2, retryCount) * 60 * 60 * 1000,
        MAX_BACKOFF_MS
      );
      const expectedHours = Math.min(Math.pow(2, retryCount), 24);
      expect(backoffMs).toBe(expectedHours * 60 * 60 * 1000);
    }
  });

  test("backoff is capped at 24 hours", () => {
    const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
    // retryCount = 5 => 2^5 = 32 hours, should cap at 24
    const backoffMs = Math.min(
      Math.pow(2, 5) * 60 * 60 * 1000,
      MAX_BACKOFF_MS
    );
    expect(backoffMs).toBe(24 * 60 * 60 * 1000);
  });

  test("Retry-After header is honored when provided", () => {
    const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
    const retryAfterSeconds = 120; // 2 minutes

    const backoffMs = Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
    expect(backoffMs).toBe(120000);
  });

  test("Retry-After is capped at MAX_BACKOFF_MS", () => {
    const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
    const retryAfterSeconds = 100000; // ~27 hours

    const backoffMs = Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
    expect(backoffMs).toBe(MAX_BACKOFF_MS);
  });

  test("falls back to exponential backoff when no Retry-After", () => {
    const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
    const retryAfterSeconds = null;
    const retryCount = 2;

    const backoffMs = retryAfterSeconds
      ? Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS)
      : Math.min(Math.pow(2, retryCount) * 60 * 60 * 1000, MAX_BACKOFF_MS);

    expect(backoffMs).toBe(4 * 60 * 60 * 1000); // 4 hours
  });
});

// scheduled-upload-retry.ts's handleRetryFailure is not exported, so these
// mirror the arithmetic (same convention as the "handleRetryFailure backoff"
// describe block above, which also replicates the production formula rather
// than calling it directly) instead of exercising the real function. See the
// "queueUpload tiers the first nextRetryAt" describe block below for coverage
// of the piece that IS reachable: isFastRetry and queueUpload's own tiering.
describe("scheduled-upload-retry tiered backoff arithmetic", () => {
  const FAST_MAX_BACKOFF_MS = 30 * 60 * 1000; // 30 minutes
  const SLOW_MAX_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 hours, unchanged

  test("fast tier (CONTENTION) produces ~2, 4, 8, 16, 30 minutes", () => {
    const expectedMinutes = [2, 4, 8, 16, 30];
    for (let retryCount = 1; retryCount <= 5; retryCount++) {
      const backoffMs = Math.min(Math.pow(2, retryCount) * 60 * 1000, FAST_MAX_BACKOFF_MS);
      expect(backoffMs).toBe(expectedMinutes[retryCount - 1] * 60 * 1000);
    }
  });

  // CONTENTION is the only member. RATE_LIMITED looks like it belongs but is
  // deliberately excluded: five fast-tier attempts are spent inside ~31
  // minutes, far short of a provider's rate-limit window, after which the
  // item is marked permanently failed and its cached payload is deleted a
  // week later. See FAST_RETRY_CODES in queue-upload.ts.
  test("only CONTENTION is on the fast tier", () => {
    expect(isFastRetry("CONTENTION")).toBe(true);
    for (const code of ["RATE_LIMITED", "AUTH_EXPIRED", "QUOTA_EXCEEDED", "UNAVAILABLE", "NAME_CONFLICT"]) {
      expect(isFastRetry(code)).toBe(false);
    }
  });

  // handleRetryFailure clears providerErrorCode to null for a failure that
  // never reached the provider, so null must read as slow-tier rather than
  // throwing or being treated as a code.
  test("a missing or cleared providerErrorCode is slow tier", () => {
    expect(isFastRetry(undefined)).toBe(false);
    expect(isFastRetry(null)).toBe(false);
    expect(isProbeRetry(undefined)).toBe(false);
    expect(isProbeRetry(null)).toBe(false);
  });

  // The probe tier is NOT the fast tier: it buys one early look, not a
  // minutes-scale schedule. AUTH_EXPIRED must therefore be a probe code and
  // NOT a fast code -- if it ever became both, five attempts would burn
  // inside ~31 minutes against what is usually a genuinely revoked token.
  test("probe codes take one early look but are not on the fast tier", () => {
    for (const code of ["AUTH_EXPIRED", "UNAVAILABLE"]) {
      expect(isProbeRetry(code)).toBe(true);
      expect(isFastRetry(code)).toBe(false);
    }
  });

  // RATE_LIMITED is excluded because the provider has stated how long it will
  // keep refusing; QUOTA_EXCEEDED because nothing clears it within a minute.
  test("RATE_LIMITED and QUOTA_EXCEEDED never probe", () => {
    for (const code of ["RATE_LIMITED", "QUOTA_EXCEEDED", "NAME_CONFLICT", "CONTENTION"]) {
      expect(isProbeRetry(code)).toBe(false);
    }
  });

  // What makes the probe free rather than additive: once it fails, the worker
  // reads AUTH_EXPIRED as slow tier and resumes the ordinary chain, so the
  // item still gets five attempts across ~30 hours instead of ~31. Mirrors the
  // production formula, same convention as the rest of this block.
  test("a failed probe reverts to the hours-scale chain, not a second minute", () => {
    const baseMs = isFastRetry("AUTH_EXPIRED") ? 60 * 1000 : 60 * 60 * 1000;
    const afterProbe = Math.min(Math.pow(2, 1) * baseMs, SLOW_MAX_BACKOFF_MS);
    expect(afterProbe).toBe(2 * 60 * 60 * 1000);
  });

  test("slow tier (everything else) is unchanged: ~2, 4, 8, 16, 24 hours", () => {
    const expectedHours = [2, 4, 8, 16, 24];
    for (let retryCount = 1; retryCount <= 5; retryCount++) {
      const backoffMs = Math.min(Math.pow(2, retryCount) * 60 * 60 * 1000, SLOW_MAX_BACKOFF_MS);
      expect(backoffMs).toBe(expectedHours[retryCount - 1] * 60 * 60 * 1000);
    }
  });

  // A Retry-After is the provider stating how long it will keep refusing, so
  // it is clamped to MAX_BACKOFF_MS and NEVER to the item's tier cap.
  // Clamping a fast-tier item's `Retry-After: 3600` down to 30 minutes
  // scheduled a retry the provider had already said would fail.
  test("a Retry-After header is clamped to the absolute cap, not the item's tier cap", () => {
    const retryAfterSeconds = 3600; // 1 hour — larger than the fast cap, smaller than the slow cap
    const backoffMs = Math.min(retryAfterSeconds * 1000, SLOW_MAX_BACKOFF_MS);
    expect(backoffMs).toBe(retryAfterSeconds * 1000);
    expect(backoffMs).toBeGreaterThan(FAST_MAX_BACKOFF_MS);
  });
});

describe("queueUpload tiers the first nextRetryAt by providerErrorCode", () => {
  test("a CONTENTION providerErrorCode sets nextRetryAt ~60 seconds out (fast tier)", async () => {
    const experimentID = `queue-fast-tier-${randomUUID()}`;
    const filename = `file-${randomUUID()}.json`;
    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    queueDoc(docId); // scope cleanup to this suite, per the queueDoc() convention above

    const before = Date.now();
    await queueUpload({
      experimentID,
      owner: "upload-queue-test-owner",
      filename,
      data: "[]",
      dataType: "data",
      osfFilesLink: "https://osf.io/files/",
      errorCode: 400,
      providerErrorCode: "CONTENTION",
      sessionIncremented: true,
    });
    const after = Date.now();

    const doc = await db.collection("uploadQueue").doc(docId).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().providerErrorCode).toBe("CONTENTION");

    const deltaMs = doc.data().nextRetryAt.toMillis() - before;
    // ~60 seconds, with slack for the ~1 hour it would be if the fast tier
    // were not applied.
    expect(deltaMs).toBeGreaterThanOrEqual(59 * 1000);
    expect(deltaMs).toBeLessThan(after - before + 5 * 60 * 1000);
  });

  test("no providerErrorCode sets nextRetryAt ~1 hour out (slow tier, unchanged)", async () => {
    const experimentID = `queue-slow-tier-undefined-${randomUUID()}`;
    const filename = `file-${randomUUID()}.json`;
    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    queueDoc(docId);

    const before = Date.now();
    await queueUpload({
      experimentID,
      owner: "upload-queue-test-owner",
      filename,
      data: "[]",
      dataType: "data",
      osfFilesLink: "https://osf.io/files/",
      errorCode: 0,
      sessionIncremented: true,
    });

    const doc = await db.collection("uploadQueue").doc(docId).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().providerErrorCode).toBeUndefined();

    const deltaMs = doc.data().nextRetryAt.toMillis() - before;
    expect(deltaMs).toBeGreaterThan(55 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
  });

  // The gate-N case: a Zenodo 403 caused by a concurrent refresh rotating the
  // access token away is indistinguishable from a revoked one in the response,
  // but heals itself in seconds. An hour is the wrong first look.
  test("an AUTH_EXPIRED providerErrorCode sets nextRetryAt ~60 seconds out (probe)", async () => {
    const experimentID = `queue-probe-auth-${randomUUID()}`;
    const filename = `file-${randomUUID()}.json`;
    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    queueDoc(docId);

    const before = Date.now();
    await queueUpload({
      experimentID,
      owner: "upload-queue-test-owner",
      filename,
      data: "[]",
      dataType: "data",
      osfFilesLink: "https://osf.io/files/",
      errorCode: 403,
      providerErrorCode: "AUTH_EXPIRED",
      sessionIncremented: true,
    });
    const after = Date.now();

    const doc = await db.collection("uploadQueue").doc(docId).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().providerErrorCode).toBe("AUTH_EXPIRED");

    const deltaMs = doc.data().nextRetryAt.toMillis() - before;
    expect(deltaMs).toBeGreaterThanOrEqual(59 * 1000);
    // Comfortably short of the hour it would be without the probe tier.
    expect(deltaMs).toBeLessThan(after - before + 5 * 60 * 1000);
  });

  // Regression guard: RATE_LIMITED was briefly fast-tiered, which cut the
  // whole retry budget for an OSF/Drive 429 from ~31 hours to ~2.
  test("a RATE_LIMITED providerErrorCode sets nextRetryAt ~1 hour out (slow tier)", async () => {
    const experimentID = `queue-slow-tier-ratelimited-${randomUUID()}`;
    const filename = `file-${randomUUID()}.json`;
    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    queueDoc(docId);

    const before = Date.now();
    await queueUpload({
      experimentID,
      owner: "upload-queue-test-owner",
      filename,
      data: "[]",
      dataType: "data",
      osfFilesLink: "https://osf.io/files/",
      errorCode: 429,
      providerErrorCode: "RATE_LIMITED",
      sessionIncremented: true,
    });

    const doc = await db.collection("uploadQueue").doc(docId).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().providerErrorCode).toBe("RATE_LIMITED");

    const deltaMs = doc.data().nextRetryAt.toMillis() - before;
    expect(deltaMs).toBeGreaterThan(55 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
  });

  // Was a slow-tier assertion until UNAVAILABLE joined PROBE_RETRY_CODES. A
  // 5xx is usually a blip that clears in seconds, and the cost of being wrong
  // is a single extra request before the same hours-scale chain resumes.
  test("an UNAVAILABLE providerErrorCode sets nextRetryAt ~60 seconds out (probe)", async () => {
    const experimentID = `queue-probe-unavailable-${randomUUID()}`;
    const filename = `file-${randomUUID()}.json`;
    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    queueDoc(docId);

    const before = Date.now();
    await queueUpload({
      experimentID,
      owner: "upload-queue-test-owner",
      filename,
      data: "[]",
      dataType: "data",
      osfFilesLink: "https://osf.io/files/",
      errorCode: 500,
      providerErrorCode: "UNAVAILABLE",
      sessionIncremented: true,
    });
    const after = Date.now();

    const doc = await db.collection("uploadQueue").doc(docId).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().providerErrorCode).toBe("UNAVAILABLE");

    const deltaMs = doc.data().nextRetryAt.toMillis() - before;
    expect(deltaMs).toBeGreaterThanOrEqual(59 * 1000);
    expect(deltaMs).toBeLessThan(after - before + 5 * 60 * 1000);
  });
});

describe("queue entry lifecycle in Firestore", () => {
  test("pending entry can transition to processing", async () => {
    const docRef = queueDoc("lifecycle-test");
    await docRef.set({
      status: "pending",
      retryCount: 0,
      maxRetries: 5,
      createdAt: Timestamp.now(),
    });

    // Simulate atomic claim via transaction
    await db.runTransaction(async (transaction) => {
      const freshDoc = await transaction.get(docRef);
      expect(freshDoc.data().status).toBe("pending");
      transaction.update(docRef, {
        status: "processing",
        lastAttemptAt: Timestamp.now(),
      });
    });

    const updated = await docRef.get();
    expect(updated.data().status).toBe("processing");
  });

  test("processing entry cannot be claimed again", async () => {
    const docRef = queueDoc("double-claim-test");
    await docRef.set({
      status: "processing",
      retryCount: 0,
      maxRetries: 5,
      createdAt: Timestamp.now(),
    });

    // Second claim should fail
    await expect(
      db.runTransaction(async (transaction) => {
        const freshDoc = await transaction.get(docRef);
        if (freshDoc.data()?.status !== "pending") {
          throw new Error("Already claimed");
        }
        transaction.update(docRef, { status: "processing" });
      })
    ).rejects.toThrow("Already claimed");
  });

  test("failed entry with max retries reached stays failed", async () => {
    const docRef = queueDoc("max-retry-test");
    await docRef.set({
      status: "pending",
      retryCount: 4,
      maxRetries: 5,
      createdAt: Timestamp.now(),
      failureReason: null,
    });

    // Simulate handleRetryFailure logic
    const data = (await docRef.get()).data();
    const newRetryCount = (data.retryCount || 0) + 1;

    if (newRetryCount >= data.maxRetries) {
      await docRef.update({
        status: "failed",
        retryCount: newRetryCount,
        failureReason: "Provider error 500: Internal Server Error",
      });
    }

    const result = await docRef.get();
    expect(result.data().status).toBe("failed");
    expect(result.data().retryCount).toBe(5);
    expect(result.data().failureReason).toBe(
      "Provider error 500: Internal Server Error"
    );
  });
});

// The tiered backoff that MATTERS lives inside scheduled-upload-retry.ts's
// handleRetryFailure, which is not exported. The arithmetic blocks above
// replicate its formula and so cannot catch a bug in the real function (a
// mis-read field name, an inverted tier test). These drive the REAL worker.
//
// The tier comes from the code of the attempt that JUST failed, not the one
// the doc was queued with, so seedDueItem takes both: what is already stored,
// and what this attempt will fail with. `attemptOutcome: "token-failure"`
// gives the owner no dataverse connection, so resolveToken fails and the
// worker never reaches the provider; otherwise the owner is connected and the
// mocked fetch returns a response this adapter maps to the requested code.
//
// retryPendingUploads is scoped to this suite's own owner id. Unscoped it
// sweeps and mutates every pending uploadQueue doc in the shared emulator,
// which is the cross-suite hazard fixed in ddef109 for the sibling recovery
// worker; re-introducing it here would make other suites flaky again.
describe("tiered backoff, exercised through the real retry worker", () => {
  let retryPendingUploads;
  let bucket;

  beforeAll(async () => {
    ({ retryPendingUploads } = await import("../../lib/scheduled-upload-retry.js"));
    const { getStorage } = await import("firebase-admin/storage");
    bucket = getStorage(app).bucket("datapipe-test.appspot.com");
  });

  // Dataverse's one-write-per-dataset rejection: a generic 400 whose message
  // mapDataverseError turns into CONTENTION (see providers-dataverse.test.js).
  const DATAVERSE_CONTENTION = {
    status: 400,
    statusText: "Bad Request",
    json: () => Promise.resolve({ status: "ERROR", message: "Failed to add file to dataset." }),
  };
  const DATAVERSE_UNAVAILABLE = {
    status: 503,
    statusText: "Service Unavailable",
    json: () => Promise.resolve({ status: "ERROR", message: "Installation down for maintenance" }),
  };

  async function seedDueItem({ storedCode, attemptOutcome }) {
    const owner = `retry-tier-owner-${randomUUID()}`;
    const experimentID = `retry-tier-exp-${randomUUID()}`;
    const docId = `${experimentID}:data.json`.replace(/[/\\]/g, "_");
    const storagePath = `upload-queue/${docId}`;

    await db.collection("users").doc(owner).set({
      email: `${owner}@example.test`,
      // Omitted for "token-failure": resolveToken then returns
      // PROVIDER_NOT_CONNECTED and routes straight to handleRetryFailure with
      // no provider code at all. decrypt() passes a non-"v1:" value through
      // unchanged, so a plaintext token needs no encryption key here.
      ...(attemptOutcome === "token-failure"
        ? {}
        : {
            connectedAccounts: {
              dataverse: {
                authMethod: "static-token",
                encryptedToken: "plaintext-token",
                serverUrl: "https://example.test",
              },
            },
          }),
    });
    await db.collection("experiments").doc(experimentID).set({
      active: true,
      owner,
      storageProvider: "dataverse",
      providerContainer: { provider: "dataverse", datasetId: 1, persistentId: "doi:x/y", serverUrl: "https://example.test" },
    });

    // The worker downloads the cached payload before it attempts the write —
    // without it the item short-circuits to "Failed to read cached data".
    if (attemptOutcome !== "token-failure") {
      await bucket.file(storagePath).save("[]", { contentType: "text/plain" });
    }

    const doc = {
      experimentID,
      owner,
      filename: "data.json",
      storagePath,
      dataType: "data",
      status: "pending",
      errorCode: 400,
      retryCount: 0,
      maxRetries: 5,
      createdAt: Timestamp.now(),
      lastAttemptAt: null,
      // Already due.
      nextRetryAt: Timestamp.fromMillis(Date.now() - 1000),
      completedAt: null,
      failureReason: null,
      deduplicationKey: `${experimentID}:data.json`,
      sessionIncremented: true,
      // The worker dispatches off the QUEUE doc's provider fields, not the
      // experiment's — omit these and it falls back to the legacy OSF shape.
      storageProvider: "dataverse",
      providerContainer: { provider: "dataverse", datasetId: 1, persistentId: "doi:x/y", serverUrl: "https://example.test" },
    };
    if (storedCode) doc.providerErrorCode = storedCode;

    await queueDoc(docId).set(doc);
    return { owner, docId };
  }

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("a CONTENTION provider failure reschedules in MINUTES, not hours", async () => {
    mockFetch.mockResolvedValue(DATAVERSE_CONTENTION);
    const { owner, docId } = await seedDueItem({ storedCode: "CONTENTION", attemptOutcome: "contention" });

    await retryPendingUploads(owner);

    const after = (await db.collection("uploadQueue").doc(docId).get()).data();
    expect(after.status).toBe("pending");
    expect(after.retryCount).toBe(1);
    expect(after.providerErrorCode).toBe("CONTENTION");

    const delayMs = after.nextRetryAt.toMillis() - Date.now();
    // retryCount 1 on the fast tier => 2^1 * 60s = 2 minutes.
    expect(delayMs).toBeGreaterThan(30 * 1000);
    expect(delayMs).toBeLessThan(10 * 60 * 1000);
  });

  // The finding this guards: an item queued on a one-off CONTENTION whose
  // provider then went down stayed pinned to the fast tier for the rest of
  // its life, burning all five attempts in ~31 minutes against an
  // installation that was still hours from returning.
  it("a later failure with a DIFFERENT code re-tiers the item and is stored", async () => {
    mockFetch.mockResolvedValue(DATAVERSE_UNAVAILABLE);
    const { owner, docId } = await seedDueItem({ storedCode: "CONTENTION", attemptOutcome: "unavailable" });

    await retryPendingUploads(owner);

    const after = (await db.collection("uploadQueue").doc(docId).get()).data();
    // The stored code now describes the attempt that just failed...
    expect(after.providerErrorCode).toBe("UNAVAILABLE");
    // ...and the backoff followed it onto the slow tier: 2^1 * 1h.
    const delayMs = after.nextRetryAt.toMillis() - Date.now();
    expect(delayMs).toBeGreaterThan(60 * 60 * 1000);
  });

  // Nothing that fails BEFORE reaching the provider is "the container is busy
  // for a few seconds", so it must not inherit the fast tier from whatever
  // the item was originally queued with.
  it("a failure that never reached the provider clears the code and drops to the slow tier", async () => {
    const { owner, docId } = await seedDueItem({ storedCode: "CONTENTION", attemptOutcome: "token-failure" });

    await retryPendingUploads(owner);

    const after = (await db.collection("uploadQueue").doc(docId).get()).data();
    expect(after.providerErrorCode).toBeNull();
    const delayMs = after.nextRetryAt.toMillis() - Date.now();
    expect(delayMs).toBeGreaterThan(60 * 60 * 1000);
  });

  // The three terminal paths that bypass handleRetryFailure entirely
  // (missing owner, missing experiment, unreadable cached payload) have to
  // clear the stored code themselves. The taxonomy code outranks
  // failureReason in QueuePanel, so a leftover one keeps describing the
  // original provider failure while the real, permanent problem is that the
  // experiment or the payload is gone.
  it("clears the stored code on a terminal path that never calls handleRetryFailure", async () => {
    const owner = `retry-tier-owner-${randomUUID()}`;
    const experimentID = `retry-tier-missing-exp-${randomUUID()}`;
    const docId = `${experimentID}:data.json`.replace(/[/\\]/g, "_");

    await db.collection("users").doc(owner).set({ email: `${owner}@example.test` });
    // Deliberately no experiments/{experimentID} doc.

    await queueDoc(docId).set({
      experimentID,
      owner,
      filename: "data.json",
      storagePath: `upload-queue/${docId}`,
      dataType: "data",
      status: "pending",
      errorCode: 400,
      providerErrorCode: "CONTENTION",
      retryCount: 0,
      maxRetries: 5,
      createdAt: Timestamp.now(),
      lastAttemptAt: null,
      nextRetryAt: Timestamp.fromMillis(Date.now() - 1000),
      completedAt: null,
      failureReason: null,
      deduplicationKey: `${experimentID}:data.json`,
      sessionIncremented: true,
    });

    await retryPendingUploads(owner);

    const after = (await db.collection("uploadQueue").doc(docId).get()).data();
    expect(after.status).toBe("failed");
    expect(after.failureReason).toBe("Experiment not found");
    expect(after.providerErrorCode).toBeNull();
  });

  it("a slow-tier code still reschedules in HOURS (regression)", async () => {
    const { owner, docId } = await seedDueItem({ storedCode: "UNAVAILABLE", attemptOutcome: "token-failure" });

    await retryPendingUploads(owner);

    const after = (await db.collection("uploadQueue").doc(docId).get()).data();
    const delayMs = after.nextRetryAt.toMillis() - Date.now();
    // retryCount 1 on the slow tier => 2^1 * 1h = 2 hours, unchanged.
    expect(delayMs).toBeGreaterThan(60 * 60 * 1000);
  });

  it("no providerErrorCode at all keeps the original hours-scale behavior", async () => {
    const { owner, docId } = await seedDueItem({ storedCode: undefined, attemptOutcome: "token-failure" });

    await retryPendingUploads(owner);

    const after = (await db.collection("uploadQueue").doc(docId).get()).data();
    const delayMs = after.nextRetryAt.toMillis() - Date.now();
    expect(delayMs).toBeGreaterThan(60 * 60 * 1000);
  });
});
