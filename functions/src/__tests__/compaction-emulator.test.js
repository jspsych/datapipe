/**
 * @jest-environment node
 */

// End-to-end coverage for archive compaction (compaction.ts /
// compaction-triggers.ts) against a self-contained mock Zenodo.
//
// WHY THIS IS IN-PROCESS RATHER THAN THROUGH THE FUNCTIONS EMULATOR, unlike
// zenodo-emulator.test.js: compaction has no HTTP endpoint. It is driven
// entirely by Firestore triggers, whose handlers are invoked here through the
// v2 `.run()` seam, and by compactExperiment directly -- the same approach
// scheduled-upload-retry.ts's retryPendingUploads seam takes.
//
// Being in-process also means this file, not functions/.env.local, supplies
// ZENODO_API_BASE. It points at port 3583 (its own mock, distinct from
// zenodo-emulator.test.js's 3581 so the two suites can run concurrently), and
// FUNCTIONS_EMULATOR is set below because zenodo.ts refuses to honor the
// override without it. The seeded container still carries a realistic
// https://zenodo.org, so if the override ever stopped applying these tests
// would try to reach the real service and fail loudly rather than passing
// against a mock they were never using.
//
// THE MOCK COMPUTES REAL MD5s. That is the one substantive difference from
// zenodo-emulator.test.js's mock, which reports a stand-in. Compaction deletes
// research data on the strength of a checksum comparison, so a mock that
// could not produce a genuine mismatch would leave the only safety gate in
// the feature untested.

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { randomUUID, createHash } from "crypto";
import { inflateRawSync } from "zlib";
import express from "express";
// The real constant, so the seeded record matches what compaction restores.
import { PSYCHDS_IGNORE_CONTENT } from "@jspsych/metadata";

const ZENODO_PORT = 3583;
const BUCKET_ID = "compaction-bucket";
const ZENODO_SERVER_URL = "https://zenodo.org";
const OWNER_ID = "compaction-emulator-owner";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});
// See the header: without this, zenodo.ts ignores ZENODO_API_BASE by design.
process.env.FUNCTIONS_EMULATOR = "true";
process.env.ZENODO_API_BASE = `http://127.0.0.1:${ZENODO_PORT}`;

jest.setTimeout(120000);

// Every adapter imports node-fetch at module scope, and it is ESM-only, so
// Jest's CJS transform cannot parse it -- the wall every in-process suite here
// hits. Those suites stub it with a jest.fn() because they make no HTTP call;
// this one is the opposite, and its whole point is that real requests reach
// the mock below. Node 22's built-in fetch is a drop-in for the surface the
// adapter uses (text/json/arrayBuffer, and a Buffer body on PUT), so the
// module is aliased to it rather than faked.
jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => globalThis.fetch(...args),
}));

const md5 = (buffer) => createHash("md5").update(buffer).digest("hex");

// --------------------------------------------------------------------------
// A minimal ZIP reader.
//
// Hand-rolled rather than pulled in as a dependency, and it reads the CENTRAL
// DIRECTORY rather than local headers on purpose: archiver streams, so it sets
// the streaming bit and writes zeroed sizes into local headers with the real
// values in a trailing data descriptor. The central directory always carries
// the true sizes, so this stays correct regardless of how archiver chooses to
// emit an entry.
// --------------------------------------------------------------------------
function readZipEntries(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("no end-of-central-directory record: not a zip");
  }

  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`corrupt central directory entry at ${offset}`);
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = zip.subarray(dataStart, dataStart + compressedSize);

    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

