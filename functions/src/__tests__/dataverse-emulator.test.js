/**
 * @jest-environment node
 */

// End-to-end coverage for the Dataverse adapter, driving the REAL deployed
// apidata/apibase64 functions inside the Functions emulator against a
// self-contained mock Dataverse installation -- the house pattern established
// by gdrive-emulator.test.js.
//
// HOW THE MOCK IS REACHED, AND WHY NO ENV WIRING IS NEEDED. Dataverse is
// federated, so serverUrl is per-connection data rather than a provider
// constant: dataverse.ts's resolveServerUrl reads it off the container first
// and the connection second, and (unlike connect-provider.ts, which gates
// researcher-supplied URLs through isAllowedServerUrl at CONNECT time) it
// does not re-validate. Seeding http://127.0.0.1:3582 straight into the
// experiment's providerContainer is therefore all it takes to point the
// adapter at this file's mock. Zenodo needed an env-gated override for
// exactly the reason Dataverse does not -- see zenodo-emulator.test.js.
//
// TOKENS ARE PLAINTEXT (no "v1:" prefix -> crypto-utils.ts's decrypt() passes
// them through), so this jest process and the separate Functions-emulator
// process need not agree on TOKEN_ENCRYPTION_KEY. Same as gdrive's suite.
//
// The mock reproduces the contract corrections the live spike found rather
// than the published guides: /add returns 200 (not the documented 201), and
// duplicate filenames are SILENTLY RENAMED rather than rejected.

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";

jest.setTimeout(30000);

const config = { projectId: "datapipe-test", storageBucket: "datapipe-test.appspot.com" };
const DATAVERSE_OWNER_ID = "dataverse-emulator-owner";
const DATAVERSE_PORT = 3582;
const SERVER_URL = `http://127.0.0.1:${DATAVERSE_PORT}`;
const DATASET_ID = 42;

const sampleData = `[{"trial_type":"html-keyboard-response","trial_index":1,"time_elapsed":776}]`;

// Dataverse's real contention rejection, live-verified against
// demo.dataverse.org (2026-07-26): a generic 400, NOT the 403 dataset-lock
// the design originally anticipated. Reproduced verbatim because the
// adapter's CONTENTION mapping keys off this prose.
const CONTENTION_MESSAGE = "Failed to add file to dataset.";
// The other 400 that contains the same phrase but is NOT transient. The
// adapter excludes it from CONTENTION deliberately; retrying it fast would
// spin uselessly.
const SAME_CONTENT_MESSAGE =
  "This file has the same content as prior.json that is in the dataset. \nFailed to add file to dataset.";

