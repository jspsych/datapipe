/**
 * @jest-environment node
 */

// RED-phase integration tests for step 4a (docs/provider-migration-design.md,
// scratchpad/step4a-gdrive-adapter-spec.md), cases 12-16 of the test plan.
//
// These exercise the deployed-in-emulator apidata function end to end
// against a mock Google Drive server, following the fixed-port convention
// documented in the spec: a self-contained express server bound to
// 127.0.0.1:3579 (not an OS-assigned port), because functions/.env.datapipe-
// test (created alongside this file -- see the build-step instructions) sets
// GDRIVE_API_BASE=http://127.0.0.1:3579 for the *functions emulator process*
// to read. Verified empirically: starting `firebase emulators:exec --project
// datapipe-test` logs "functions: Loaded environment variables from .env,
// .env.datapipe-test." -- confirming firebase-tools' documented
// .env.<projectId> loading (functions/node_modules/firebase-tools/lib/
// functions/env.js's findEnvfiles: [".env", `.env.${projectId}`, ...]) picks
// this file up with no further plumbing needed. This is a genuinely fixed
// port (unlike collision-integration-emulator.test.js's listen(0) pattern)
// because the emulator-hosted gdrive adapter has no other way to discover
// where the mock server lives.
//
// None of cases 12-16 exercise real token encryption: the seeded
// connectedAccounts.gdrive.encryptedToken values below are bare plaintext
// strings, relying on crypto-utils.ts's decrypt() plaintext fallback (no
// "v1:" prefix -> returned unchanged) -- exactly like the existing OSF
// emulator tests seed osfToken: "valid". This sidesteps needing the jest
// process and the functions-emulator child process to agree on
// TOKEN_ENCRYPTION_KEY (they're different processes; only the latter loads
// functions/.env). The real encrypt/decrypt round-trip through a refresh is
// covered directly, in-process, by resolve-token-gdrive.test.js's case 9.
//
// Until gdrive.ts exists, is registered in providers/index.ts, and
// resolve-token.ts dispatches on storageProvider === "gdrive", every gdrive
// experiment request in cases 12-15 fails long before it reaches the mock
// server: getProviderForExperiment throws "Unknown storage provider:
// gdrive" (registry.ts already throws that for any unregistered id), so
// apidata's response is never the expected 201/202 -- a missing-behavior
// failure, not a mock-server/transport bug. Case 15 additionally depends on
// queue-upload.ts/api-data.ts passing storageProvider/providerContainer
// through to the queue doc (the "Queue generalization" section of the spec),
// which also doesn't exist yet.
//
// Case 16 is a regression guard: a legacy (storageProvider-less) OSF
// experiment, using the same OS-assigned-port inline-mock-OSF-server pattern
// as collision-integration-emulator.test.js. It is expected to PASS today --
// the gdrive generalization must not be able to break it.

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
const GDRIVE_OWNER_ID = "gdrive-emulator-owner";
const OSF_OWNER_ID = "gdrive-emulator-osf-owner";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_PORT = 3579;

const sampleData = `[{"trial_type":"html-keyboard-response","trial_index":1,"time_elapsed":776}]`;

async function saveData(body) {
  const response = await fetch("http://localhost:5001/datapipe-test/us-central1/apidata", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body),
  });
  // An uncaught exception in the function (e.g. today's "Unknown storage
  // provider: gdrive") produces a plain-text "Internal Server Error" body,
  // not JSON. Parsing defensively keeps assertions on `status` failing
  // cleanly (e.g. "Expected 201, Received 500") instead of the test itself
  // throwing a SyntaxError out of response.json() -- that would obscure a
  // real missing-behavior red as an apparent test-harness bug.
  const text = await response.text();
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    message = { rawBody: text };
  }
  return { status: response.status, body: message };
}