// --------------------------------------------------------------------------
// Mock Zenodo: the four routes compaction touches.
// --------------------------------------------------------------------------
function createMockZenodo() {
  const app = express();
  app.use(express.raw({ type: () => true, limit: "200mb" }));

  const files = new Map(); // key -> Buffer
  const deleteCounts = new Map();
  let corruptChecksums = false;
  let failDeletes = false;

  app.get("/api/deposit/depositions", (req, res) => res.status(200).json([]));

  app.put("/api/files/:bucketId/:key", (req, res) => {
    const key = decodeURIComponent(req.params.key);
    if (req.headers["content-type"] !== "application/octet-stream") {
      res.status(415).json({ status: 415, message: "Invalid 'Content-Type' header." });
      return;
    }
    const content = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
    if (!files.has(key) && files.size >= 100) {
      res.status(400).json({
        status: 400,
        message: "Uploading selected files will result in exceeding the max amount per record.",
      });
      return;
    }
    files.set(key, content);
    res.status(200).json({
      key,
      size: content.length,
      // The knob the checksum-mismatch test turns. Real Zenodo reports
      // "md5:<hex>" of the stored bytes.
      checksum: corruptChecksums ? "md5:deadbeef" : `md5:${md5(content)}`,
    });
  });

  app.get("/api/files/:bucketId/:key", (req, res) => {
    const key = decodeURIComponent(req.params.key);
    if (!files.has(key)) {
      res.status(404).json({ status: 404, message: "Object does not exist." });
      return;
    }
    res.status(200).send(files.get(key));
  });

  app.delete("/api/files/:bucketId/:key", (req, res) => {
    const key = decodeURIComponent(req.params.key);
    deleteCounts.set(key, (deleteCounts.get(key) || 0) + 1);
    if (failDeletes) {
      res.status(500).json({ status: 500, message: "Internal server error" });
      return;
    }
    if (!files.has(key)) {
      res.status(404).json({ status: 404, message: "Object does not exist." });
      return;
    }
    files.delete(key);
    res.status(204).send();
  });

  app.get("/api/deposit/depositions/:id/files", (req, res) => {
    res.status(200).json(
      Array.from(files.entries()).map(([key, content]) => ({
        id: `file-${key}`,
        filename: key,
        filesize: content.length,
        checksum: `md5:${md5(content)}`,
      }))
    );
  });

  return new Promise((resolve, reject) => {
    // EADDRINUSE retry, matching gdrive-emulator.test.js: jest may schedule a
    // concurrent worker while a previous run of this suite is still releasing
    // the port.
    const tryListen = (retriesLeft) => {
      const server = app.listen(ZENODO_PORT);
      server.once("listening", () =>
        resolve({
          server,
          seed: (key, content) => files.set(key, Buffer.from(content)),
          get: (key) => files.get(key) ?? null,
          has: (key) => files.has(key),
          keys: () => Array.from(files.keys()),
          remove: (key) => files.delete(key),
          size: () => files.size,
          deleteCount: (key) => deleteCounts.get(key) || 0,
          setCorruptChecksums: (value) => {
            corruptChecksums = value;
          },
          setFailDeletes: (value) => {
            failDeletes = value;
          },
          reset: () => {
            files.clear();
            deleteCounts.clear();
            corruptChecksums = false;
            failDeletes = false;
          },
        })
      );
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

// Derived from the shipped constants rather than hardcoded, so tuning the
// headroom (which this feature does, to absorb bursts) does not turn every
// assertion in this file into an arithmetic puzzle.
const SESSIONS = 83;
let KEEP_LOOSE;
let ARCHIVED; // how many of those sessions one pass seals
let REMAINING; // files left on the provider afterwards

let db;
let mock;
let compactExperiment;
let onExperimentGrew;
let onUploadQueueChanged;
let mayHaveCrossedWatermark;
let archiveNameForIndex;
let buildArchive;
let archivePathsFor;
let claimDocId;
let claimFilename;
let zenodoProvider;

beforeAll(async () => {
  mock = await createMockZenodo();

  initializeApp({ projectId: "datapipe-test", storageBucket: "datapipe-test.appspot.com" }, "compaction-test");
  db = getFirestore(initializeApp({ projectId: "datapipe-test" }, "compaction-test-db"));

  // Deferred so the process.env assignments above are in place when app.js and
  // zenodo.js first evaluate.
  const compaction = await import("../../lib/compaction.js");
  compactExperiment = compaction.compactExperiment;
  archiveNameForIndex = compaction.archiveNameForIndex;
  buildArchive = compaction.buildArchive;
  archivePathsFor = compaction.archivePathsFor;

  KEEP_LOOSE = compaction.KEEP_LOOSE;
  ARCHIVED = Math.min(SESSIONS - KEEP_LOOSE, compaction.MAX_BATCH_FILES);
  REMAINING = SESSIONS + 2 - ARCHIVED + 1; // sessions + 2 protected - sealed + 1 archive

  const triggers = await import("../../lib/compaction-triggers.js");
  onExperimentGrew = triggers.onExperimentGrew;
  onUploadQueueChanged = triggers.onUploadQueueChanged;
  mayHaveCrossedWatermark = triggers.mayHaveCrossedWatermark;

  const cache = await import("../../lib/collision-cache.js");
  claimDocId = cache.claimDocId;
  claimFilename = cache.claimFilename;

  zenodoProvider = (await import("../../lib/providers/zenodo.js")).zenodoProvider;

  await db.collection("users").doc(OWNER_ID).set({
    connectedAccounts: {
      zenodo: {
        authMethod: "static-token",
        // Plaintext: no "v1:" prefix, so decrypt() passes it through. Same
        // convention as gdrive-emulator.test.js.
        encryptedToken: "compaction-token",
        serverUrl: ZENODO_SERVER_URL,
      },
    },
  });
});

afterEach(() => {
  mock.reset();
});

afterAll(() => {
  mock.server.close();
});

const SALT = "compaction-test-salt";

/**
 * Stages a Zenodo experiment whose record already holds `sessionCount`
 * sessions plus the two protected files, with a warm collision cache that has
 * a confirmed claim for every one of them.
 *
 * Claims are written directly rather than through claimFilename: seeding ~85
 * of them through the real transaction path would dominate this suite's
 * runtime, and the claim SHAPE is already covered by collision-cache.test.js.
 * The hash is computed with the exported claimDocId, so this cannot drift from
 * the implementation.
 */
async function seedExperiment({ sessionCount = SESSIONS, metadataActive = true, extraFiles = {} } = {}) {
  const experimentID = `compaction-${randomUUID()}`;
  const names = [];

  // extraFiles are seeded FIRST, so they sit at the head of the listing.
  // selectBatch archives from the head and holds the tail back for
  // spot-checking, so a file seeded last would land in the loose tail and
  // never reach the archive a test is trying to inspect.
  for (const [key, content] of Object.entries(extraFiles)) {
    mock.seed(key, content);
    names.push(key);
  }

  for (let i = 1; i <= sessionCount; i += 1) {
    const key = metadataActive ? `data_raw_subject-${i}.json` : `subject-${i}.json`;
    mock.seed(key, JSON.stringify({ subject: i, rt: 400 + i }));
    names.push(key);
  }
  mock.seed("dataset_description.json", JSON.stringify({ name: "study" }));
  names.push("dataset_description.json");
  // Only a metadataActive experiment writes this, which matters: it is the
  // file compaction stages a saturated archive over, so a plain experiment
  // legitimately has no scratch slot.
  if (metadataActive) {
    mock.seed(PSYCHDS_IGNORE_FILE, PSYCHDS_IGNORE_CONTENT);
    names.push(PSYCHDS_IGNORE_FILE);
  }

  await db
    .collection("experiments")
    .doc(experimentID)
    .set({
      active: true,
      activeBase64: true,
      metadataActive,
      sessions: sessionCount,
      owner: OWNER_ID,
      storageProvider: "zenodo",
      providerContainer: {
        provider: "zenodo",
        depositionId: 5551212,
        bucketUrl: `http://127.0.0.1:${ZENODO_PORT}/api/files/${BUCKET_ID}`,
        serverUrl: ZENODO_SERVER_URL,
      },
      collisionCache: {
        salt: SALT,
        warmUntil: Timestamp.fromMillis(Date.now() + 86400000),
      },
    });

  const claims = db.collection("experiments").doc(experimentID).collection("filenameClaims");
  for (let i = 0; i < names.length; i += 400) {
    const batch = db.batch();
    for (const name of names.slice(i, i + 400)) {
      batch.set(claims.doc(claimDocId(SALT, name)), {
        status: "confirmed",
        ownerToken: "seed",
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
      });
    }
    await batch.commit();
  }

  return { experimentID, names };
}

const PSYCHDS_IGNORE_FILE = ".psychds-ignore";

const archiveBytes = () => mock.get(archiveNameForIndex(1));

describe("C1. below the watermark", () => {
  it("does nothing until the record is close to full", async () => {
    // 40 files against Zenodo's 100-file cap: compacting here would cost the
    // researcher the ability to preview individual sessions for no benefit.
    const { experimentID } = await seedExperiment({ sessionCount: 40 });

    const result = await compactExperiment(experimentID);

    expect(result.status).toBe("below-watermark");
    expect(mock.size()).toBe(42);
    expect(mock.has(archiveNameForIndex(1))).toBe(false);
  });
});

describe("C2. the compaction cycle", () => {
  it("seals a batch, verifies it, deletes the originals, and frees room", async () => {
    const { experimentID } = await seedExperiment();
    expect(mock.size()).toBe(SESSIONS + 2);

    const result = await compactExperiment(experimentID);

    expect(result.status).toBe("compacted");
    expect(result.archived).toBe(ARCHIVED);
    expect(result.undeleted).toBe(0);
    expect(result.archiveName).toBe("datapipe-batch-0001.zip");

    // sessions + 2 protected - sealed + 1 archive. This is the whole point of
    // the feature: the record is no longer anywhere near the cap.
    expect(mock.size()).toBe(REMAINING);
    expect(result.fileCountAfter).toBe(REMAINING);
  });

  it("leaves the record's Psych-DS descriptor and ignore file loose", async () => {
    // Burying dataset_description.json would break the metadataFileRef
    // metadata-block.ts updates in place, and hide the first file a visitor to
    // the record should see.
    const { experimentID } = await seedExperiment();
    await compactExperiment(experimentID);

    expect(mock.has("dataset_description.json")).toBe(true);
    expect(mock.has(".psychds-ignore")).toBe(true);
  });

  it("leaves recent sessions loose for spot-checking", async () => {
    const { experimentID } = await seedExperiment();
    await compactExperiment(experimentID);

    const loose = mock.keys().filter((key) => key.startsWith("data_raw_"));
    expect(loose).toHaveLength(SESSIONS - ARCHIVED);
    expect(mock.has(`data_raw_subject-${SESSIONS}.json`)).toBe(true);
    expect(mock.has("data_raw_subject-1.json")).toBe(false);
  });

  it("archives at most one batch per pass, and picks up the rest next time", async () => {
    const { experimentID } = await seedExperiment();
    await compactExperiment(experimentID);

    // Only the loose tail is left, which is below the watermark, so a second
    // pass correctly declines.
    const second = await compactExperiment(experimentID);
    expect(second.status).toBe("below-watermark");
    expect(mock.has(archiveNameForIndex(2))).toBe(false);
  });
});

describe("C3. the archive carries the Psych-DS tree Zenodo cannot store", () => {
  it("restores data/raw/ paths that the flat keyspace flattened", async () => {
    // Role two of this feature. The record can only ever show
    // data_raw_subject-1.json; the archive is where the real layout lives.
    const { experimentID } = await seedExperiment();
    await compactExperiment(experimentID);

    const entries = readZipEntries(archiveBytes());
    expect(entries.has("data/raw/subject-1.json")).toBe(true);
    expect(entries.has("data_raw_subject-1.json")).toBe(false);
    expect([...entries.keys()].every((name) => name.startsWith("data/raw/"))).toBe(true);
    expect(entries.size).toBe(ARCHIVED);
  });

  it("keeps names flat for an experiment that never wrote a slashed path", async () => {
    const { experimentID } = await seedExperiment({ metadataActive: false });
    await compactExperiment(experimentID);

    const entries = readZipEntries(archiveBytes());
    expect(entries.has("subject-1.json")).toBe(true);
    expect([...entries.keys()].some((name) => name.includes("/"))).toBe(false);
  });

  it("stores member contents byte-for-byte", async () => {
    const { experimentID } = await seedExperiment();
    await compactExperiment(experimentID);

    const entries = readZipEntries(archiveBytes());
    expect(entries.get("data/raw/subject-1.json").toString("utf8")).toBe(
      JSON.stringify({ subject: 1, rt: 401 })
    );
  });

  it("round-trips bytes that are not valid UTF-8", async () => {
    // The reason downloadFileBytes exists alongside downloadFile. /api/base64
    // submissions are images, audio and video; reading them back through
    // response.text() would replace every invalid sequence with U+FFFD and
    // silently corrupt the archive that is about to replace the originals.
    const media = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01, 0x80, 0xc0]);
    const { experimentID } = await seedExperiment({
      sessionCount: SESSIONS - 1,
      extraFiles: { "data_raw_trial-media.png": media },
    });

    await compactExperiment(experimentID);

    const entries = readZipEntries(archiveBytes());
    const stored = entries.get("data/raw/trial-media.png");
    expect(stored).toBeDefined();
    expect(stored.equals(media)).toBe(true);
  });
});

describe("C4. duplicate detection survives archiving", () => {
  it("seals claims so an archived filename can never be resubmitted", async () => {
    const { experimentID } = await seedExperiment();
    await compactExperiment(experimentID);

    const claimRef = db
      .collection("experiments")
      .doc(experimentID)
      .collection("filenameClaims")
      .doc(claimDocId(SALT, "data_raw_subject-1.json"));
    const claim = (await claimRef.get()).data();

    expect(claim.sealed).toBe(true);
    // The TTL field must be GONE. A sealed claim describes a file that is no
    // longer in the provider's listing, so nothing could rehydrate it -- if it
    // expired, a filename collected months ago would silently become
    // available again.
    expect(claim.expiresAt).toBeUndefined();
  });

  it("still rejects the filename after the cache goes cold and rehydrates", async () => {
    // The end-to-end version of the assertion above, and the one that would
    // actually catch data loss: force the cache cold so it rehydrates from a
    // listing that no longer contains the archived sessions.
    const { experimentID } = await seedExperiment();
    await compactExperiment(experimentID);

    await db
      .collection("experiments")
      .doc(experimentID)
      .update({ "collisionCache.warmUntil": Timestamp.fromMillis(Date.now() - 1000) });

    const expData = (await db.collection("experiments").doc(experimentID).get()).data();
    const listFiles = () =>
      zenodoProvider.listFiles({ token: "compaction-token" }, expData.providerContainer);

    const archived = await claimFilename(experimentID, "data_raw_subject-1.json", "new-owner", listFiles);
    expect(archived).toEqual({ claimed: false, reason: "duplicate" });

    // ...while a genuinely new filename is still accepted, so this is not just
    // a cache that rejects everything.
    const fresh = await claimFilename(experimentID, "data_raw_subject-999.json", "new-owner", listFiles);
    expect(fresh).toEqual({ claimed: true });
  });
});

describe("C5. verification gates the delete", () => {
  it("keeps every original when the provider reports a bad checksum", async () => {
    // The single most important assertion in this file. DataPipe keeps no copy
    // of submitted data, so an archive that did not land intact must never
    // authorize a delete.
    const { experimentID } = await seedExperiment();
    mock.setCorruptChecksums(true);

    const result = await compactExperiment(experimentID);

    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/checksum mismatch/);
    expect(mock.size()).toBe(SESSIONS + 2);
    expect(mock.has("data_raw_subject-1.json")).toBe(true);
    // The unverified object is cleaned up rather than left looking like a
    // sealed batch.
    expect(mock.has(archiveNameForIndex(1))).toBe(false);

    const batches = await db
      .collection("experiments")
      .doc(experimentID)
      .collection("compactionBatches")
      .get();
    expect(batches.empty).toBe(true);
  });

  it("does not lose data when deletes fail after a verified upload", async () => {
    // The archive is good and the claims are sealed, so the data is safe in
    // two places; the originals just could not be removed. They must be
    // reported, and must not be re-archived into a second zip next pass.
    const { experimentID } = await seedExperiment();
    mock.setFailDeletes(true);

    const result = await compactExperiment(experimentID);

    expect(result.status).toBe("compacted");
    expect(result.undeleted).toBe(ARCHIVED);
    expect(mock.has("data_raw_subject-1.json")).toBe(true);
    expect(mock.has(archiveNameForIndex(1))).toBe(true);

    // The next pass still sees the 60 undeleted originals in the listing. The
    // failure that would matter is it archiving them a SECOND time, into a zip
    // that then authorizes deleting files whose only other copy is in the
    // first zip.
    mock.setFailDeletes(false);
    const second = await compactExperiment(experimentID);

    // Everything archivable is already sealed, so there is nothing to do --
    // emphatically not a second archive holding the same sessions.
    expect(second.status).toBe("nothing-to-archive");
    expect(mock.has(archiveNameForIndex(2))).toBe(false);
  });
});

describe("C6. resuming an interrupted pass", () => {
  it("finishes a batch whose archive landed before the process died", async () => {
    const { experimentID } = await seedExperiment();

    // Reproduce the crash window exactly: the batch record is written and the
    // archive uploaded, but nothing has been sealed or deleted.
    const members = Array.from({ length: 10 }, (_, i) => `data_raw_subject-${i + 1}.json`);
    const paths = archivePathsFor(zenodoProvider, true, members);
    const { zip, md5: expectedMd5 } = await buildArchive(
      members.map((name) => ({ path: paths.get(name), content: mock.get(name) }))
    );
    mock.seed(archiveNameForIndex(1), zip);
    await db
      .collection("experiments")
      .doc(experimentID)
      .collection("compactionBatches")
      .doc("0001")
      .set({
        index: 1,
        archiveName: archiveNameForIndex(1),
        status: "uploading",
        memberHashes: members.map((name) => claimDocId(SALT, name)),
        expectedMd5,
        fileCount: members.length,
        createdAt: Timestamp.now(),
      });

    const result = await compactExperiment(experimentID);

    expect(result.status).toBe("compacted");
    expect(result.detail).toMatch(/resumed/);
    // The recorded members are sealed and removed, and NO second archive is
    // built -- the failure this whole mechanism exists to prevent is the same
    // sessions ending up in two zips.
    expect(mock.has("data_raw_subject-1.json")).toBe(false);
    expect(mock.has(archiveNameForIndex(2))).toBe(false);

    const claim = await db
      .collection("experiments")
      .doc(experimentID)
      .collection("filenameClaims")
      .doc(claimDocId(SALT, "data_raw_subject-1.json"))
      .get();
    expect(claim.data().sealed).toBe(true);
  });

  it("discards the record and starts over when the archive never landed", async () => {
    const { experimentID } = await seedExperiment();

    await db
      .collection("experiments")
      .doc(experimentID)
      .collection("compactionBatches")
      .doc("0001")
      .set({
        index: 1,
        archiveName: archiveNameForIndex(1),
        status: "uploading",
        memberHashes: [claimDocId(SALT, "data_raw_subject-1.json")],
        expectedMd5: "never-uploaded",
        fileCount: 1,
        createdAt: Timestamp.now(),
      });

    const result = await compactExperiment(experimentID);

    // Nothing was deleted before the crash, so the safe move is to throw the
    // record away and compact normally -- reusing index 1.
    expect(result.status).toBe("compacted");
    expect(result.archived).toBe(ARCHIVED);
    expect(result.archiveName).toBe(archiveNameForIndex(1));
  });

  it("removes an archive whose bytes do not match what was recorded", async () => {
    const { experimentID } = await seedExperiment();
    mock.seed(archiveNameForIndex(1), Buffer.from("a truncated upload"));
    await db
      .collection("experiments")
      .doc(experimentID)
      .collection("compactionBatches")
      .doc("0001")
      .set({
        index: 1,
        archiveName: archiveNameForIndex(1),
        status: "uploading",
        memberHashes: [claimDocId(SALT, "data_raw_subject-1.json")],
        expectedMd5: md5(Buffer.from("the complete upload")),
        fileCount: 1,
        createdAt: Timestamp.now(),
      });

    await compactExperiment(experimentID);

    // The partial object is gone, replaced by a genuine batch-0001.
    expect(readZipEntries(archiveBytes()).size).toBe(ARCHIVED);
    expect(mock.deleteCount(archiveNameForIndex(1))).toBeGreaterThan(0);
  });
});

describe("C7. eligibility", () => {
  it("declines an experiment on a provider with no file cap", async () => {
    const experimentID = `compaction-nocap-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      owner: OWNER_ID,
      sessions: 500,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId: "folder-1" },
    });

    const result = await compactExperiment(experimentID);
    expect(result.status).toBe("not-eligible");
    expect(result.detail).toMatch(/no file-count cap/);
  });

  it("declines a legacy OSF experiment with no provider container", async () => {
    const experimentID = `compaction-legacy-${randomUUID()}`;
    await db
      .collection("experiments")
      .doc(experimentID)
      .set({ owner: OWNER_ID, sessions: 500, osfFilesLink: "https://osf.io/x" });

    const result = await compactExperiment(experimentID);
    expect(result.status).toBe("not-eligible");
  });

  it("declines an experiment that has never had a filename claimed", async () => {
    // No salt means nothing has been submitted, so there is nothing to seal --
    // and sealing is what keeps duplicate detection working once files leave
    // the listing.
    const experimentID = `compaction-nosalt-${randomUUID()}`;
    await db
      .collection("experiments")
      .doc(experimentID)
      .set({
        owner: OWNER_ID,
        sessions: 90,
        storageProvider: "zenodo",
        providerContainer: {
          provider: "zenodo",
          depositionId: 5551212,
          bucketUrl: `http://127.0.0.1:${ZENODO_PORT}/api/files/${BUCKET_ID}`,
          serverUrl: ZENODO_SERVER_URL,
        },
      });

    const result = await compactExperiment(experimentID);
    expect(result.status).toBe("nothing-to-archive");
  });

  it("refuses to run twice at once", async () => {
    const { experimentID } = await seedExperiment();
    await db
      .collection("experiments")
      .doc(experimentID)
      .update({ "compaction.compactingUntil": Timestamp.fromMillis(Date.now() + 600000) });

    const result = await compactExperiment(experimentID);
    expect(result.status).toBe("leased-elsewhere");
    expect(mock.size()).toBe(SESSIONS + 2);
  });
});