async function postTo(fn, body) {
  const response = await fetch(`http://localhost:5001/datapipe-test/us-central1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body),
  });
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

// Buffer-based multipart parser. Deliberately NOT the split-on-string
// approach gdrive's suite uses: the base64 case below uploads bytes that are
// invalid UTF-8, and round-tripping those through a string would corrupt
// them silently -- making a genuine transport bug look like a passing test.
function parseMultipart(buf, contentTypeHeader) {
  const match = /boundary=("?)([^;"]+)\1/.exec(contentTypeHeader || "");
  if (!match) return [];
  const boundary = Buffer.from(`--${match[2]}`);
  const parts = [];

  let idx = buf.indexOf(boundary);
  while (idx !== -1) {
    const start = idx + boundary.length;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;

    let segment = buf.subarray(start, next);
    if (segment[0] === 0x0d && segment[1] === 0x0a) segment = segment.subarray(2);
    if (
      segment.length >= 2 &&
      segment[segment.length - 2] === 0x0d &&
      segment[segment.length - 1] === 0x0a
    ) {
      segment = segment.subarray(0, segment.length - 2);
    }

    const sep = segment.indexOf("\r\n\r\n");
    if (sep !== -1) {
      parts.push({
        headers: segment.subarray(0, sep).toString("utf8"),
        content: segment.subarray(sep + 4),
      });
    }
    idx = next;
  }
  return parts;
}

function createMockDataverseServer() {
  const app = express();
  app.use(express.raw({ type: () => true, limit: "20mb" }));

  // fileId -> {label, directoryLabel, content, contentType, tabIngest}
  const filesById = new Map();
  const addCountsByName = new Map();
  const deleteCountsById = new Map();
  const forcedStatus = new Map();
  let nextFileId = 1000;

  const fullName = (f) => (f.directoryLabel ? `${f.directoryLabel}/${f.label}` : f.label);

  app.get("/api/users/:me", (req, res) => {
    res.status(200).json({ status: "OK", data: { id: 1, displayName: "Mock Researcher" } });
  });

  app.get("/api/info/version", (req, res) => {
    // 6.11, comfortably past the 5.11 tabIngest floor, so setupWarnings
    // produces no version warning.
    res.status(200).json({ status: "OK", data: { version: "6.11" } });
  });

  app.post("/api/dataverses/:alias/datasets", (req, res) => {
    // 201, which is what demo.dataverse.org actually returns -- the guides
    // say 200, and hardcoding that made every real creation throw.
    res.status(201).json({
      status: "OK",
      data: { id: DATASET_ID, persistentId: "doi:10.5072/FK2/MOCKED" },
    });
  });

  app.post("/api/datasets/:id/add", (req, res) => {
    const parts = parseMultipart(req.body, req.headers["content-type"]);
    const filePart = parts.find((p) => /name="file"/.test(p.headers));
    const jsonPart = parts.find((p) => /name="jsonData"/.test(p.headers));

    if (!filePart) {
      res.status(400).json({ status: "ERROR", message: "No file part in request." });
      return;
    }

    const filenameMatch = /filename="([^"]*)"/.exec(filePart.headers);
    const requestedLabel = filenameMatch ? filenameMatch[1] : "unnamed";
    const contentTypeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(filePart.headers);
    let jsonData = {};
    try {
      jsonData = JSON.parse(jsonPart.content.toString("utf8"));
    } catch {
      jsonData = {};
    }
    const directoryLabel = jsonData.directoryLabel;

    addCountsByName.set(requestedLabel, (addCountsByName.get(requestedLabel) || 0) + 1);

    const forced = forcedStatus.get(requestedLabel);
    if (forced) {
      res.status(forced.status).json({ status: "ERROR", message: forced.message });
      return;
    }

    // SILENT RENAME. IQSS's own DuplicateFilesIT asserts a second README.md
    // comes back as README-1.md; Dataverse never returns a name conflict.
    // This is the behavior WriteResult.storedFilename exists to detect.
    let label = requestedLabel;
    const collides = (candidate) =>
      Array.from(filesById.values()).some(
        (f) => f.label === candidate && f.directoryLabel === directoryLabel
      );
    if (collides(label)) {
      const dot = requestedLabel.lastIndexOf(".");
      const base = dot === -1 ? requestedLabel : requestedLabel.slice(0, dot);
      const ext = dot === -1 ? "" : requestedLabel.slice(dot);
      let n = 1;
      while (collides(`${base}-${n}${ext}`)) n++;
      label = `${base}-${n}${ext}`;
    }

    const id = nextFileId++;
    filesById.set(id, {
      id,
      label,
      directoryLabel,
      content: Buffer.from(filePart.content),
      contentType: contentTypeMatch ? contentTypeMatch[1].trim() : null,
      tabIngest: jsonData.tabIngest,
    });

    // 200, not the documented 201 -- the Java source returns ok() and the
    // IQSS integration suite asserts 200.
    res.status(200).json({
      status: "OK",
      data: {
        files: [
          {
            label,
            ...(directoryLabel ? { directoryLabel } : {}),
            dataFile: { id, filename: label, contentType: contentTypeMatch?.[1]?.trim() },
          },
        ],
      },
    });
  });

  app.delete("/api/files/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    deleteCountsById.set(id, (deleteCountsById.get(id) || 0) + 1);
    const forced = forcedStatus.get(`delete:${id}`);
    if (forced) {
      res.status(forced.status).json({ status: "ERROR", message: forced.message });
      return;
    }
    // DELETE physically removes the file while the dataset is unpublished,
    // which is the case DataPipe always operates in (datasets stay in draft).
    filesById.delete(id);
    res.status(200).json({ status: "OK" });
  });

  // The literal ":draft" in the adapter's URL is matched here as a route
  // parameter value -- express reads ":version" from the pattern, and the
  // incoming path segment is the literal text ":draft".
  app.get("/api/datasets/:id/versions/:version/files", (req, res) => {
    const all = Array.from(filesById.values());
    const limit = parseInt(req.query.limit, 10) || all.length || 1;
    const offset = parseInt(req.query.offset, 10) || 0;
    const page = all.slice(offset, offset + limit);
    res.status(200).json({
      status: "OK",
      totalCount: all.length,
      data: page.map((f) => ({
        label: f.label,
        ...(f.directoryLabel ? { directoryLabel: f.directoryLabel } : {}),
        dataFile: { id: f.id, filename: f.label },
      })),
    });
  });

  return new Promise((resolve, reject) => {
    const tryListen = (retriesLeft) => {
      const server = app.listen(DATAVERSE_PORT);
      server.once("listening", () => {
        resolve({
          server,
          getAddCount: (label) => addCountsByName.get(label) || 0,
          getDeleteCount: (id) => deleteCountsById.get(Number(id)) || 0,
          getFile: (name) => Array.from(filesById.values()).find((f) => fullName(f) === name) || null,
          getStoredNames: () => Array.from(filesById.values()).map(fullName),
          seedFile: (label, directoryLabel, content = "seeded") => {
            const id = nextFileId++;
            filesById.set(id, {
              id,
              label,
              directoryLabel,
              content: Buffer.from(content),
              contentType: "application/json",
              tabIngest: "false",
            });
            return id;
          },
          forceStatus: (key, status, message) => forcedStatus.set(key, { status, message }),
          reset: () => {
            filesById.clear();
            addCountsByName.clear();
            deleteCountsById.clear();
            forcedStatus.clear();
            nextFileId = 1000;
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
let mockDataverse;

beforeAll(async () => {
  mockDataverse = await createMockDataverseServer();

  initializeApp(config);
  db = getFirestore();

  await db.collection("users").doc(DATAVERSE_OWNER_ID).set({
    connectedAccounts: {
      dataverse: {
        authMethod: "static-token",
        encryptedToken: "dataverse-integration-token", // plaintext fallback
        serverUrl: SERVER_URL,
      },
    },
  });
});

afterEach(() => {
  mockDataverse.reset();
});

afterAll(() => {
  mockDataverse.server.close();
});

async function createDataverseExperiment(experimentID, overrides = {}) {
  await db
    .collection("experiments")
    .doc(experimentID)
    .set({
      active: true,
      activeBase64: true,
      metadataActive: false,
      owner: DATAVERSE_OWNER_ID,
      storageProvider: "dataverse",
      providerContainer: {
        provider: "dataverse",
        datasetId: DATASET_ID,
        persistentId: "doi:10.5072/FK2/MOCKED",
        serverUrl: SERVER_URL,
      },
      ...overrides,
    });
}

describe("D1. dataverse experiment: apidata POST succeeds, suppresses tabular ingest, warms the cache", () => {
  it("returns 201, sends tabIngest=false, stores the bytes, and leaves collisionCache warm", async () => {
    const experimentID = `dataverse-e2e-1-${randomUUID()}`;
    const filename = `d1-${randomUUID()}.json`;
    await createDataverseExperiment(experimentID);

    const before = Date.now();
    const response = await saveData({ experimentID, data: sampleData, filename });

    expect(response.status).toBe(201);
    expect(mockDataverse.getAddCount(filename)).toBe(1);

    const stored = mockDataverse.getFile(filename);
    expect(stored).not.toBeNull();
    expect(stored.content.toString("utf8")).toBe(sampleData);
    // The STRING "false", not the boolean. Omitting it (or sending a boolean
    // the server ignores) makes Dataverse convert CSVs to archival .tab
    // files, mangling researchers' data with no error anywhere.
    expect(stored.tabIngest).toBe("false");

    const expDataAfter = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(typeof expDataAfter.collisionCache.salt).toBe("string");
    expect(expDataAfter.collisionCache.warmUntil.toMillis()).toBeGreaterThan(before);
  });
});

describe("D2. duplicate filename is rejected without a second provider write", () => {
  it("second POST gets OSF_FILE_EXISTS and the mock sees exactly one add", async () => {
    const experimentID = `dataverse-e2e-2-${randomUUID()}`;
    const filename = `d2-dup-${randomUUID()}.json`;
    await createDataverseExperiment(experimentID);

    const first = await saveData({ experimentID, data: sampleData, filename });
    expect(first.status).toBe(201);

    const second = await saveData({ experimentID, data: sampleData, filename });
    expect(second.status).toBe(400);
    expect(second.body).toEqual({ ...MESSAGES.OSF_FILE_EXISTS, metadataMessage: "" });

    // Dataverse cannot return a name conflict -- it would have silently
    // stored a SECOND file as "<name>-1.json" -- so the Firestore cache is
    // the only duplicate gate this provider has.
    expect(mockDataverse.getAddCount(filename)).toBe(1);
    expect(mockDataverse.getStoredNames().filter((n) => n === filename)).toHaveLength(1);
  });
});

describe("D3. metadata on dataverse is delete-then-re-add", () => {
  it("creates dataset_description.json, stores the ref, then DELETEs that id and re-adds, leaving one file", async () => {
    const experimentID = `dataverse-e2e-3-${randomUUID()}`;
    await createDataverseExperiment(experimentID, { metadataActive: true });

    const first = await saveData({
      experimentID,
      data: sampleData,
      filename: `d3-a-${randomUUID()}.json`,
    });
    expect(first.status).toBe(201);
    expect(mockDataverse.getAddCount("dataset_description.json")).toBe(1);

    const metadataDoc = (await db.collection("metadata").doc(experimentID).get()).data();
    expect(metadataDoc.metadataFileRef).toBeDefined();
    const refId = metadataDoc.metadataFileRef.id;
    // Must be a real id, never the truthy string "undefined" -- that would
    // sail through metadata-block.ts's guard and address /api/files/undefined
    // on every later update.
    expect(refId).toBeDefined();
    expect(refId).not.toBe("undefined");

    const second = await saveData({
      experimentID,
      data: sampleData,
      filename: `d3-b-${randomUUID()}.json`,
    });
    expect(second.status).toBe(201);

    // /api/files/{id}/replace is unavailable on a never-published draft, so
    // updateFile is DELETE + re-add -- non-atomic by design, with a window
    // where the metadata file does not exist.
    expect(mockDataverse.getDeleteCount(refId)).toBe(1);
    expect(mockDataverse.getAddCount("dataset_description.json")).toBe(2);
    // And exactly one survives: if the delete had been skipped, Dataverse
    // would have silently renamed the re-add to dataset_description-1.json.
    expect(
      mockDataverse.getStoredNames().filter((n) => n === "dataset_description.json")
    ).toHaveLength(1);
    expect(mockDataverse.getStoredNames()).not.toContain("dataset_description-1.json");
  });
});

describe("D4. directoryLabel round-trip for Psych-DS paths", () => {
  it("splits data/raw/<name> into directoryLabel + label on write, and the cache claims the rejoined path", async () => {
    const experimentID = `dataverse-e2e-4-${randomUUID()}`;
    const filename = `d4-${randomUUID()}.json`;
    await createDataverseExperiment(experimentID, { metadataActive: true });

    const first = await saveData({ experimentID, data: sampleData, filename });
    expect(first.status).toBe(201);

    // Unlike Zenodo's flat keyspace, Dataverse keeps the real Psych-DS
    // structure via a flat directoryLabel string.
    const stored = mockDataverse.getFile(`data/raw/${filename}`);
    expect(stored).not.toBeNull();
    expect(stored.directoryLabel).toBe("data/raw");
    expect(stored.label).toBe(filename);

    // The claim namespace is the REJOINED path (this adapter's storedNameFor
    // is identity, and listFiles rejoins directoryLabel + label), so a repeat
    // submission is caught. If listFiles returned the bare label instead,
    // rehydration would miss and Dataverse would silently duplicate.
    const second = await saveData({ experimentID, data: sampleData, filename });
    expect(second.status).toBe(400);
    expect(second.body).toEqual(expect.objectContaining(MESSAGES.OSF_FILE_EXISTS));
    expect(mockDataverse.getAddCount(filename)).toBe(1);
  });
});

describe("D5. contention is classified as transient and retried on the fast tier", () => {
  it("a 400 'Failed to add file to dataset.' queues with providerErrorCode CONTENTION and a ~60s first retry", async () => {
    const experimentID = `dataverse-e2e-5-${randomUUID()}`;
    const filename = `d5-${randomUUID()}.json`;
    await createDataverseExperiment(experimentID);

    mockDataverse.forceStatus(filename, 400, CONTENTION_MESSAGE);

    const queuedAt = Date.now();
    const response = await saveData({ experimentID, data: sampleData, filename });
    expect(response.status).toBe(202);

    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    const queueData = (await db.collection("uploadQueue").doc(docId).get()).data();
    expect(queueData.providerErrorCode).toBe("CONTENTION");
    expect(queueData.storageProvider).toBe("dataverse");
    expect(queueData.providerContainer.datasetId).toBe(DATASET_ID);
    // The fast tier is the whole condition of Dataverse's CONDITIONAL PASS:
    // a 30-student burst collides ~30% of the time, and without this those
    // submissions waited 1-2 hours instead of ~1 minute.
    expect(queueData.nextRetryAt.toMillis()).toBeLessThan(queuedAt + 10 * 60 * 1000);
  });
});

describe("D6. duplicate CONTENT is not mistaken for contention", () => {
  it("the same-content 400 queues on the slow tier, not the 60-second one", async () => {
    const experimentID = `dataverse-e2e-6-${randomUUID()}`;
    const filename = `d6-${randomUUID()}.json`;
    await createDataverseExperiment(experimentID);

    // Contains "Failed to add file to dataset." too, so a naive regex would
    // classify this as CONTENTION and spin on it -- re-uploading identical
    // bytes gets the identical rejection every time.
    mockDataverse.forceStatus(filename, 400, SAME_CONTENT_MESSAGE);

    const queuedAt = Date.now();
    const response = await saveData({ experimentID, data: sampleData, filename });
    expect(response.status).toBe(202);

    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    const queueData = (await db.collection("uploadQueue").doc(docId).get()).data();
    expect(queueData.providerErrorCode).toBe("UNAVAILABLE");
    expect(queueData.nextRetryAt.toMillis()).toBeGreaterThan(queuedAt + 30 * 60 * 1000);
  });
});

describe("D7. auth failure maps to AUTH_EXPIRED", () => {
  it("a 401 from the installation queues the submission tagged AUTH_EXPIRED", async () => {
    const experimentID = `dataverse-e2e-7-${randomUUID()}`;
    const filename = `d7-${randomUUID()}.json`;
    await createDataverseExperiment(experimentID);

    // Dataverse returns 401 for both an invalid token and permission-denied.
    mockDataverse.forceStatus(filename, 401, "Bad api key");

    const response = await saveData({ experimentID, data: sampleData, filename });
    expect(response.status).toBe(202);

    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    const queueData = (await db.collection("uploadQueue").doc(docId).get()).data();
    expect(queueData.providerErrorCode).toBe("AUTH_EXPIRED");
  });
});

describe("D8. base64 media path", () => {
  it("apibase64 stores the decoded bytes intact through the multipart add", async () => {
    const experimentID = `dataverse-e2e-8-${randomUUID()}`;
    const filename = `d8-${randomUUID()}.bin`;
    await createDataverseExperiment(experimentID);

    // Invalid UTF-8 on purpose: anything that stringifies the payload en
    // route (including a careless multipart implementation on either side)
    // corrupts these bytes detectably.
    const raw = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x42, 0x00, 0x7f]);
    const response = await saveBase64({ experimentID, data: raw.toString("base64"), filename });

    expect(response.status).toBe(201);
    const stored = mockDataverse.getFile(filename);
    expect(stored).not.toBeNull();
    expect(Buffer.compare(stored.content, raw)).toBe(0);
  });
});

describe("D9. cold collision cache rehydrates from the draft file listing", () => {
  it("a path-prefixed file already in the dataset is caught as a duplicate after the cache goes cold", async () => {
    const experimentID = `dataverse-e2e-9-${randomUUID()}`;
    const filename = `d9-${randomUUID()}.json`;
    await createDataverseExperiment(experimentID, {
      metadataActive: true,
      collisionCache: {
        salt: "d9-retained-salt",
        warmUntil: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
      },
    });
    // Present on the provider with a directoryLabel, unknown to Firestore --
    // rehydration has to rejoin the two halves to recognise it.
    mockDataverse.seedFile(filename, "data/raw", "an earlier session");

    const response = await saveData({ experimentID, data: sampleData, filename });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining(MESSAGES.OSF_FILE_EXISTS));
    expect(mockDataverse.getAddCount(filename)).toBe(0);
    expect(mockDataverse.getFile(`data/raw/${filename}`).content.toString("utf8")).toBe(
      "an earlier session"
    );

    const expDataAfter = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(expDataAfter.collisionCache.salt).toBe("d9-retained-salt");
    expect(expDataAfter.collisionCache.warmUntil.toMillis()).toBeGreaterThan(Date.now());
  });
});

describe("D10. silent rename when the cache does not know about an existing file", () => {
  // Documents CURRENT behavior, which is not obviously the desired behavior.
  //
  // The cache is the only duplicate gate on Dataverse, so this needs a file
  // the cache cannot know about: seeded on the provider AFTER the cache was
  // warmed, which is the shape of a researcher uploading into the dataset by
  // hand mid-study. DataPipe writes, and Dataverse silently renames.
  //
  // The adapter does its part -- writeSessionFile reads storedFilename back
  // off the response's `label` rather than assuming it. But NOTHING CONSUMES
  // storedFilename: api-data.ts confirms the claim under the requested name
  // (claimName, api-data.ts:190/300/341), so Firestore records a claim for
  // "<name>.json" while the dataset actually holds "<name>-1.json". A later
  // rehydration lists the renamed file and the two never reconcile.
  //
  // Asserted as-is rather than as a bug so the suite is honest about what
  // ships today; if the mismatch is ever surfaced or reconciled, this test
  // should be updated deliberately rather than silently.
  it("the write succeeds under a renamed label while the cache still holds the requested name", async () => {
    const experimentID = `dataverse-e2e-10-${randomUUID()}`;
    const filename = `d10-${randomUUID()}.json`;
    await createDataverseExperiment(experimentID);

    // Warm the cache with an unrelated submission first, so the cold-cache
    // rehydration path (D9) is not what runs here.
    await saveData({ experimentID, data: sampleData, filename: `d10-warm-${randomUUID()}.json` });
    mockDataverse.seedFile(filename, undefined, "uploaded by hand");

    const response = await saveData({ experimentID, data: sampleData, filename });

    // Accepted, not rejected: the cache had no claim for this name.
    expect(response.status).toBe(201);
    // Dataverse renamed it rather than reporting a conflict, and the
    // hand-uploaded file is untouched.
    expect(mockDataverse.getFile(filename).content.toString("utf8")).toBe("uploaded by hand");
    const renamed = mockDataverse.getStoredNames().filter((n) => n.startsWith(`${filename.slice(0, -5)}-1`));
    expect(renamed).toHaveLength(1);

    // The gap: the claim is recorded under the REQUESTED name, which is not
    // the name the provider holds for DataPipe's file.
    const claims = await db
      .collection("experiments")
      .doc(experimentID)
      .collection("filenameClaims")
      .get();
    expect(claims.size).toBeGreaterThan(0);
  });
});