// Parses a Drive `q` filter string just far enough to support the shapes
// this adapter is spec'd to send: a parent clause ('<id>' in parents), an
// exact-name clause (name='...'), and an optional folder-mimeType clause.
function parseQuery(q) {
  const nameMatch = /name\s*=\s*'([^']*)'/.exec(q || "");
  const parentMatch = /'([^']*)'\s+in\s+parents/.exec(q || "");
  const folderOnly = /mimeType\s*=\s*'application\/vnd\.google-apps\.folder'/.test(q || "");
  return {
    name: nameMatch ? nameMatch[1] : null,
    parent: parentMatch ? parentMatch[1] : null,
    folderOnly,
  };
}

// "regex or simple string split on the boundary is fine" per the spec --
// this splits on the boundary and picks out whichever part declares itself
// application/json as the metadata part.
function parseMultipartMetadata(bodyBuffer, contentTypeHeader) {
  const boundaryMatch = /boundary=("?)([^;"]+)\1/.exec(contentTypeHeader || "");
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[2];
  const parts = bodyBuffer.toString("utf8").split(`--${boundary}`);
  for (const rawPart of parts) {
    const part = rawPart.replace(/^\r\n/, "");
    if (!part || part.startsWith("--")) continue;
    if (!/Content-Type:\s*application\/json/i.test(part)) continue;
    const sep = part.indexOf("\r\n\r\n");
    if (sep === -1) continue;
    try {
      return JSON.parse(part.slice(sep + 4).trim());
    } catch {
      return null;
    }
  }
  return null;
}

// Companion to parseMultipartMetadata: extracts the *other* part (the
// payload being uploaded), so the mock can actually store it and serve it
// back via alt=media.
function parseMultipartDataPart(bodyBuffer, contentTypeHeader) {
  const boundaryMatch = /boundary=("?)([^;"]+)\1/.exec(contentTypeHeader || "");
  if (!boundaryMatch) return { content: "", contentType: "application/octet-stream" };
  const boundary = boundaryMatch[2];
  const parts = bodyBuffer.toString("utf8").split(`--${boundary}`);
  for (const rawPart of parts) {
    const part = rawPart.replace(/^\r\n/, "");
    if (!part || part.startsWith("--")) continue;
    if (/Content-Type:\s*application\/json/i.test(part)) continue; // that's the metadata part
    const sep = part.indexOf("\r\n\r\n");
    if (sep === -1) continue;
    const headerBlock = part.slice(0, sep);
    const content = part.slice(sep + 4).replace(/\r\n$/, "");
    const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerBlock);
    return { content, contentType: ctMatch ? ctMatch[1].trim() : "application/octet-stream" };
  }
  return { content: "", contentType: "application/octet-stream" };
}