describe("C8. saturation recovers without a human", () => {
  // A burst can take a record from below the watermark to the cap faster than
  // any trigger can react, and a full record has no room for the archive --
  // which is itself a new file. Rather than needing a file deleted by hand,
  // compaction stages the archive over one of its own batch members (an
  // overwrite, which a full record does accept) and only then frees room.

  async function seedFullRecord() {
    const seeded = await seedExperiment();
    for (let i = 0; i < 100 - (SESSIONS + 2); i += 1) {
      mock.seed(`filler-${i}.json`, "{}");
    }
    expect(mock.size()).toBe(100);
    return seeded;
  }

  it("compacts a record that is already at the cap", async () => {
    const { experimentID } = await seedFullRecord();

    const result = await compactExperiment(experimentID);

    expect(result.status).toBe("compacted");
    expect(result.recoveredFromSaturation).toBe(true);
    expect(mock.size()).toBeLessThan(100);
    // The archive ends up under its real name, not the key it was staged on.
    expect(mock.has(archiveNameForIndex(1))).toBe(true);
    expect(mock.has("data_raw_subject-1.json")).toBe(false);
  });

  it("borrows .psychds-ignore's slot and puts it back, never a session's", async () => {
    // The safety property this rests on. Giving up a session's slot would look
    // tempting -- its bytes are inside the archive being written -- but if that
    // upload then failed, the session's only copy would be gone from the
    // provider and survive solely in the function's memory. .psychds-ignore is
    // a fixed constant, so its slot costs nothing and restoring it needs no
    // provider round-trip.
    const { experimentID } = await seedFullRecord();
    const ignoreBefore = mock.get(".psychds-ignore").toString("utf8");
    const sessionBefore = mock.get("data_raw_subject-1.json").toString("utf8");

    const result = await compactExperiment(experimentID);

    expect(result.recoveredFromSaturation).toBe(true);
    expect(mock.get(".psychds-ignore").toString("utf8")).toBe(ignoreBefore);
    const entries = readZipEntries(mock.get(archiveNameForIndex(1)));
    expect(entries.get("data/raw/subject-1.json").toString("utf8")).toBe(sessionBefore);
    expect(entries.size).toBe(result.archived);
  });

  it("loses nothing, and puts .psychds-ignore back, when the upload cannot be verified", async () => {
    const { experimentID } = await seedFullRecord();
    const sessionBefore = mock.get("data_raw_subject-1.json").toString("utf8");
    mock.setCorruptChecksums(true);

    const result = await compactExperiment(experimentID);

    expect(result.status).toBe("failed");
    // Every session survives. Only .psychds-ignore was at risk, and its
    // content is a constant.
    expect(mock.get("data_raw_subject-1.json").toString("utf8")).toBe(sessionBefore);
    expect(mock.keys().filter((k) => k.startsWith("data_raw_"))).toHaveLength(SESSIONS);
    // The borrowed slot is given back even on the failure path.
    expect(mock.has(PSYCHDS_IGNORE_FILE)).toBe(true);
  });

  it("declines rather than guess when there is no reproducible slot to borrow", async () => {
    // A plain experiment writes no .psychds-ignore, so there is no file whose
    // content DataPipe can reproduce. Giving up a session's slot instead would
    // risk exactly the loss this design refuses, so it stops and asks for a
    // hand.
    const { experimentID } = await seedExperiment({ metadataActive: false });
    expect(mock.has(PSYCHDS_IGNORE_FILE)).toBe(false);
    for (let i = mock.size(); i < 100; i += 1) {
      mock.seed(`filler-${i}.json`, "{}");
    }
    expect(mock.size()).toBe(100);

    const result = await compactExperiment(experimentID);

    expect(result.status).toBe("saturated");
    expect(result.detail).toMatch(/remove one file/);
    expect(mock.size()).toBe(100);
  });

  it("resumes a pass that died after a borrowed-slot upload landed", async () => {
    const { experimentID } = await seedFullRecord();
    const members = Array.from({ length: 10 }, (_, i) => `data_raw_subject-${i + 1}.json`);
    const paths = archivePathsFor(zenodoProvider, true, members);
    const { zip, md5: expectedMd5 } = await buildArchive(
      members.map((name) => ({ path: paths.get(name), content: mock.get(name) }))
    );
    // The exact crash state: .psychds-ignore's slot already given up, archive
    // uploaded under its own name, nothing sealed or deleted yet.
    mock.seed(archiveNameForIndex(1), zip);
    mock.remove(PSYCHDS_IGNORE_FILE);
    await db
      .collection("experiments")
      .doc(experimentID)
      .collection("compactionBatches")
      .doc("0001")
      .set({
        index: 1,
        archiveName: archiveNameForIndex(1),
        status: "uploading",
        memberHashes: members.map((name) => claimDocId(SALT, name)),
        expectedMd5,
        fileCount: members.length,
        createdAt: Timestamp.now(),
      });

    const result = await compactExperiment(experimentID);

    expect(result.status).toBe("compacted");
    expect(result.detail).toMatch(/resumed/);
    // Finished properly: archive under its real name, scratch key gone, and
    // its contents intact inside the archive.
    expect(mock.has(archiveNameForIndex(1))).toBe(true);
    expect(mock.has("data_raw_subject-1.json")).toBe(false);
    const entries = readZipEntries(mock.get(archiveNameForIndex(1)));
    expect(entries.has("data/raw/subject-1.json")).toBe(true);
  });
});

