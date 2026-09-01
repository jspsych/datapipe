/**
 * @jest-environment node
 */

// End-to-end coverage for encryption at rest of CACHED PARTICIPANT PAYLOADS
// (payload-crypto.ts), across every path that writes or reads a pending-data/
// or upload-queue/ object.
//
// Four things have to be true, and each has a block below:
//   1. persist -> read round-trips, and the object on disk is genuinely
//      ciphertext (not "encrypted" in name only).
//   2. Objects written BEFORE this shipped are plaintext and must keep
//      uploading for their full 7-day retention. There is no migration job.
//   3. A marked object that will not decrypt becomes a visible, TERMINAL queue
//      failure -- never a silent skip, never retried forever.
//   4. The dashboard download endpoint serves DECRYPTED bytes.
//
// Block 4 runs over HTTP against the Functions emulator, which is a separate
// process reading functions/.env, so this process cannot know its
// TOKEN_ENCRYPTION_KEY. It therefore never encrypts or decrypts anything
// itself there: the emulator writes the queued payload (via /api/data with an
// unreachable provider) and the emulator reads it back (via /api/queuestatus),
// and this process only checks the on-disk marker, which is key-independent.
// Same reasoning as gdrive-emulator.test.js's note that the two processes need
// not agree on TOKEN_ENCRYPTION_KEY.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
// app.js (imported transitively by the compiled lib modules, via dynamic
// imports below so they run AFTER these assignments) calls initializeApp()
// with no args and reads the default bucket from FIREBASE_CONFIG. Same
// convention as upload-queue.test.js / scheduled-pending-recovery-emulator.
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

// This process's own key, used only by the in-process blocks (1-3). Fixed so a
// payload written in one test decrypts in the next.
const KEY = "7e".repeat(32);
const ROTATED_KEY = "1c".repeat(32);
process.env.TOKEN_ENCRYPTION_KEY = KEY;

// Importing the compiled scheduled-upload-retry.js pulls in every provider
// adapter, each importing ESM-only "node-fetch" at module scope, which Jest's
// CJS transform cannot parse. Stubbed exactly as upload-queue.test.js does.
// This only affects THIS process -- the Functions emulator used by block 4
// runs the real node-fetch.
const mockFetch = jest.fn();
jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

jest.setTimeout(60000);

const FUNCTIONS_BASE = "http://localhost:5001/datapipe-test/us-central1";
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

const MAGIC = Buffer.from([0xff, 0x00, 0x44, 0x50, 0x45, 0x4e, 0x43]);

function looksEncrypted(buffer) {
  return buffer.length >= 36 && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

const SAMPLE = JSON.stringify([
  { trial_type: "html-keyboard-response", trial_index: 0, rt: 431 },
  { trial_type: "survey-text", trial_index: 1, response: { Q0: "canary" } },
]);

let db;
let app;
let bucket;
let persistPending;
let readPendingEnvelope;
let promoteToQueue;
let queueUpload;
let retryPendingUploads;
let encryptPayload;
let decryptPayload;

// THE TWO BUCKETS. This suite talks to Cloud Storage from two directions and
// they do NOT share a namespace:
//
//   - Blocks 1-3 run the lib modules IN THIS PROCESS, whose bucket comes from
//     the FIREBASE_CONFIG set at the top of this file: datapipe-test.appspot.com,
//     the name every emulator suite in this repo hardcodes.
//   - Block 4 runs them inside the FUNCTIONS EMULATOR, whose FIREBASE_CONFIG
//     the Firebase CLI derives itself. On current firebase-tools that is
//     datapipe-test.firebasestorage.app -- a different bucket, which the
//     emulator serves quite happily alongside the first one.
//
// So an object written by /api/data is INVISIBLE through the .appspot.com
// handle. Block 4 therefore resolves the bucket by asking which one actually
// holds the object, rather than assuming either name: the CLI's default has
// moved once already and there is no reason to hardcode the current answer.
const EMULATOR_BUCKET_CANDIDATES = [
  "datapipe-test.firebasestorage.app",
  "datapipe-test.appspot.com",
];

// Only what THIS suite created. A collection-wide wipe here would delete
// uploadQueue docs belonging to whatever suite is running in parallel -- the
// cross-suite hazard documented in scheduled-pending-recovery-emulator.test.js.
const createdQueueDocIds = [];
// Entries are either a plain object name (this process's bucket) or a resolved
// File handle (block 4, whichever bucket the emulator used).
const createdObjects = [];

beforeAll(async () => {
  try {
    app = getApp("payload-encryption-test");
  } catch {
    app = initializeApp({ projectId: "datapipe-test" }, "payload-encryption-test");
  }
  db = getFirestore(app);
  bucket = getStorage(app).bucket("datapipe-test.appspot.com");

  ({ persistPending, readPendingEnvelope } = await import(
    "../../lib/persist-pending.js"
  ));
  ({ promoteToQueue } = await import("../../lib/scheduled-pending-recovery.js"));
  ({ default: queueUpload } = await import("../../lib/queue-upload.js"));
  ({ retryPendingUploads } = await import("../../lib/scheduled-upload-retry.js"));
  ({ encryptPayload, decryptPayload } = await import(
    "../../lib/payload-crypto.js"
  ));
});

afterEach(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;

  if (createdQueueDocIds.length > 0) {
    const batch = db.batch();
    for (const docId of createdQueueDocIds) {
      batch.delete(db.collection("uploadQueue").doc(docId));
    }
    await batch.commit();
    createdQueueDocIds.length = 0;
  }

  for (const entry of createdObjects.splice(0)) {
    const file = typeof entry === "string" ? bucket.file(entry) : entry;
    await file.delete({ ignoreNotFound: true });
  }
});