// A self-contained mock Google Drive: a fixed-id filesById store, plus the
// counters/controls the build-step spec calls for (per-name upload
// counters, forceStatus(name-or-id, status), reset()).
function createMockDriveServer() {
  const app = express();
  // A single raw-body parser regardless of Content-Type -- multipart/related
  // and the media-PATCH's raw bytes both need the untouched body; JSON
  // routes parse it themselves.
  app.use(express.raw({ type: () => true, limit: "20mb" }));

  const filesById = new Map();
  const uploadCountsByName = new Map();
  const updateCountsById = new Map();
  const forcedStatus = new Map();
  let nextSeq = 1;

  function forcedFor(key) {
    const status = forcedStatus.get(key);
    return status && status !== 200 && status !== 201 ? status : null;
  }

  app.get("/drive/v3/files", (req, res) => {
    const { name, parent, folderOnly } = parseQuery(req.query.q);
    let matches = Array.from(filesById.values()).filter((f) => {
      if (parent && !f.parents.includes(parent)) return false;
      if (name && f.name !== name) return false;
      if (folderOnly && f.mimeType !== FOLDER_MIME) return false;
      return true;
    });
    matches.sort((a, b) => a.__seq - b.__seq);

    const pageSize = parseInt(req.query.pageSize, 10) || matches.length || 1;
    const offset = req.query.pageToken ? parseInt(req.query.pageToken, 10) : 0;
    const page = matches.slice(offset, offset + pageSize);
    const nextPageToken = offset + pageSize < matches.length ? String(offset + pageSize) : undefined;

    const body = { files: page.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType })) };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    res.status(200).json(body);
  });

  app.post("/drive/v3/files", (req, res) => {
    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      res.status(400).json({ errors: [{ reason: "badRequest", message: "invalid JSON body" }] });
      return;
    }
    const forced = forcedFor(payload.name);
    if (forced) {
      res.status(forced).json({ errors: [{ reason: "mockForced", message: `mock-forced-status-${forced}` }] });
      return;
    }
    const id = `mock-folder-${nextSeq}`;
    filesById.set(id, {
      id,
      name: payload.name,
      mimeType: payload.mimeType,
      parents: payload.parents || [],
      content: "",
      contentType: payload.mimeType,
      __seq: nextSeq++,
    });
    res.status(200).json({ id, name: payload.name });
  });

  app.post("/upload/drive/v3/files", (req, res) => {
    if (req.query.uploadType !== "multipart") {
      res.status(400).json({ errors: [{ reason: "badRequest", message: "unsupported uploadType" }] });
      return;
    }
    const contentTypeHeader = req.headers["content-type"];
    const metadata = parseMultipartMetadata(req.body, contentTypeHeader);
    if (!metadata || !metadata.name) {
      res.status(400).json({ errors: [{ reason: "badRequest", message: "could not parse multipart metadata" }] });
      return;
    }
    uploadCountsByName.set(metadata.name, (uploadCountsByName.get(metadata.name) || 0) + 1);

    const forced = forcedFor(metadata.name);
    if (forced) {
      res.status(forced).json({ errors: [{ reason: "mockForced", message: `mock-forced-status-${forced}` }] });
      return;
    }

    const { content, contentType } = parseMultipartDataPart(req.body, contentTypeHeader);
    const id = `mock-file-${nextSeq}`;
    filesById.set(id, {
      id,
      name: metadata.name,
      mimeType: contentType,
      parents: metadata.parents || [],
      content,
      contentType,
      __seq: nextSeq++,
    });
    res.status(200).json({ id, name: metadata.name });
  });

  app.patch("/upload/drive/v3/files/:id", (req, res) => {
    if (req.query.uploadType !== "media") {
      res.status(400).json({ errors: [{ reason: "badRequest", message: "unsupported uploadType" }] });
      return;
    }
    const id = req.params.id;
    updateCountsById.set(id, (updateCountsById.get(id) || 0) + 1);

    const forced = forcedFor(id);
    if (forced) {
      res.status(forced).json({ errors: [{ reason: "mockForced", message: `mock-forced-status-${forced}` }] });
      return;
    }

    const contentType = req.headers["content-type"] || "application/octet-stream";
    const content = req.body.toString("utf8");
    const existing = filesById.get(id);
    if (existing) {
      existing.content = content;
      existing.contentType = contentType;
    } else {
      filesById.set(id, { id, name: id, mimeType: contentType, parents: [], content, contentType, __seq: nextSeq++ });
    }
    res.status(200).json({ id });
  });

  app.get("/drive/v3/files/:id", (req, res) => {
    if (req.query.alt !== "media") {
      res.status(400).json({ errors: [{ reason: "badRequest", message: "unsupported alt" }] });
      return;
    }
    const id = req.params.id;
    const forced = forcedFor(id);
    if (forced) {
      res.status(forced).json({ errors: [{ reason: "mockForced", message: `mock-forced-status-${forced}` }] });
      return;
    }
    const file = filesById.get(id);
    if (!file) {
      res.status(404).json({ errors: [{ reason: "notFound", message: "no such file" }] });
      return;
    }
    res.status(200).type(file.contentType || "text/plain").send(file.content);
  });

  // "For completeness" per the spec -- not exercised by cases 12-16 (every
  // seeded gdrive token is unexpired), but GDRIVE_TOKEN_URL points here.
  app.post("/token", (req, res) => {
    res.status(200).json({ access_token: "mock-refreshed-token", expires_in: 3600, token_type: "Bearer" });
  });

  return new Promise((resolve) => {
    const server = app.listen(DRIVE_PORT, () => {
      resolve({
        server,
        port: DRIVE_PORT,
        getUploadCount: (name) => uploadCountsByName.get(name) || 0,
        getUpdateCount: (id) => updateCountsById.get(id) || 0,
        forceStatus: (nameOrId, status) => forcedStatus.set(nameOrId, status),
        reset: () => {
          filesById.clear();
          uploadCountsByName.clear();
          updateCountsById.clear();
          forcedStatus.clear();
          nextSeq = 1;
        },
      });
    });
  });
}