describe("C9. event-driven discovery", () => {
  // There is no scheduled sweep. Discovery is entirely Firestore triggers, so
  // these drive the deployed handlers directly via their v2 `.run()` seam.

  const experimentEvent = (experimentID, before, after) => ({
    params: { experimentID },
    data: { before: { data: () => before }, after: { data: () => after } },
  });

  it("compacts when a submission pushes an experiment over the watermark", async () => {
    const { experimentID } = await seedExperiment();
    const data = (await db.collection("experiments").doc(experimentID).get()).data();

    await onExperimentGrew.run(
      experimentEvent(experimentID, { ...data, sessions: SESSIONS - 1 }, data)
    );

    expect(mock.has(archiveNameForIndex(1))).toBe(true);
  });

  it("ignores an update that did not change sessions", async () => {
    // Compaction writes compaction.* on this same document, so without this
    // guard a pass would re-trigger itself indefinitely.
    const { experimentID } = await seedExperiment();
    const data = (await db.collection("experiments").doc(experimentID).get()).data();

    await onExperimentGrew.run(
      experimentEvent(experimentID, data, { ...data, compaction: { lastFileCount: 12 } })
    );

    expect(mock.has(archiveNameForIndex(1))).toBe(false);
  });

  it("ignores providers with no file cap", async () => {
    const experimentID = `compaction-gdrive-${randomUUID()}`;
    await onExperimentGrew.run(
      experimentEvent(
        experimentID,
        { sessions: 400, storageProvider: "gdrive" },
        { sessions: 401, storageProvider: "gdrive" }
      )
    );
    expect(mock.has(archiveNameForIndex(1))).toBe(false);
  });

  it("skips the provider listing when the record cannot plausibly be full", () => {
    // The burst guard: without it, every submission during a burst would cost
    // one listing. It is deliberately pessimistic, erring toward looking early.
    const justCompacted = { sessions: 500, compaction: { lastFileCount: 8, sessionsAtLastCheck: 500 } };
    expect(mayHaveCrossedWatermark(justCompacted, 100)).toBe(false);

    const grownSince = { sessions: 510, compaction: { lastFileCount: 8, sessionsAtLastCheck: 500 } };
    expect(mayHaveCrossedWatermark(grownSince, 100)).toBe(true);

    // Never examined: look rather than infer health from an absent record.
    expect(mayHaveCrossedWatermark({ sessions: 1 }, 100)).toBe(true);
  });

  it("compacts and releases the queue when a submission is refused for lack of room", async () => {
    // The reactive path, and the one that makes a researcher's hand-uploaded
    // files eventually visible despite producing no event of their own.
    const { experimentID } = await seedExperiment();
    const queueDocId = `${experimentID}:blocked.json`.replace(/[/\\]/g, "_");
    const queued = {
      experimentID,
      owner: OWNER_ID,
      filename: "blocked.json",
      status: "pending",
      storageProvider: "zenodo",
      providerErrorCode: "QUOTA_EXCEEDED",
      nextRetryAt: Timestamp.fromMillis(Date.now() + 3600000),
      createdAt: Timestamp.now(),
    };
    await db.collection("uploadQueue").doc(queueDocId).set(queued);

    await onUploadQueueChanged.run({
      params: { docId: queueDocId },
      data: { before: { data: () => undefined }, after: { data: () => queued } },
    });

    expect(mock.has(archiveNameForIndex(1))).toBe(true);
    // Released to the next retry pass rather than left on slow-tier backoff
    // waiting out a condition compaction has just fixed.
    const after = (await db.collection("uploadQueue").doc(queueDocId).get()).data();
    expect(after.nextRetryAt.toMillis()).toBeLessThanOrEqual(Date.now());

    await db.collection("uploadQueue").doc(queueDocId).delete();
  });

  it("compacts when the retry worker lands a file without sessions moving", async () => {
    // A draining backlog adds files but never increments `sessions` -- those
    // submissions incremented it when they first arrived and failed -- so it is
    // invisible to the experiment trigger.
    const { experimentID } = await seedExperiment();
    const queueDocId = `${experimentID}:drained.json`.replace(/[/\\]/g, "_");

    await onUploadQueueChanged.run({
      params: { docId: queueDocId },
      data: {
        before: { data: () => ({ experimentID, status: "processing" }) },
        after: { data: () => ({ experimentID, status: "completed" }) },
      },
    });

    expect(mock.has(archiveNameForIndex(1))).toBe(true);
  });

  it("ignores queue writes that mean nothing for capacity", async () => {
    const { experimentID } = await seedExperiment();
    const queueDocId = `${experimentID}:transient.json`.replace(/[/\\]/g, "_");

    await onUploadQueueChanged.run({
      params: { docId: queueDocId },
      data: {
        before: { data: () => undefined },
        after: { data: () => ({ experimentID, status: "pending", providerErrorCode: "UNAVAILABLE" }) },
      },
    });

    expect(mock.has(archiveNameForIndex(1))).toBe(false);
  });
});