// Track an object the FUNCTIONS EMULATOR will write, before we know which
// bucket it landed in: register a handle in every candidate so cleanup runs
// even if the test fails before the object is resolved. `ignoreNotFound` makes
// the misses free.
function trackEmulatorObject(objectName) {
  for (const name of EMULATOR_BUCKET_CANDIDATES) {
    createdObjects.push(getStorage(app).bucket(name).file(objectName));
  }
}

// Find an object the emulator wrote, whichever bucket its FIREBASE_CONFIG
// pointed at.
async function findEmulatorObject(objectName) {
  for (const name of EMULATOR_BUCKET_CANDIDATES) {
    const file = getStorage(app).bucket(name).file(objectName);
    const [exists] = await file.exists();
    if (exists) return file;
  }
  throw new Error(
    `Emulator wrote no object named ${objectName} in any of ` +
      `${EMULATOR_BUCKET_CANDIDATES.join(", ")}. The uploadQueue doc assertion ` +
      `above passed, so /api/data did reach queueUpload -- suspect the bucket ` +
      `list, not the queue path.`
  );
}

async function seedExperiment(experimentID, owner, extra = {}) {
  await db.collection("experiments").doc(experimentID).set({
    active: true,
    metadataActive: false,
    owner,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 1. Round trip through the persist path
// ---------------------------------------------------------------------------

describe("pending payloads are encrypted at rest", () => {
  it("persistPending writes ciphertext that readPendingEnvelope round-trips", async () => {
    const experimentID = `payload-enc-roundtrip-${randomUUID()}`;
    const storagePath = await persistPending(
      experimentID,
      "data.json",
      SAMPLE,
      { field: "value" }
    );
    createdObjects.push(storagePath);

    const [raw] = await bucket.file(storagePath).download();

    // Genuinely ciphertext: marked, and the participant's data is not in it.
    expect(looksEncrypted(raw)).toBe(true);
    expect(raw.includes(Buffer.from("canary", "utf8"))).toBe(false);
    expect(raw.includes(Buffer.from("survey-text", "utf8"))).toBe(false);
    expect(raw.includes(Buffer.from(experimentID, "utf8"))).toBe(false);

    // ...and the object is declared as the binary it now is.
    const [metadata] = await bucket.file(storagePath).getMetadata();
    expect(metadata.contentType).toBe("application/octet-stream");

    const envelope = await readPendingEnvelope(storagePath);
    expect(envelope.experimentID).toBe(experimentID);
    expect(envelope.filename).toBe("data.json");
    expect(envelope.data).toBe(SAMPLE);
    expect(envelope.metadataOptions).toEqual({ field: "value" });
  });

  it("queueUpload writes ciphertext to upload-queue/", async () => {
    const experimentID = `payload-enc-queue-${randomUUID()}`;
    const filename = `file-${randomUUID()}.json`;
    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    createdObjects.push(`upload-queue/${docId}`);

    await queueUpload({
      experimentID,
      owner: `payload-enc-owner-${randomUUID()}`,
      filename,
      data: SAMPLE,
      dataType: "data",
      osfFilesLink: "https://osf.io/files/",
      errorCode: 0,
      sessionIncremented: true,
    });

    const [raw] = await bucket.file(`upload-queue/${docId}`).download();
    expect(looksEncrypted(raw)).toBe(true);
    expect(raw.includes(Buffer.from("canary", "utf8"))).toBe(false);
  });

  it("the recovery sweep re-encrypts when promoting to the queue", async () => {
    const experimentID = `payload-enc-promote-${randomUUID()}`;
    await seedExperiment(experimentID, `payload-enc-owner-${randomUUID()}`);

    const pendingPath = await persistPending(experimentID, "data.json", SAMPLE);
    createdObjects.push(pendingPath); // no-op once promoteToQueue removes it
    const docId = `${experimentID}:data.json`.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    createdObjects.push(`upload-queue/${docId}`);

    await promoteToQueue(bucket.file(pendingPath));

    const [raw] = await bucket.file(`upload-queue/${docId}`).download();
    expect(looksEncrypted(raw)).toBe(true);
    expect(raw.includes(Buffer.from("canary", "utf8"))).toBe(false);

    // The pending copy is gone, so no plaintext-era object is left behind.
    const [exists] = await bucket.file(pendingPath).exists();
    expect(exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. The retry worker's read path: legacy, encrypted, undecryptable
// ---------------------------------------------------------------------------
//
// The worker's outcome is the assertion. An unreadable payload short-circuits
// to a terminal `failed` with "Failed to read cached data" BEFORE any provider
// call; a readable one reaches the provider, and the mocked Dataverse
// contention response below proves it got there (status stays `pending`, the
// mapped code is stored). So "reached the provider" is exactly "the payload
// was read successfully", with no need to reconstruct a provider success
// response or parse a multipart body.

describe("the retry worker's read path", () => {
  // Dataverse's one-write-per-dataset rejection: a generic 400 whose message
  // mapDataverseError turns into CONTENTION. Borrowed from upload-queue.test.js.
  const DATAVERSE_CONTENTION = {
    status: 400,
    statusText: "Bad Request",
    json: () =>
      Promise.resolve({
        status: "ERROR",
        message: "Failed to add file to dataset.",
      }),
  };

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(DATAVERSE_CONTENTION);
  });

  // Scoped to this suite's own owner id: unscoped, retryPendingUploads sweeps
  // and mutates every due uploadQueue doc in the shared emulator.
  async function seedDueItem(writeObject) {
    const owner = `payload-enc-retry-owner-${randomUUID()}`;
    const experimentID = `payload-enc-retry-exp-${randomUUID()}`;
    const docId = `${experimentID}:data.json`.replace(/[/\\]/g, "_");
    const storagePath = `upload-queue/${docId}`;

    await db
      .collection("users")
      .doc(owner)
      .set({
        email: `${owner}@example.test`,
        connectedAccounts: {
          dataverse: {
            authMethod: "static-token",
            // crypto-utils.decrypt() passes a non-"v1:" value through
            // unchanged, so this needs no encryption.
            encryptedToken: "plaintext-token",
            serverUrl: "https://example.test",
          },
        },
      });

    const container = {
      provider: "dataverse",
      datasetId: 1,
      persistentId: "doi:x/y",
      serverUrl: "https://example.test",
    };
    await db.collection("experiments").doc(experimentID).set({
      active: true,
      owner,
      storageProvider: "dataverse",
      providerContainer: container,
    });

    await writeObject(bucket.file(storagePath));
    createdObjects.push(storagePath);
    createdQueueDocIds.push(docId);

    await db.collection("uploadQueue").doc(docId).set({
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
      nextRetryAt: Timestamp.fromMillis(Date.now() - 1000), // already due
      completedAt: null,
      failureReason: null,
      deduplicationKey: `${experimentID}:data.json`,
      sessionIncremented: true,
      storageProvider: "dataverse",
      providerContainer: container,
    });

    return { owner, docId };
  }

  const after = async (docId) =>
    (await db.collection("uploadQueue").doc(docId).get()).data();

  // The backward-compatibility guarantee. Objects written before encryption
  // shipped are plaintext and stay readable for their full 7-day retention --
  // nothing migrates them.
  it("uploads a LEGACY plaintext object unchanged", async () => {
    const { owner, docId } = await seedDueItem((file) =>
      file.save(SAMPLE, { contentType: "text/plain" })
    );

    await retryPendingUploads(owner);

    const doc = await after(docId);
    // `?? ""` is load-bearing, not defensive noise: handleRetryFailure does
    // NOT write failureReason on a non-terminal retry -- it logs the reason
    // and updates only status/retryCount/nextRetryAt/providerErrorCode -- so
    // this stays null from seeding. The assertion still says what it means
    // (the entry did not fail at the read), it just cannot assume a string.
    expect(doc.failureReason ?? "").not.toMatch(/Failed to read cached data/);
    // Got past the read and all the way to the provider.
    expect(doc.status).toBe("pending");
    expect(doc.providerErrorCode).toBe("CONTENTION");
    expect(doc.retryCount).toBe(1);
    expect(mockFetch).toHaveBeenCalled();
  });

  it("uploads an ENCRYPTED object the same way", async () => {
    const { owner, docId } = await seedDueItem((file) =>
      file.save(encryptPayload(SAMPLE), {
        contentType: "application/octet-stream",
      })
    );

    await retryPendingUploads(owner);

    const doc = await after(docId);
    expect(doc.failureReason ?? "").not.toMatch(/Failed to read cached data/);
    expect(doc.status).toBe("pending");
    expect(doc.providerErrorCode).toBe("CONTENTION");
    expect(doc.retryCount).toBe(1);
  });

  // Failure honesty: a marked object that will not decrypt must land in the
  // existing failure path, visibly and terminally.
  it("marks a MARKED-BUT-CORRUPT object permanently failed, without retrying it", async () => {
    const corrupt = encryptPayload(SAMPLE);
    corrupt[40] ^= 0xff; // flip a ciphertext byte; the GCM tag will not verify

    const { owner, docId } = await seedDueItem((file) =>
      file.save(corrupt, { contentType: "application/octet-stream" })
    );

    await retryPendingUploads(owner);

    const doc = await after(docId);
    // Terminal, not scheduled for another attempt: nothing about an
    // undecryptable object improves on the fifth look.
    expect(doc.status).toBe("failed");
    expect(doc.failureReason).toMatch(/^Failed to read cached data/);
    expect(doc.failureReason).toMatch(/could not be decrypted/);
    // Cleared so QueuePanel describes THIS failure rather than the provider
    // error the entry was originally queued with.
    expect(doc.providerErrorCode).toBeNull();
    // Short-circuited before the provider was ever contacted.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("marks a ROTATED-KEY object failed rather than silently skipping it", async () => {
    const { owner, docId } = await seedDueItem((file) =>
      file.save(encryptPayload(SAMPLE), {
        contentType: "application/octet-stream",
      })
    );

    process.env.TOKEN_ENCRYPTION_KEY = ROTATED_KEY;
    await retryPendingUploads(owner);

    const doc = await after(docId);
    expect(doc.status).toBe("failed");
    expect(doc.failureReason).toMatch(/^Failed to read cached data/);
  });
});

// ---------------------------------------------------------------------------
// 3b. The recovery sweep must not DELETE what it cannot decrypt
// ---------------------------------------------------------------------------
//
// promoteToQueue's pre-existing behavior for an unreadable envelope was
// "delete the corrupt file". Safe when the only failure mode was unparseable
// JSON; catastrophic once a rotated key can make every pending object
// unreadable at once, with this sweep running every 15 minutes.

describe("the recovery sweep on an undecryptable pending object", () => {
  it("preserves the ciphertext and reports it instead of deleting it", async () => {
    const experimentID = `payload-enc-undec-${randomUUID()}`;
    const owner = `payload-enc-owner-${randomUUID()}`;
    await seedExperiment(experimentID, owner);

    const pendingPath = await persistPending(experimentID, "data.json", SAMPLE);
    createdObjects.push(pendingPath); // no-op once reportUndecryptable removes it
    const [originalBytes] = await bucket.file(pendingPath).download();

    const leaf = pendingPath.split("/").slice(2).join("/");
    const docId = `${experimentID}:undecryptable:${leaf}`.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    createdObjects.push(`upload-queue/${docId}`);

    process.env.TOKEN_ENCRYPTION_KEY = ROTATED_KEY;
    await promoteToQueue(bucket.file(pendingPath));
    process.env.TOKEN_ENCRYPTION_KEY = KEY;

    const doc = (await db.collection("uploadQueue").doc(docId).get()).data();
    expect(doc).toBeDefined();
    // Visible to the researcher, and terminal so the retry worker (which only
    // queries status == "pending") never picks it up.
    expect(doc.status).toBe("failed");
    expect(doc.owner).toBe(owner);
    expect(doc.filename).toBe("data.json");
    expect(doc.failureReason).toMatch(/^Failed to read cached data/);
    expect(doc.providerErrorCode).toBeNull();

    // The bytes were copied VERBATIM, still ciphertext -- so restoring the
    // previous key recovers the participant's data for the rest of its normal
    // 7-day window, which deleting the object would have made impossible.
    const [preserved] = await bucket.file(`upload-queue/${docId}`).download();
    expect(preserved.equals(originalBytes)).toBe(true);

    const envelope = JSON.parse(decryptPayload(preserved).toString("utf-8"));
    expect(envelope.data).toBe(SAMPLE);

    // The pending object is gone, so the 15-minute sweep does not rediscover
    // it forever (and cleanupOldEntries now ages the queue entry out normally).
    const [stillPending] = await bucket.file(pendingPath).exists();
    expect(stillPending).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The dashboard download endpoint
// ---------------------------------------------------------------------------
//
// Entirely inside the Functions emulator: it writes the queued payload and it
// reads it back, so the two processes need not share a key. This process only
// asserts on the on-disk marker, which is key-independent.

describe("the dashboard download endpoint returns decrypted bytes", () => {
  async function signUpEmulatorUser() {
    const email = `payload-enc-${randomUUID()}@example.test`;
    const res = await fetch(AUTH_EMULATOR_SIGNUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "Password123!",
        returnSecureToken: true,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(
        `Auth emulator signUp failed (${res.status}): ${JSON.stringify(body)}`
      );
    }
    return { uid: body.localId, idToken: body.idToken };
  }

  it("serves the original payload for an entry the emulator encrypted", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = `payload-enc-http-${randomUUID()}`;
    const filename = `file-${randomUUID()}.json`;
    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    trackEmulatorObject(`upload-queue/${docId}`);

    await db.collection("users").doc(uid).set({
      osfTokenValid: true,
      osfToken: "valid",
      usingPersonalToken: true,
    });
    // Port 1 refuses instantly, so the provider is unreachable and /api/data
    // falls through to queueUpload -- which is the write path under test.
    await seedExperiment(experimentID, uid, {
      osfFilesLink: "http://127.0.0.1:1/endpoint",
    });

    const submit = await fetch(`${FUNCTIONS_BASE}/apidata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experimentID, data: SAMPLE, filename }),
    });
    expect(submit.status).toBe(202);

    const queued = await db.collection("uploadQueue").doc(docId).get();
    expect(queued.exists).toBe(true);

    // The emulator encrypted on write. Checked from the bytes, without this
    // process needing the emulator's key.
    const queuedObject = await findEmulatorObject(`upload-queue/${docId}`);
    const [raw] = await queuedObject.download();
    expect(looksEncrypted(raw)).toBe(true);
    expect(raw.includes(Buffer.from("canary", "utf8"))).toBe(false);
    // Header (36 bytes) + ciphertext, which for AES-GCM is exactly the
    // plaintext length. If the write path ever silently reverted to plaintext
    // this is the assertion that catches it even if the marker check somehow
    // did not.
    expect(raw.length).toBe(36 + Buffer.byteLength(SAMPLE, "utf8"));

    const [metadata] = await queuedObject.getMetadata();
    expect(metadata.contentType).toBe("application/octet-stream");

    // ...and the emulator decrypts on read: what the researcher's browser
    // receives is the participant's original data, byte for byte.
    const download = await fetch(
      `${FUNCTIONS_BASE}/apiqueuestatus?experimentID=${experimentID}&download=${encodeURIComponent(docId)}`,
      { headers: { Authorization: `Bearer ${idToken}` } }
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(SAMPLE);
  });

  it("serves the ZIP of all queued files with decrypted contents", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = `payload-enc-zip-${randomUUID()}`;
    const filename = `file-${randomUUID()}.json`;
    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    createdQueueDocIds.push(docId);
    trackEmulatorObject(`upload-queue/${docId}`);

    await db.collection("users").doc(uid).set({
      osfTokenValid: true,
      osfToken: "valid",
      usingPersonalToken: true,
    });
    await seedExperiment(experimentID, uid, {
      osfFilesLink: "http://127.0.0.1:1/endpoint",
    });

    const submit = await fetch(`${FUNCTIONS_BASE}/apidata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experimentID, data: SAMPLE, filename }),
    });
    expect(submit.status).toBe(202);

    const download = await fetch(
      `${FUNCTIONS_BASE}/apiqueuestatus?experimentID=${experimentID}&downloadAll=true`,
      { headers: { Authorization: `Bearer ${idToken}` } }
    );
    expect(download.status).toBe(200);

    // A smoke test, honestly labelled: the single-file download above is what
    // decisively proves decryption, since unzipping here would mean pulling in
    // an inflate dependency for one assertion. What this does catch is the
    // regression that matters -- if downloadAll skipped decryption it would
    // append raw ciphertext, and deflate falls back to STORED blocks on
    // incompressible input, so the magic header would appear verbatim in the
    // archive. It must not.
    const zip = Buffer.from(await download.arrayBuffer());
    expect(zip.length).toBeGreaterThan(0);
    expect(zip.includes(MAGIC)).toBe(false);
    // The entry itself is there: ZIP local file headers store names in the
    // clear.
    expect(zip.includes(Buffer.from(filename, "utf8"))).toBe(true);
  });
});