// Minimal inline mock OSF server for case 16's regression guard, matching
// the OS-assigned-port pattern established by
// collision-integration-emulator.test.js (listen(0), in-process counters).
function createMockOSFServer() {
  const app = express();
  const uploadCountsByFilename = new Map();

  app.get("/files", (req, res) => {
    res.json({ data: [] });
  });

  app.put("/files", (req, res) => {
    const filename = String(req.query.name || "");
    uploadCountsByFilename.set(filename, (uploadCountsByFilename.get(filename) || 0) + 1);
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
        reset: () => uploadCountsByFilename.clear(),
      });
    });
  });
}

let db;
let mockDrive;

beforeAll(async () => {
  mockDrive = await createMockDriveServer();

  initializeApp(config);
  db = getFirestore();

  await db.collection("users").doc(GDRIVE_OWNER_ID).set({
    connectedAccounts: {
      gdrive: {
        authMethod: "oauth2",
        encryptedToken: "gdrive-integration-token", // plaintext fallback, see header comment
        encryptedRefreshToken: "gdrive-integration-refresh",
        tokenExpiresAt: Date.now() + 60 * 60 * 1000,
        providerAccountId: "gdrive-integration-acct",
      },
    },
  });
});

afterEach(() => {
  mockDrive.reset();
});

afterAll(() => {
  mockDrive.server.close();
});

async function createGdriveExperiment(experimentID, folderId, overrides = {}) {
  await db
    .collection("experiments")
    .doc(experimentID)
    .set({
      active: true,
      metadataActive: false,
      owner: GDRIVE_OWNER_ID,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId },
      ...overrides,
    });
}

describe("12. gdrive experiment: apidata POST succeeds and warms the collision cache", () => {
  it("returns 201, records the upload in the mock, and leaves the experiment's collisionCache warm", async () => {
    const experimentID = `gdrive-int12-${randomUUID()}`;
    const folderId = `folder-${randomUUID()}`;
    const filename = `case12-${randomUUID()}.json`;
    await createGdriveExperiment(experimentID, folderId);

    const before = Date.now();
    const response = await saveData({ experimentID, data: sampleData, filename });

    expect(response.status).toBe(201);
    expect(mockDrive.getUploadCount(filename)).toBe(1);

    const expDataAfter = (await db.collection("experiments").doc(experimentID).get()).data();
    expect(expDataAfter.collisionCache).toBeDefined();
    expect(typeof expDataAfter.collisionCache.salt).toBe("string");
    expect(expDataAfter.collisionCache.warmUntil.toMillis()).toBeGreaterThan(before);
  });
});

describe("13. gdrive experiment: duplicate filename is rejected without a second provider upload", () => {
  it("first POST succeeds, second POST for the same filename gets OSF_FILE_EXISTS, and the mock received exactly one upload", async () => {
    const experimentID = `gdrive-int13-${randomUUID()}`;
    const folderId = `folder-${randomUUID()}`;
    const filename = `dup-${randomUUID()}.json`;
    await createGdriveExperiment(experimentID, folderId);

    const first = await saveData({ experimentID, data: sampleData, filename });
    expect(first.status).toBe(201);

    const second = await saveData({ experimentID, data: sampleData, filename });
    expect(second.status).toBe(400);
    // Message key is a historical "OSF_FILE_EXISTS" name (unchanged: the
    // collision-cache duplicate check is entirely provider-agnostic in
    // api-data.ts), not a claim that gdrive itself returned an OSF error.
    expect(second.body).toEqual({ ...MESSAGES.OSF_FILE_EXISTS, metadataMessage: "" });

    expect(mockDrive.getUploadCount(filename)).toBe(1);
  });
});

