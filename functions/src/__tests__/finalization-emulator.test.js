/**
 * @jest-environment node
 */

// End-to-end coverage for finalization (finalization.ts,
// docs/finalization-spec.md) against a self-contained mock Zenodo.
//
// Structured exactly like compaction-emulator.test.js, which this reuses
// heavily: same in-process approach (finalizeExperiment is called directly,
// there is no HTTP endpoint for it in this phase -- Phase 4), same mock
// Zenodo shape (computes real md5s, since finalization deletes research data
// on the strength of a checksum comparison), same env bootstrap ordering
// (process.env before the deferred dynamic import), same node-fetch handling.
//
// Port 3590, distinct from every fixed mock-server port already in use
// (3579-3583 -- see compaction-emulator.test.js, gdrive-emulator.test.js,
// oauth-connect-emulator.test.js, dataverse-emulator.test.js,
// zenodo-emulator.test.js) so this suite can run concurrently with them.

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { randomUUID, createHash } from "crypto";
import { inflateRawSync } from "zlib";
import express from "express";
import { PSYCHDS_IGNORE_CONTENT } from "@jspsych/metadata";

const ZENODO_PORT = 3590;
const BUCKET_ID = "finalization-bucket";
const ZENODO_SERVER_URL = "https://zenodo.org";
const OWNER_ID = "finalization-emulator-owner";
const PSYCHDS_IGNORE_FILE = ".psychds-ignore";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});
// See the header of compaction-emulator.test.js: zenodo.ts ignores
// ZENODO_API_BASE without this.
process.env.FUNCTIONS_EMULATOR = "true";
process.env.ZENODO_API_BASE = `http://127.0.0.1:${ZENODO_PORT}`;

jest.setTimeout(120000);

// node-fetch is ESM-only; every adapter imports it at module scope, and this
// suite's whole point is real requests reaching the mock below, so it is
// aliased to Node's built-in fetch rather than faked -- same as
// compaction-emulator.test.js, and required for writeStreamedFile's
// duplex:"half" streamed body to actually work (node-fetch itself would
// tolerate it, but the point is exercising what zenodo.ts really sends).
jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => globalThis.fetch(...args),
}));

const md5 = (buffer) => createHash("md5").update(buffer).digest("hex");