describe("C10. the write gate", () => {
  // The coordination that makes saturation rare rather than merely
  // recoverable: DataPipe is the only writer, so while a pass holds the lease,
  // submissions are diverted to the durable queue instead of the provider.
  // The file count therefore cannot grow during a pass, which is what
  // guarantees room for the archive it is about to upload.

  let isCompactionInFlight;
  let COMPACTION_HOLD_REASON;

  beforeAll(async () => {
    const gate = await import("../../lib/compaction-gate.js");
    isCompactionInFlight = gate.isCompactionInFlight;
    COMPACTION_HOLD_REASON = gate.COMPACTION_HOLD_REASON;
  });

  it("is closed only while a pass actually holds the lease", () => {
    expect(isCompactionInFlight({})).toBe(false);
    expect(
      isCompactionInFlight({ compaction: { compactingUntil: Timestamp.fromMillis(Date.now() + 60000) } })
    ).toBe(true);
    // A crashed pass leaves a stale lease, which must expire rather than wedge
    // the experiment into queueing every submission forever.
    expect(
      isCompactionInFlight({ compaction: { compactingUntil: Timestamp.fromMillis(Date.now() - 1000) } })
    ).toBe(false);
  });

  it("diverts a submission to the queue instead of the provider", async () => {
    // metadataActive off: the gate sits after the metadata block in
    // api-data.ts, and this test is about the gate, not that machinery.
    const { experimentID } = await seedExperiment({ sessionCount: 10, metadataActive: false });
    await db
      .collection("experiments")
      .doc(experimentID)
      .update({ "compaction.compactingUntil": Timestamp.fromMillis(Date.now() + 600000) });

    const response = await fetch(
      `http://localhost:5001/datapipe-test/us-central1/apidata`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experimentID,
          filename: "gated-session.json",
          data: JSON.stringify([{ trial: 1 }]),
        }),
      }
    );

    // 202, not an error: the participant is unaffected and the payload is
    // durable in Cloud Storage before this returns.
    expect(response.status).toBe(202);

    // failureReason is the assertion that actually discriminates. A 202 alone
    // would not: had the gate NOT fired, the function would have attempted a
    // provider write, failed to reach one, and queued the submission anyway --
    // with "Upload exception: ..." recorded instead.
    const queueDocId = `${experimentID}:gated-session.json`.replace(/[/\\]/g, "_");
    const queued = (await db.collection("uploadQueue").doc(queueDocId).get()).data();
    expect(queued.failureReason).toBe(COMPACTION_HOLD_REASON);
    // Fast tier, so it drains within a minute even if the explicit release
    // below is somehow missed.
    expect(queued.providerErrorCode).toBe("CONTENTION");

    await db.collection("uploadQueue").doc(queueDocId).delete();
  });

  it("releases what it held as soon as the pass ends", async () => {
    const { experimentID } = await seedExperiment();
    const queueDocId = `${experimentID}:held.json`.replace(/[/\\]/g, "_");
    await db
      .collection("uploadQueue")
      .doc(queueDocId)
      .set({
        experimentID,
        owner: OWNER_ID,
        filename: "held.json",
        status: "pending",
        storageProvider: "zenodo",
        providerErrorCode: "CONTENTION",
        failureReason: COMPACTION_HOLD_REASON,
        nextRetryAt: Timestamp.fromMillis(Date.now() + 60000),
        createdAt: Timestamp.now(),
      });

    await compactExperiment(experimentID);

    const after = (await db.collection("uploadQueue").doc(queueDocId).get()).data();
    expect(after.nextRetryAt.toMillis()).toBeLessThanOrEqual(Date.now());

    await db.collection("uploadQueue").doc(queueDocId).delete();
  });
});