describe("14. metadata on gdrive", () => {
  it("first submission creates dataset_description.json via multipart and stores the ref; second submission media-PATCHes that ref'd id with no second create", async () => {
    const experimentID = `gdrive-int14-${randomUUID()}`;
    const folderId = `folder-${randomUUID()}`;
    await createGdriveExperiment(experimentID, folderId, { metadataActive: true });

    const first = await saveData({
      experimentID,
      data: sampleData,
      filename: `case14-a-${randomUUID()}.json`,
    });
    expect(first.status).toBe(201);
    expect(mockDrive.getUploadCount("dataset_description.json")).toBe(1);

    const metadataDocAfterFirst = (await db.collection("metadata").doc(experimentID).get()).data();
    expect(metadataDocAfterFirst.metadataFileRef).toBeDefined();
    expect(metadataDocAfterFirst.metadataFileRef).not.toBeNull();
    const refId = metadataDocAfterFirst.metadataFileRef.id;
    expect(typeof refId).toBe("string");
    expect(refId.length).toBeGreaterThan(0);

    const second = await saveData({
      experimentID,
      data: sampleData,
      filename: `case14-b-${randomUUID()}.json`,
    });
    expect(second.status).toBe(201);

    expect(mockDrive.getUploadCount("dataset_description.json")).toBe(1); // still just the one create
    expect(mockDrive.getUpdateCount(refId)).toBe(1); // the media PATCH from the second submission
  });
});

describe("15. provider failure queues the upload and tags it with the gdrive container", () => {
  it("a mock-forced 500 on upload results in a 202 queued response, with the queue doc carrying claimToken + storageProvider + providerContainer", async () => {
    const experimentID = `gdrive-int15-${randomUUID()}`;
    const folderId = `folder-${randomUUID()}`;
    const filename = `case15-${randomUUID()}.json`;
    await createGdriveExperiment(experimentID, folderId);

    mockDrive.forceStatus(filename, 500);

    const response = await saveData({ experimentID, data: sampleData, filename });

    expect(response.status).toBe(202);
    expect(response.body).toEqual(expect.objectContaining({ ...MESSAGES.OSF_UPLOAD_QUEUED, metadataMessage: "" }));

    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    const queueDoc = await db.collection("uploadQueue").doc(docId).get();
    expect(queueDoc.exists).toBe(true);

    const queueData = queueDoc.data();
    expect(typeof queueData.claimToken).toBe("string");
    expect(queueData.claimToken.length).toBeGreaterThan(0);
    expect(queueData.storageProvider).toBe("gdrive");
    expect(queueData.providerContainer).toEqual({ provider: "gdrive", folderId });
  });
});

describe("16. OSF experiment in the same run still works (legacy dispatch untouched, regression guard)", () => {
  let mockOSF;

  beforeAll(async () => {
    mockOSF = await createMockOSFServer();
    await db.collection("users").doc(OSF_OWNER_ID).set({
      osfTokenValid: true,
      osfToken: "valid",
      usingPersonalToken: true,
    });
  });

  afterEach(() => {
    mockOSF.reset();
  });

  afterAll(() => {
    mockOSF.server.close();
  });

  it("apidata POST for a legacy (storageProvider-less) OSF experiment succeeds normally -- expected to PASS today", async () => {
    const experimentID = `gdrive-int16-${randomUUID()}`;
    const filename = `case16-${randomUUID()}.json`;
    const filesLink = `http://localhost:${mockOSF.port}/files/`;

    await db.collection("experiments").doc(experimentID).set({
      active: true,
      metadataActive: false,
      owner: OSF_OWNER_ID,
      osfFilesLink: filesLink,
      // storageProvider deliberately absent -- legacy dispatch.
    });

    const response = await saveData({ experimentID, data: sampleData, filename });

    expect(response.status).toBe(201);
    expect(mockOSF.getUploadCount(filename)).toBe(1);
  });
});
