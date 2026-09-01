/**
 * @jest-environment node
 */

// RED-phase integration tests for step 3a (docs/provider-migration-design.md,
// scratchpad/step3a-collision-cache-spec.md), cases 13-17 of the test plan.
//
// These exercise the deployed-in-emulator apidata/apibase64 functions end to
// end against a mock OSF server, following the pattern in
// early-persist-emulator.test.js: a self-contained express server started on
// an OS-assigned port (`listen(0)`) rather than the shared, fixed-port
// mock-server.ts used by metadata-emulator.test.js. Two reasons for that
// choice instead of extending mock-server.ts:
//   1. mock-server.ts binds a hardcoded port (3000); a second test file
//      binding the same port would race it when Jest runs files in parallel
//      workers, causing spurious EADDRINUSE failures unrelated to collision
//      logic. `listen(0)` sidesteps that entirely.
//   2. early-persist-emulator.test.js already establishes this inline-mock
//      convention for tests that need per-test control over the OSF
//      response, which is exactly what cases 14/15 need (forcing 409/500).
// mock-server.ts itself is untouched.
//
// Until api-data.ts / api-base64.ts / collision-cache.ts are implemented,
// these requests never claim a filename in Firestore at all, so most
// assertions here fail on missing behavior (no collisionCache field ever
// appears, no claim docs, no claimToken on the queue doc) rather than on any
// transport-level problem.

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID, createHash } from "crypto";
import express from "express";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };

const OWNER_ID = "collision-int-owner";

const sampleData = `[{"trial_type":"html-keyboard-response","trial_index":1,"time_elapsed":776}]`;
const sampleBase64 = Buffer.from("collision cache integration payload").toString("base64");

async function saveData(body) {
  const response = await fetch("http://localhost:5001/datapipe-test/us-central1/apidata", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body),
  });
  const message = await response.json();
  return { status: response.status, body: message };
}

async function saveBase64Data(body) {
  const response = await fetch("http://localhost:5001/datapipe-test/us-central1/apibase64", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body),
  });
  const message = await response.json();
  return { status: response.status, body: message };
}

// Mirrors collision-cache.ts's hashing rule (sha256hex(salt + ":" + filename))
// so tests can look up the exact claim doc a request should have produced.
function claimHash(salt, filename) {
  return createHash("sha256").update(`${salt}:${filename}`).digest("hex");
}

// A minimal, self-contained mock OSF "files" container:
//   GET  /files            -> osfProvider.listFiles            (?meta=)
//   PUT  /files?name=<...> -> osfProvider.writeSessionFile / putFileOSF
// with in-process (not HTTP) controls, since the test and the mock server
// share the same Node process.
function createMockOSFServer() {
  const app = express();
  const uploadCountsByFilename = new Map();
  const forcedStatusByFilename = new Map();

  app.get("/files", (req, res) => {
    // Always an empty container: every experiment in this suite starts
    // fresh, so rehydration (if implemented) should complete trivially.
    res.json({ data: [] });
  });

  app.put("/files", (req, res) => {
    const filename = String(req.query.name || "");
    uploadCountsByFilename.set(filename, (uploadCountsByFilename.get(filename) || 0) + 1);

    const forcedStatus = forcedStatusByFilename.get(filename);
    if (forcedStatus && forcedStatus !== 201) {
      // Deliberately setting only the status (not a custom statusMessage) so
      // Node's default HTTP reason phrase applies — e.g. 409 -> "Conflict",
      // 500 -> "Internal Server Error" — matching what production code
      // (api-data.ts's `result.providerMessage === "Conflict"` check) expects
      // from a real OSF response.
      res.status(forcedStatus).json({ errors: [{ detail: `mock-forced-status-${forcedStatus}` }] });
      return;
    }

    res.status(201).json({
      data: { attributes: { name: filename, kind: "file" }, id: "osfstorage/mock-upload" },
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        server,
        port: server.address().port,
        getUploadCount: (filename) => uploadCountsByFilename.get(filename) || 0,
        forceStatus: (filename, status) => forcedStatusByFilename.set(filename, status),
        reset: () => {
          uploadCountsByFilename.clear();
          forcedStatusByFilename.clear();
        },
      });
    });
  });
}

let db;
let mockOSF;
let filesLink;

beforeAll(async () => {
  mockOSF = await createMockOSFServer();
  filesLink = `http://localhost:${mockOSF.port}/files`;

  initializeApp(config);
  db = getFirestore();

  await db.collection("users").doc(OWNER_ID).set({
    osfTokenValid: true,
    osfToken: "valid",
    usingPersonalToken: true,
  });
});

afterEach(() => {
  mockOSF.reset();
});

afterAll(async () => {
  mockOSF.server.close();
});

async function createDataExperiment(experimentID, overrides = {}) {
  await db
    .collection("experiments")
    .doc(experimentID)
    .set({
      active: true,
      metadataActive: false,
      owner: OWNER_ID,
      osfFilesLink: filesLink,
      ...overrides,
    });
}

async function createBase64Experiment(experimentID, overrides = {}) {
  await db
    .collection("experiments")
    .doc(experimentID)
    .set({
      activeBase64: true,
      owner: OWNER_ID,
      osfFilesLink: filesLink,
      ...overrides,
    });
}