describe("C11. a no-work check must not hold the lease", () => {
  // Regression for a live failure (2026-08-20). compactExperiment is called
  // from a Firestore trigger on EVERY submission, and it used to acquire the
  // lease before deciding whether there was anything to do -- holding it
  // across a token resolve and a provider listing. Because the lease is what
  // makes compaction-gate.ts divert submissions into the upload queue, live
  // participants started getting 202-queued with "Compaction in progress"
  // while the record sat at ~22 of 100 files and nothing was being compacted.
  //
  // Emulator tests missed it because they call compactExperiment sequentially,
  // so nothing ever races a no-op check.

  it("leaves no lease behind when there is nothing to compact", async () => {
    const { experimentID } = await seedExperiment({ sessionCount: 20 });

    const result = await compactExperiment(experimentID);
    expect(result.status).toBe("below-watermark");

    const after = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(after.compaction.compactingUntil).toBeUndefined();
    // It still records what it saw, so the trigger's cheap pre-filter converges.
    expect(after.compaction.lastFileCount).toBe(22);
    expect(after.compaction.sessionsAtLastCheck).toBe(20);
  });

  it("does not close the write gate while merely checking", async () => {
    // The property that actually matters to a participant: a submission
    // arriving during a no-work check must still be written, not queued.
    const { experimentID } = await seedExperiment({ sessionCount: 20 });
    const expRef = db.collection("experiments").doc(experimentID);

    const gateClosedDuringCheck = [];
    // Poll the gate while the check runs. isCompactionInFlight reads exactly
    // this field, so sampling it is sampling what api-data.ts would decide.
    const poller = setInterval(async () => {
      const snap = await expRef.get();
      const until = snap.data()?.compaction?.compactingUntil;
      if (until && until.toMillis() > Date.now()) gateClosedDuringCheck.push(true);
    }, 15);

    await compactExperiment(experimentID);
    clearInterval(poller);
    await new Promise((r) => setTimeout(r, 50));

    expect(gateClosedDuringCheck).toHaveLength(0);
  });

  it("still takes the lease when there IS work", async () => {
    // The guard must not have been achieved by never leasing at all -- a real
    // pass has to close the gate, or submissions would land mid-compaction.
    const { experimentID } = await seedExperiment();
    const expRef = db.collection("experiments").doc(experimentID);

    let sawLease = false;
    const poller = setInterval(async () => {
      const snap = await expRef.get();
      const until = snap.data()?.compaction?.compactingUntil;
      if (until && until.toMillis() > Date.now()) sawLease = true;
    }, 15);

    const result = await compactExperiment(experimentID);
    clearInterval(poller);

    expect(result.status).toBe("compacted");
    expect(sawLease).toBe(true);
    // ...and released afterwards.
    const after = (await expRef.get()).data();
    expect(after.compaction.compactingUntil).toBeUndefined();
  });
});