// --------------------------------------------------------------------------
// A minimal ZIP reader (same hand-rolled reader as compaction-emulator.test.js
// -- reads the central directory, not local headers, for the same reason:
// archiver streams and zeroes local-header sizes).
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
// Mock Zenodo: the same four routes compaction's mock exposes.
// --------------------------------------------------------------------------
function createMockZenodo() {
  const app = express();
  app.use(express.raw({ type: () => true, limit: "200mb" }));

  const files = new Map(); // key -> Buffer
  const deleteCounts = new Map();
  let corruptChecksums = false;

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
    // Same EADDRINUSE retry as compaction-emulator.test.js: jest may schedule
    // a concurrent worker while a previous run of this suite is still
    // releasing the port.
    const tryListen = (retriesLeft) => {
      const server = app.listen(ZENODO_PORT);
      server.once("listening", () =>
        resolve({
          server,
          seed: (key, content) => files.set(key, Buffer.from(content)),
          get: (key) => files.get(key) ?? null,
          has: (key) => files.has(key),
          keys: () => Array.from(files.keys()),
          size: () => files.size,
          deleteCount: (key) => deleteCounts.get(key) || 0,
          setCorruptChecksums: (value) => {
            corruptChecksums = value;
          },
          reset: () => {
            files.clear();
            deleteCounts.clear();
            corruptChecksums = false;
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

let db;
let storage;
let mock;
let finalizeExperiment;
let buildArchive;
let archivePathsFor;
let claimDocId;
let zenodoProvider;
let retryPendingUploads;

beforeAll(async () => {
  mock = await createMockZenodo();

  initializeApp({ projectId: "datapipe-test", storageBucket: "datapipe-test.appspot.com" }, "finalization-test");
  db = getFirestore(initializeApp({ projectId: "datapipe-test" }, "finalization-test-db"));

  // Deferred so the process.env assignments above are in place when app.js
  // and zenodo.js first evaluate (same reasoning as compaction-emulator.test.js).
  const app = await import("../../lib/app.js");
  storage = app.storage;

  const finalization = await import("../../lib/finalization.js");
  finalizeExperiment = finalization.finalizeExperiment;

  const compaction = await import("../../lib/compaction.js");
  buildArchive = compaction.buildArchive;
  archivePathsFor = compaction.archivePathsFor;

  const cache = await import("../../lib/collision-cache.js");
  claimDocId = cache.claimDocId;

  zenodoProvider = (await import("../../lib/providers/zenodo.js")).zenodoProvider;

  // The retry worker's own seam (see scheduled-upload-retry.ts's header on
  // `ownerScope`) -- used below to prove it never writes into a finalized
  // experiment's container.
  retryPendingUploads = (await import("../../lib/scheduled-upload-retry.js")).retryPendingUploads;

  await db.collection("users").doc(OWNER_ID).set({
    connectedAccounts: {
      zenodo: {
        authMethod: "static-token",
        encryptedToken: "finalization-token",
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

const SALT = "finalization-test-salt";

function containerFor() {
  return {
    provider: "zenodo",
    depositionId: 9991234,
    bucketUrl: `http://127.0.0.1:${ZENODO_PORT}/api/files/${BUCKET_ID}`,
    serverUrl: ZENODO_SERVER_URL,
  };
}

/**
 * Stages a Zenodo experiment that has already been through one or more
 * compaction passes: two batch archives (each holding real Psych-DS-shaped
 * members, built the same way compaction itself would build them) plus a
 * handful of loose (not yet compacted) sessions, .psychds-ignore, and
 * dataset_description.json.
 *
 * Everything is seeded directly (files on the mock, claims written straight
 * to Firestore) rather than driven through compactExperiment/claimFilename,
 * for the same reason seedExperiment in compaction-emulator.test.js does:
 * the shape of a claim or a batch archive is already covered elsewhere, and
 * this suite is about the MERGE, not about reproducing compaction itself.
 */
async function seedFinalizableExperiment({ metadataActive = true } = {}) {
  const experimentID = `finalization-${randomUUID()}`;
  const names = [];

  async function seedBatch(batchName, subjectNumbers) {
    const memberNames = subjectNumbers.map((n) =>
      metadataActive ? `data_raw_subject-${n}.json` : `subject-${n}.json`
    );
    const contents = new Map(
      memberNames.map((name, i) => [
        name,
        Buffer.from(JSON.stringify({ subject: subjectNumbers[i], rt: 400 + subjectNumbers[i] })),
      ])
    );
    const paths = archivePathsFor(zenodoProvider, metadataActive, memberNames);
    const { zip } = await buildArchive(memberNames.map((name) => ({ path: paths.get(name), content: contents.get(name) })));
    mock.seed(batchName, zip);
    names.push(batchName);
    return { memberNames, contents };
  }

  const batch1 = await seedBatch("datapipe-batch-0001.zip", [1, 2, 3]);
  const batch2 = await seedBatch(
    "datapipe-batch-0002.zip",
    [4, 5],
  );

  // Loose (not yet compacted) sessions -- what a pass since the last
  // compaction has collected.
  const looseNames = metadataActive
    ? ["data_raw_subject-6.json", "data_raw_subject-7.json"]
    : ["subject-6.json", "subject-7.json"];
  const looseContents = new Map();
  looseNames.forEach((name, i) => {
    const content = Buffer.from(JSON.stringify({ subject: i + 6, rt: 500 + i }));
    mock.seed(name, content);
    looseContents.set(name, content);
    names.push(name);
  });

  mock.seed("dataset_description.json", JSON.stringify({ name: "study" }));
  names.push("dataset_description.json");

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
      sessions: 7,
      owner: OWNER_ID,
      storageProvider: "zenodo",
      providerContainer: containerFor(),
      collisionCache: {
        salt: SALT,
        warmUntil: Timestamp.fromMillis(Date.now() + 86400000),
      },
    });

  const claims = db.collection("experiments").doc(experimentID).collection("filenameClaims");
  const batch = db.batch();
  for (const name of names) {
    batch.set(claims.doc(claimDocId(SALT, name)), {
      status: "confirmed",
      ownerToken: "seed",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
    });
  }
  await batch.commit();

  return {
    experimentID,
    names,
    batch1,
    batch2,
    looseContents,
    looseNames,
  };
}

const finalArchiveBytes = () => mock.get("datapipe-final.zip");

describe("F1. the full merge", () => {
  it("merges every batch and every loose file into one archive carrying the complete Psych-DS tree", async () => {
    const { experimentID } = await seedFinalizableExperiment();

    const result = await finalizeExperiment(experimentID);

    expect(result.status).toBe("finalized");
    expect(result.archiveName).toBe("datapipe-final.zip");
    // archived counts top-level provider files consumed by the merge: the 2
    // batch archives + 2 loose sessions + .psychds-ignore = 5. Each batch
    // then explodes into its own members once unpacked, which is what the
    // archive's entry count below checks.
    expect(result.archived).toBe(5);

    const entries = readZipEntries(finalArchiveBytes());
    // 3 (batch1) + 2 (batch2) + 2 loose + .psychds-ignore = 8 exploded entries.
    expect(entries.size).toBe(8);
    for (let i = 1; i <= 7; i += 1) {
      expect(entries.has(`data/raw/subject-${i}.json`)).toBe(true);
    }
    expect(entries.has(".psychds-ignore")).toBe(true);
    // The record's descriptor is excluded from the merge and never appears
    // inside the archive.
    expect(entries.has("dataset_description.json")).toBe(false);
  });

  it("leaves dataset_description.json loose and moves .psychds-ignore inside the archive", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    await finalizeExperiment(experimentID);

    expect(mock.has("dataset_description.json")).toBe(true);
    // Nothing regenerates it once finalized, so the loose copy is gone.
    expect(mock.has(PSYCHDS_IGNORE_FILE)).toBe(false);
    const entries = readZipEntries(finalArchiveBytes());
    expect(entries.get(".psychds-ignore").toString("utf8")).toBe(PSYCHDS_IGNORE_CONTENT);
  });

  it("deletes every merged member, leaving only the archive and the descriptor", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    await finalizeExperiment(experimentID);

    expect(mock.keys().sort()).toEqual(["dataset_description.json", "datapipe-final.zip"].sort());
  });

  it("keeps names flat for an experiment that never wrote a slashed path", async () => {
    const { experimentID } = await seedFinalizableExperiment({ metadataActive: false });
    await finalizeExperiment(experimentID);

    const entries = readZipEntries(finalArchiveBytes());
    expect(entries.has("subject-1.json")).toBe(true);
    expect([...entries.keys()].some((name) => name.includes("/"))).toBe(false);
  });
});

describe("F2. byte fidelity through the batch -> unzip -> rezip round trip", () => {
  it("round-trips a batch member's bytes exactly, including non-UTF-8 content", async () => {
    const experimentID = `finalization-${randomUUID()}`;
    const media = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01, 0x80, 0xc0, 0x00, 0x00]);
    const memberNames = ["data_raw_trial-media.png"];
    const paths = archivePathsFor(zenodoProvider, true, memberNames);
    const { zip } = await buildArchive([{ path: paths.get(memberNames[0]), content: media }]);
    mock.seed("datapipe-batch-0001.zip", zip);
    mock.seed("dataset_description.json", JSON.stringify({ name: "study" }));

    await db
      .collection("experiments")
      .doc(experimentID)
      .set({
        active: true,
        metadataActive: true,
        sessions: 1,
        owner: OWNER_ID,
        storageProvider: "zenodo",
        providerContainer: containerFor(),
        collisionCache: { salt: SALT, warmUntil: Timestamp.fromMillis(Date.now() + 86400000) },
      });
    const claims = db.collection("experiments").doc(experimentID).collection("filenameClaims");
    await claims.doc(claimDocId(SALT, "datapipe-batch-0001.zip")).set({
      status: "confirmed",
      ownerToken: "seed",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
    });

    const result = await finalizeExperiment(experimentID);
    expect(result.status).toBe("finalized");

    const entries = readZipEntries(finalArchiveBytes());
    const stored = entries.get("data/raw/trial-media.png");
    expect(stored).toBeDefined();
    expect(stored.equals(media)).toBe(true);
  });

  it("stores loose member contents byte-for-byte", async () => {
    const { experimentID, looseContents } = await seedFinalizableExperiment();
    await finalizeExperiment(experimentID);

    const entries = readZipEntries(finalArchiveBytes());
    for (const [name, content] of looseContents) {
      const path = name.startsWith("data_raw_") ? `data/raw/${name.slice("data_raw_".length)}` : name;
      expect(entries.get(path).equals(content)).toBe(true);
    }
  });
});

describe("F3. verification gates the delete", () => {
  it("keeps every original when the provider reports a bad checksum", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    mock.setCorruptChecksums(true);

    const result = await finalizeExperiment(experimentID);

    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/checksum mismatch/);

    // Nothing merged was removed.
    expect(mock.has("datapipe-batch-0001.zip")).toBe(true);
    expect(mock.has("datapipe-batch-0002.zip")).toBe(true);
    expect(mock.has("data_raw_subject-6.json")).toBe(true);
    expect(mock.has(PSYCHDS_IGNORE_FILE)).toBe(true);
    expect(mock.has("dataset_description.json")).toBe(true);
    // The unverified object is cleaned up rather than left looking sealed.
    expect(mock.has("datapipe-final.zip")).toBe(false);

    const runs = await db
      .collection("experiments")
      .doc(experimentID)
      .collection("finalizationRuns")
      .get();
    expect(runs.empty).toBe(true);

    const expData = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(expData.finalized).not.toBe(true);
  });
});

describe("F4. resuming an interrupted pass", () => {
  async function computeMergedArchive({ experimentID, names, batch1, batch2, looseContents, looseNames }) {
    // Reproduce exactly what runFinalization's merge would produce: batch
    // members re-emitted at their recorded paths, loose files at their
    // reconstructed paths, .psychds-ignore included, dataset_description.json
    // excluded.
    const entries = [];
    for (const [name, content] of batch1.contents) {
      const paths = archivePathsFor(zenodoProvider, true, [name]);
      entries.push({ path: paths.get(name), content });
    }
    for (const [name, content] of batch2.contents) {
      const paths = archivePathsFor(zenodoProvider, true, [name]);
      entries.push({ path: paths.get(name), content });
    }
    const loosePaths = archivePathsFor(zenodoProvider, true, looseNames);
    for (const name of looseNames) {
      entries.push({ path: loosePaths.get(name), content: looseContents.get(name) });
    }
    entries.push({ path: ".psychds-ignore", content: Buffer.from(PSYCHDS_IGNORE_CONTENT) });

    const members = names.filter((n) => n !== "dataset_description.json");
    return { ...(await buildArchive(entries)), members };
  }

  it("finishes a pass whose merged archive was verified but not yet sealed or deleted", async () => {
    const seeded = await seedFinalizableExperiment();
    const { zip, md5: expectedMd5, members } = await computeMergedArchive(seeded);

    mock.seed("datapipe-final.zip", zip);
    await db
      .collection("experiments")
      .doc(seeded.experimentID)
      .collection("finalizationRuns")
      .doc("current")
      .set({
        archiveName: "datapipe-final.zip",
        storagePath: `finalization/${seeded.experimentID}/datapipe-final.zip`,
        status: "uploading",
        memberHashes: members.map((name) => claimDocId(SALT, name)),
        expectedMd5,
        fileCount: members.length,
        createdAt: Timestamp.now(),
      });

    const result = await finalizeExperiment(seeded.experimentID);

    expect(result.status).toBe("finalized");
    expect(result.detail).toMatch(/resumed/);
    // Every original member is gone; no second merge was built.
    expect(mock.has("datapipe-batch-0001.zip")).toBe(false);
    expect(mock.has("data_raw_subject-6.json")).toBe(false);
    expect(mock.has(PSYCHDS_IGNORE_FILE)).toBe(false);
    expect(mock.has("datapipe-final.zip")).toBe(true);

    const expData = (await db.collection("experiments").doc(seeded.experimentID).get()).data();
    expect(expData.finalized).toBe(true);

    const claim = await db
      .collection("experiments")
      .doc(seeded.experimentID)
      .collection("filenameClaims")
      .doc(claimDocId(SALT, "datapipe-batch-0001.zip"))
      .get();
    expect(claim.data().sealed).toBe(true);
  });

  it("resumes after the record was sealed but before the finalized flag was set", async () => {
    const seeded = await seedFinalizableExperiment();
    const { members } = await computeMergedArchive(seeded);

    // Reproduce the exact crash point: everything already merged, uploaded,
    // sealed and deleted -- only the experiment's finalized flag never got
    // written.
    const result0 = await finalizeExperiment(seeded.experimentID);
    expect(result0.status).toBe("finalized");

    // Simulate the crash by manually reverting just the flag, leaving the
    // (now sealed) finalizationRuns record in place.
    await db.collection("experiments").doc(seeded.experimentID).update({
      finalized: FieldValue.delete(),
      finalizedAt: FieldValue.delete(),
    });

    const result = await finalizeExperiment(seeded.experimentID);
    expect(result.status).toBe("finalized");
    expect(result.detail).toMatch(/resumed after seal/);
    expect(result.archived).toBe(members.length);

    const expData = (await db.collection("experiments").doc(seeded.experimentID).get()).data();
    expect(expData.finalized).toBe(true);
  });

  it("discards the record and starts fresh when the merged archive never landed", async () => {
    const seeded = await seedFinalizableExperiment();

    await db
      .collection("experiments")
      .doc(seeded.experimentID)
      .collection("finalizationRuns")
      .doc("current")
      .set({
        archiveName: "datapipe-final.zip",
        storagePath: `finalization/${seeded.experimentID}/datapipe-final.zip`,
        status: "uploading",
        memberHashes: [claimDocId(SALT, "datapipe-batch-0001.zip")],
        expectedMd5: "never-uploaded",
        fileCount: 1,
        createdAt: Timestamp.now(),
      });

    const result = await finalizeExperiment(seeded.experimentID);

    // Nothing was deleted before the crash, so the safe move is to throw the
    // record away and finalize normally.
    expect(result.status).toBe("finalized");
    expect(result.archived).toBe(5);
    expect(mock.has("datapipe-final.zip")).toBe(true);
  });
});

describe("F5. finalization is permanent", () => {
  it("refuses a second finalization", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    const first = await finalizeExperiment(experimentID);
    expect(first.status).toBe("finalized");

    const second = await finalizeExperiment(experimentID);
    expect(second.status).toBe("already-finalized");
    // Nothing else moved -- the archive from the first pass is untouched.
    expect(mock.keys().sort()).toEqual(["dataset_description.json", "datapipe-final.zip"].sort());
  });

  it("refuses a new /api/data submission once finalized", async () => {
    const experimentID = `finalization-reject-${randomUUID()}`;
    await db
      .collection("experiments")
      .doc(experimentID)
      .set({
        active: true,
        activeBase64: true,
        owner: OWNER_ID,
        storageProvider: "zenodo",
        providerContainer: containerFor(),
        finalized: true,
        finalizedAt: Timestamp.now(),
      });

    const response = await fetch(`http://localhost:5001/datapipe-test/us-central1/apidata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        experimentID,
        filename: "late-session.json",
        data: JSON.stringify([{ trial: 1 }]),
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("EXPERIMENT_FINALIZED");
  });

  it("refuses a new /api/base64 submission once finalized", async () => {
    const experimentID = `finalization-reject-b64-${randomUUID()}`;
    await db
      .collection("experiments")
      .doc(experimentID)
      .set({
        active: true,
        activeBase64: true,
        owner: OWNER_ID,
        storageProvider: "zenodo",
        providerContainer: containerFor(),
        finalized: true,
        finalizedAt: Timestamp.now(),
      });

    const response = await fetch(`http://localhost:5001/datapipe-test/us-central1/apibase64`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        experimentID,
        filename: "late-media.png",
        data: "data:application/octet-stream;base64,AAAA",
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("EXPERIMENT_FINALIZED");
  });
});

describe("F6. eligibility", () => {
  it("declines an experiment on a provider with no file cap", async () => {
    const experimentID = `finalization-nocap-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      owner: OWNER_ID,
      sessions: 500,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId: "folder-1" },
    });

    const result = await finalizeExperiment(experimentID);
    expect(result.status).toBe("not-eligible");
    expect(result.detail).toMatch(/no file-count cap/);
  });

  it("declines a legacy OSF experiment with no provider container", async () => {
    const experimentID = `finalization-legacy-${randomUUID()}`;
    await db
      .collection("experiments")
      .doc(experimentID)
      .set({ owner: OWNER_ID, sessions: 500, osfFilesLink: "https://osf.io/x" });

    const result = await finalizeExperiment(experimentID);
    expect(result.status).toBe("not-eligible");
  });

  it("declines an experiment that has never had a filename claimed", async () => {
    const experimentID = `finalization-nosalt-${randomUUID()}`;
    await db
      .collection("experiments")
      .doc(experimentID)
      .set({
        owner: OWNER_ID,
        sessions: 5,
        storageProvider: "zenodo",
        providerContainer: containerFor(),
      });

    const result = await finalizeExperiment(experimentID);
    expect(result.status).toBe("nothing-to-archive");
  });

  it("refuses to run while a compaction (or another finalization) pass holds the lease", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    await db
      .collection("experiments")
      .doc(experimentID)
      .update({ "compaction.compactingUntil": Timestamp.fromMillis(Date.now() + 600000) });

    const result = await finalizeExperiment(experimentID);
    expect(result.status).toBe("leased-elsewhere");
    expect(mock.has("datapipe-final.zip")).toBe(false);
  });

  it("finalizes an experiment that has nothing but its descriptor", async () => {
    // A salt exists (something was submitted at some point) but every session
    // has since been removed by hand -- an edge case, not the common path,
    // but finalizing (with nothing to merge) is still the right terminal
    // state.
    const experimentID = `finalization-empty-${randomUUID()}`;
    mock.seed("dataset_description.json", JSON.stringify({ name: "study" }));
    await db
      .collection("experiments")
      .doc(experimentID)
      .set({
        owner: OWNER_ID,
        sessions: 0,
        storageProvider: "zenodo",
        providerContainer: containerFor(),
        collisionCache: { salt: SALT, warmUntil: Timestamp.fromMillis(Date.now() + 86400000) },
      });

    const result = await finalizeExperiment(experimentID);
    expect(result.status).toBe("finalized");
    expect(result.archived).toBe(0);
    expect(mock.has("dataset_description.json")).toBe(true);
  });
});

describe("F7. the lease is released on every exit path", () => {
  async function leaseIsClear(experimentID) {
    const expData = (await db.collection("experiments").doc(experimentID).get()).data();
    return !expData.compaction?.compactingUntil;
  }

  it("releases the lease after a successful finalization", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    await finalizeExperiment(experimentID);
    expect(await leaseIsClear(experimentID)).toBe(true);
  });

  it("releases the lease after a failed (unverifiable) finalization", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    mock.setCorruptChecksums(true);
    await finalizeExperiment(experimentID);
    expect(await leaseIsClear(experimentID)).toBe(true);
  });

  it("releases the lease after a resumed finalization", async () => {
    const seeded = await seedFinalizableExperiment();
    await db
      .collection("experiments")
      .doc(seeded.experimentID)
      .collection("finalizationRuns")
      .doc("current")
      .set({
        archiveName: "datapipe-final.zip",
        storagePath: `finalization/${seeded.experimentID}/datapipe-final.zip`,
        status: "uploading",
        memberHashes: [claimDocId(SALT, "datapipe-batch-0001.zip")],
        expectedMd5: "never-uploaded",
        fileCount: 1,
        createdAt: Timestamp.now(),
      });
    await finalizeExperiment(seeded.experimentID);
    expect(await leaseIsClear(seeded.experimentID)).toBe(true);
  });
});

describe("F8. refuses to finalize while uploads are still queued", () => {
  async function seedQueueEntry(experimentID, status) {
    const docId = `${experimentID}:queued-${status}-${randomUUID()}.json`.replace(/[/\\]/g, "_");
    await db
      .collection("uploadQueue")
      .doc(docId)
      .set({
        experimentID,
        owner: OWNER_ID,
        filename: `queued-${status}.json`,
        status,
        storageProvider: "zenodo",
        providerErrorCode: "CONTENTION",
        nextRetryAt: Timestamp.fromMillis(Date.now() + 60000),
        createdAt: Timestamp.now(),
      });
    return docId;
  }

  it("refuses when an entry is pending, naming the count, and touches nothing on the provider", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    const queueDocId = await seedQueueEntry(experimentID, "pending");

    const result = await finalizeExperiment(experimentID);

    expect(result.status).toBe("queued-uploads-pending");
    expect(result.detail).toMatch(/1 upload/);

    // Nothing was touched: no archive uploaded, nothing deleted, no
    // finalizationRuns record, the lease was never taken (nothing to
    // release), and the experiment is not finalized.
    expect(mock.has("datapipe-final.zip")).toBe(false);
    expect(mock.has("datapipe-batch-0001.zip")).toBe(true);
    expect(mock.has("datapipe-batch-0002.zip")).toBe(true);
    expect(mock.has("data_raw_subject-6.json")).toBe(true);
    expect(mock.has(PSYCHDS_IGNORE_FILE)).toBe(true);

    const runs = await db.collection("experiments").doc(experimentID).collection("finalizationRuns").get();
    expect(runs.empty).toBe(true);

    const expData = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(expData.finalized).not.toBe(true);
    expect(expData.compaction?.compactingUntil).toBeUndefined();

    await db.collection("uploadQueue").doc(queueDocId).delete();
  });

  it("refuses when an entry is processing (mid-retry), not just pending", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    const queueDocId = await seedQueueEntry(experimentID, "processing");

    const result = await finalizeExperiment(experimentID);

    expect(result.status).toBe("queued-uploads-pending");
    expect(mock.has("datapipe-final.zip")).toBe(false);

    await db.collection("uploadQueue").doc(queueDocId).delete();
  });

  it("proceeds normally once the queue has drained", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    const queueDocId = await seedQueueEntry(experimentID, "pending");
    await db.collection("uploadQueue").doc(queueDocId).update({ status: "completed" });

    const result = await finalizeExperiment(experimentID);

    expect(result.status).toBe("finalized");

    await db.collection("uploadQueue").doc(queueDocId).delete();
  });
});

describe("F9. the retry worker never writes into a finalized record", () => {
  async function seedRetryableQueueEntry(experimentID, filename, payload) {
    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    const storagePath = `upload-queue/${docId}`;
    await storage.bucket().file(storagePath).save(payload, { contentType: "text/plain" });
    await db
      .collection("uploadQueue")
      .doc(docId)
      .set({
        experimentID,
        owner: OWNER_ID,
        filename,
        storagePath,
        dataType: "data",
        status: "pending",
        storageProvider: "zenodo",
        providerContainer: containerFor(),
        errorCode: 0,
        retryCount: 0,
        maxRetries: 5,
        createdAt: Timestamp.now(),
        lastAttemptAt: null,
        // Already due -- retryPendingUploads' query gates on nextRetryAt <= now.
        nextRetryAt: Timestamp.fromMillis(Date.now() - 1000),
        completedAt: null,
        failureReason: "Provider error 500: Internal server error",
        deduplicationKey: `${experimentID}:${filename}`,
        sessionIncremented: false,
      });
    return docId;
  }

  it("marks the entry failed with a finalization-specific reason instead of writing to the provider", async () => {
    const experimentID = `finalization-retry-${randomUUID()}`;
    mock.seed("dataset_description.json", JSON.stringify({ name: "study" }));
    await db
      .collection("experiments")
      .doc(experimentID)
      .set({
        active: true,
        owner: OWNER_ID,
        storageProvider: "zenodo",
        providerContainer: containerFor(),
        finalized: true,
        finalizedAt: Timestamp.now(),
      });

    const docId = await seedRetryableQueueEntry(experimentID, "stranded-session.json", JSON.stringify([{ trial: 1 }]));
    const filesBefore = mock.size();

    // Scoped to this suite's own owner -- see the ownerScope seam's doc
    // comment in scheduled-upload-retry.ts. The query behind it is global, so
    // this keeps the assertion from being affected by other suites' queue
    // entries running concurrently against the shared emulator.
    await retryPendingUploads(OWNER_ID);

    // The whole point: no PUT ever reached the provider for this file.
    expect(mock.size()).toBe(filesBefore);
    expect(mock.has("stranded-session.json")).toBe(false);

    const after = (await db.collection("uploadQueue").doc(docId).get()).data();
    expect(after.status).toBe("failed");
    expect(after.failureReason).toMatch(/finalized/i);
    expect(after.failureReason).toMatch(/download it from the queue panel/i);
    // The stale provider-error code from before finalization must not
    // survive -- it would tell QueuePanel this is still a provider problem,
    // which it no longer is.
    expect(after.providerErrorCode).toBeNull();

    // The payload itself must still be recoverable via api-queue-status.ts's
    // download path -- this guard must not also delete it.
    const [stillThere] = await storage.bucket().file(`upload-queue/${docId}`).exists();
    expect(stillThere).toBe(true);

    await db.collection("uploadQueue").doc(docId).delete();
    await storage.bucket().file(`upload-queue/${docId}`).delete().catch(() => undefined);
  });

  it("writes normally when the experiment is not finalized", async () => {
    // Control: the guard must not fire for an ordinary in-flight experiment,
    // or every retry would start failing.
    const experimentID = `finalization-retry-control-${randomUUID()}`;
    mock.seed("dataset_description.json", JSON.stringify({ name: "study" }));
    await db
      .collection("experiments")
      .doc(experimentID)
      .set({
        active: true,
        owner: OWNER_ID,
        storageProvider: "zenodo",
        providerContainer: containerFor(),
      });

    const docId = await seedRetryableQueueEntry(experimentID, "normal-session.json", JSON.stringify([{ trial: 1 }]));

    await retryPendingUploads(OWNER_ID);

    expect(mock.has("normal-session.json")).toBe(true);
    const after = (await db.collection("uploadQueue").doc(docId).get()).data();
    expect(after.status).toBe("completed");

    await db.collection("uploadQueue").doc(docId).delete();
  });
});

describe("F10. archive-too-large", () => {
  it("refuses a merge that exceeds the provider's per-file limit, uploading and deleting nothing", async () => {
    const { experimentID } = await seedFinalizableExperiment();
    const originalMax = zenodoProvider.capabilities.maxFileSizeBytes;
    // Absurdly small -- any real merge of this suite's fixtures exceeds it,
    // without needing to actually build gigabytes of data to prove the gate.
    zenodoProvider.capabilities.maxFileSizeBytes = 10;

    let result;
    try {
      result = await finalizeExperiment(experimentID);
    } finally {
      zenodoProvider.capabilities.maxFileSizeBytes = originalMax;
    }

    expect(result.status).toBe("archive-too-large");
    expect(result.detail).toMatch(/per-file limit/);

    // Nothing was uploaded...
    expect(mock.has("datapipe-final.zip")).toBe(false);
    // ...and nothing was deleted.
    expect(mock.has("datapipe-batch-0001.zip")).toBe(true);
    expect(mock.has("datapipe-batch-0002.zip")).toBe(true);
    expect(mock.has("data_raw_subject-6.json")).toBe(true);
    expect(mock.has("data_raw_subject-7.json")).toBe(true);
    expect(mock.has(PSYCHDS_IGNORE_FILE)).toBe(true);
    expect(mock.has("dataset_description.json")).toBe(true);

    const runs = await db.collection("experiments").doc(experimentID).collection("finalizationRuns").get();
    expect(runs.empty).toBe(true);

    const expData = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(expData.finalized).not.toBe(true);
    expect(expData.compaction?.compactingUntil).toBeUndefined();
  });
});