describe("13. apidata: duplicate filename is rejected without a second provider upload", () => {
  it("first POST succeeds, second POST for the same filename gets OSF_FILE_EXISTS, and OSF received exactly one upload", async () => {
    const experimentID = `collision-int13-${randomUUID()}`;
    const filename = `dup-${randomUUID()}.json`;
    await createDataExperiment(experimentID);

    const first = await saveData({ experimentID, data: sampleData, filename });
    expect(first.status).toBe(201);

    const second = await saveData({ experimentID, data: sampleData, filename });
    expect(second.status).toBe(400);
    expect(second.body).toEqual({ ...MESSAGES.OSF_FILE_EXISTS, metadataMessage: "" });

    expect(mockOSF.getUploadCount(filename)).toBe(1);
  });
});

describe("14. dual-run disagreement between an empty cache and a 409 from OSF", () => {
  it("responds OSF_FILE_EXISTS, confirms the claim, and logs a collisionCacheDisagreement entry", async () => {
    const experimentID = `collision-int14-${randomUUID()}`;
    const filename = `disagree-${randomUUID()}.json`;
    await createDataExperiment(experimentID);

    // The cache has no claim for this filename (fresh experiment, empty
    // mock container) — but OSF itself reports the name is already taken.
    mockOSF.forceStatus(filename, 409);

    const response = await saveData({ experimentID, data: sampleData, filename });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ ...MESSAGES.OSF_FILE_EXISTS, metadataMessage: "" });

    const expDataAfter = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(expDataAfter.collisionCache).toBeDefined();

    const hash = claimHash(expDataAfter.collisionCache.salt, filename);
    const claimSnap = await db
      .collection("experiments")
      .doc(experimentID)
      .collection("filenameClaims")
      .doc(hash)
      .get();
    expect(claimSnap.exists).toBe(true);
    expect(claimSnap.data().status).toBe("confirmed");

    const logDoc = await db.collection("logs").doc(experimentID).get();
    const errors = logDoc.data()?.errors || [];
    expect(errors.some((entry) => entry.collisionCacheDisagreement === true)).toBe(true);
  });
});

describe("15. provider failure queues the upload and preserves the claim", () => {
  it("500 from OSF results in a 202 queued response with a claimToken, and the claim stays pending", async () => {
    const experimentID = `collision-int15-${randomUUID()}`;
    const filename = `queue-${randomUUID()}.json`;
    await createDataExperiment(experimentID);

    mockOSF.forceStatus(filename, 500);

    const response = await saveData({ experimentID, data: sampleData, filename });

    expect(response.status).toBe(202);
    expect(response.body).toEqual(expect.objectContaining({ ...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage: "" }));

    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    const queueDoc = await db.collection("uploadQueue").doc(docId).get();
    expect(queueDoc.exists).toBe(true);
    expect(typeof queueDoc.data().claimToken).toBe("string");
    expect(queueDoc.data().claimToken.length).toBeGreaterThan(0);

    const expDataAfter = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(expDataAfter.collisionCache).toBeDefined();

    const hash = claimHash(expDataAfter.collisionCache.salt, filename);
    const claimSnap = await db
      .collection("experiments")
      .doc(experimentID)
      .collection("filenameClaims")
      .doc(hash)
      .get();
    expect(claimSnap.exists).toBe(true);
    expect(claimSnap.data().status).toBe("pending");
    expect(claimSnap.data().ownerToken).toBe(queueDoc.data().claimToken);
  });
});

describe("16. apibase64: duplicate filename is rejected without a second provider upload", () => {
  it("first POST succeeds, second POST for the same filename gets OSF_FILE_EXISTS, and OSF received exactly one upload", async () => {
    const experimentID = `collision-int16-${randomUUID()}`;
    const filename = `dup-b64-${randomUUID()}.dat`;
    await createBase64Experiment(experimentID);

    const first = await saveBase64Data({ experimentID, data: sampleBase64, filename });
    expect(first.status).toBe(201);

    const second = await saveBase64Data({ experimentID, data: sampleBase64, filename });
    expect(second.status).toBe(400);
    expect(second.body).toEqual(MESSAGES.OSF_FILE_EXISTS);

    expect(mockOSF.getUploadCount(filename)).toBe(1);
  });
});

describe("17. successful upload stamps the experiment with a warm collision cache", () => {
  it("after a 201, the experiment doc has collisionCache.salt and a warmUntil in the future", async () => {
    const experimentID = `collision-int17-${randomUUID()}`;
    const filename = `stamp-${randomUUID()}.json`;
    await createDataExperiment(experimentID);

    const before = Date.now();
    const response = await saveData({ experimentID, data: sampleData, filename });
    expect(response.status).toBe(201);

    const expDataAfter = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(expDataAfter.collisionCache).toBeDefined();
    expect(typeof expDataAfter.collisionCache.salt).toBe("string");
    expect(expDataAfter.collisionCache.salt.length).toBeGreaterThan(0);
    expect(expDataAfter.collisionCache.warmUntil.toMillis()).toBeGreaterThan(before);
  });
});
