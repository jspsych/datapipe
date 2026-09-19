/**
 * @jest-environment node
 */

// End-to-end coverage for ensureDerivedPaths (functions/src/ensure-
// derived-paths.ts, POST /api/ensurederivedpaths) -- the endpoint
// MetadataControl.js calls right after a successful metadataActive ON write,
// to pre-create gdrive's Psych-DS data/raw chain at the one moment
// firestore.rules guarantees is race-free (no data collected yet). See
// gdrive.ts's ensureDerivedPaths for the race this removes (spike gate H,
// 2026-08-21) and providers/types.ts's StorageProvider.ensureDerivedPaths
// for why it moved here from createDataContainer.
//
// Auth/ownership shape mirrors api-finalize-emulator.test.js: real
// Auth-emulator idTokens via accounts:signUp, same 403-for-both convention
// for a missing/foreign experiment.
//
// Mock Google Drive: reuses the same fixed-port (3579) express server
// convention as create-experiment-emulator.test.js and gdrive-emulator.test.js
// -- there is only one GDRIVE_API_BASE for the whole Functions-emulator
// process, so this file's listen() retries on EADDRINUSE (with backoff)
// rather than assuming the port is free, since Jest may schedule this file
// onto a different worker than those other gdrive-touching suites.
//
// connectedAccounts.gdrive is seeded with a bare-plaintext encryptedToken (no
// "v1:" prefix), relying on crypto-utils.ts's decrypt() plaintext fallback --
// same convention as gdrive-emulator.test.js and create-experiment-
// emulator.test.js, sidestepping the need for this process and the
// Functions-emulator child process to agree on TOKEN_ENCRYPTION_KEY.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_PORT = 3579;
const FUNCTIONS_BASE = "http://localhost:5001/datapipe-test/us-central1";
const ENSURE_DERIVED_PATHS_URL = `${FUNCTIONS_BASE}/ensurederivedpaths`;
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

// ---- helpers ----

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

// Minimal mock Drive: only what ensureDerivedPaths needs (a folder lookup by
// name+parent, and a folder create) -- same shape as create-experiment-
// emulator.test.js's mock, seeded here with a pre-existing experiment folder
// rather than creating one through createDataContainer.
function createMockDriveServer() {
  const app = express();
  app.use(express.json());

  const filesById = new Map();
  const createCountsByName = new Map();
  let nextSeq = 1;

  function seedFolder(id, name, parents) {
    filesById.set(id, { id, name, mimeType: FOLDER_MIME, parents, __seq: nextSeq++ });
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
    res.status(200).json({ files: matches.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType })) });
  });

  app.post("/drive/v3/files", (req, res) => {
    const payload = req.body || {};
    createCountsByName.set(payload.name, (createCountsByName.get(payload.name) || 0) + 1);
    const id = `mock-folder-${nextSeq++}`;
    filesById.set(id, { id, name: payload.name, mimeType: payload.mimeType, parents: payload.parents || [], __seq: nextSeq });
    res.status(200).json({ id, name: payload.name });
  });

  return new Promise((resolve, reject) => {
    const tryListen = (retriesLeft) => {
      const server = app.listen(DRIVE_PORT);
      server.once("listening", () => {
        resolve({
          server,
          seedFolder,
          getCreateCount: (name) => createCountsByName.get(name) || 0,
          findChild: (parentId, name) => {
            for (const f of filesById.values()) {
              if (f.name === name && f.parents.includes(parentId)) return f;
            }
            return null;
          },
          reset: () => {
            filesById.clear();
            createCountsByName.clear();
            nextSeq = 1;
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
    tryListen(60); // up to ~30s, in case another gdrive-touching suite holds the port
  });
}

async function signUpEmulatorUser() {
  const email = `ensure-derived-paths-${randomUUID()}@example.test`;
  const res = await fetch(AUTH_EMULATOR_SIGNUP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!", returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Auth emulator signUp failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return { uid: body.localId, idToken: body.idToken };
}

async function callEndpoint(experimentID, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken !== undefined) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  const res = await fetch(ENSURE_DERIVED_PATHS_URL, {
    method: "POST",
    headers,
    body: experimentID === undefined ? JSON.stringify({}) : JSON.stringify({ experimentID }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { rawBody: text };
  }
  return { status: res.status, body };
}

async function seedGdriveUser(uid) {
  await db.collection("users").doc(uid).set({
    connectedAccounts: {
      gdrive: {
        authMethod: "oauth2",
        encryptedToken: "ensure-derived-paths-plaintext-token", // plaintext fallback, see header comment
        encryptedRefreshToken: "ensure-derived-paths-plaintext-refresh",
        tokenExpiresAt: Date.now() + 60 * 60 * 1000,
        providerAccountId: "ensure-derived-paths-acct",
      },
    },
  });
}

let db;
let mockDrive;

beforeAll(async () => {
  mockDrive = await createMockDriveServer();

  let app;
  try {
    app = getApp("ensure-derived-paths-test");
  } catch {
    app = initializeApp(config, "ensure-derived-paths-test");
  }
  db = getFirestore(app);
});

afterEach(() => {
  mockDrive.reset();
});

afterAll(() => {
  mockDrive.server.close();
});

describe("ensureDerivedPaths — auth and request shape", () => {
  it("returns 401 when there is no Authorization header", async () => {
    const { status } = await callEndpoint("whatever", undefined);
    expect(status).toBe(401);
  });

  it("returns 401 for a garbage bearer token", async () => {
    const { status } = await callEndpoint("whatever", "not-a-real-token");
    expect(status).toBe(401);
  });

  it("returns 400 when experimentID is missing from the body", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status } = await callEndpoint(undefined, idToken);
    expect(status).toBe(400);
  });

  it("returns 403 for an experiment that does not exist", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status } = await callEndpoint(`no-such-experiment-${randomUUID()}`, idToken);
    expect(status).toBe(403);
  });

  it("returns 403 when the caller does not own the experiment (never confirms it exists)", async () => {
    const owner = await signUpEmulatorUser();
    const intruder = await signUpEmulatorUser();
    const experimentID = `ensure-derived-paths-owned-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      owner: owner.uid,
      sessions: 0,
      metadataActive: true,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId: "irrelevant-folder" },
    });

    const { status } = await callEndpoint(experimentID, intruder.idToken);
    expect(status).toBe(403);
    // And Drive was never touched on the intruder's behalf.
    expect(mockDrive.getCreateCount("data")).toBe(0);
  });
});

describe("ensureDerivedPaths — no-op guards (never usable mid-collection or with metadata off)", () => {
  it("no-ops with 200 when metadataActive is not true", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const experimentID = `ensure-derived-paths-off-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      owner: uid,
      sessions: 0,
      metadataActive: false,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId: "folder-off" },
    });

    const { status } = await callEndpoint(experimentID, idToken);
    expect(status).toBe(200);
    expect(mockDrive.getCreateCount("data")).toBe(0);
  });

  it("no-ops with 200 when metadataActive is absent entirely (the create-experiment default)", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const experimentID = `ensure-derived-paths-unset-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      owner: uid,
      sessions: 0,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId: "folder-unset" },
    });

    const { status } = await callEndpoint(experimentID, idToken);
    expect(status).toBe(200);
    expect(mockDrive.getCreateCount("data")).toBe(0);
  });

  it("no-ops with 200 when the experiment already has sessions (mid-collection)", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const experimentID = `ensure-derived-paths-sessions-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      owner: uid,
      sessions: 3,
      metadataActive: true,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId: "folder-sessions" },
    });

    const { status } = await callEndpoint(experimentID, idToken);
    expect(status).toBe(200);
    expect(mockDrive.getCreateCount("data")).toBe(0);
  });

  it("no-ops with 200 when the experiment already has a collisionCache (the tamper-resistant signal)", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const experimentID = `ensure-derived-paths-cache-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      owner: uid,
      sessions: 0,
      metadataActive: true,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId: "folder-cache" },
      collisionCache: { salt: "ensure-derived-paths-test-salt" },
    });

    const { status } = await callEndpoint(experimentID, idToken);
    expect(status).toBe(200);
    expect(mockDrive.getCreateCount("data")).toBe(0);
  });
});

describe("ensureDerivedPaths — providers without the hook", () => {
  it("returns 200 without doing anything for a legacy (storageProvider-less, OSF) experiment", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = `ensure-derived-paths-osf-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      owner: uid,
      sessions: 0,
      metadataActive: true,
      osfRepo: "abc12",
      osfComponent: "def34",
      osfFilesLink: "https://files.osf.io/v1/resources/abc12/providers/osfstorage/",
    });

    // No osfToken seeded at all -- if this endpoint reached resolveToken for
    // osf, it would fail on token resolution rather than reaching a clean
    // 200. Getting 200 proves the "no ensureDerivedPaths hook" check runs
    // BEFORE any token resolution, exactly as the module header requires.
    const { status } = await callEndpoint(experimentID, idToken);
    expect(status).toBe(200);
  });
});

describe("ensureDerivedPaths — gdrive happy path", () => {
  it("pre-creates the data/raw chain under the experiment's existing folder", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const folderId = `exp-folder-${randomUUID()}`;
    mockDrive.seedFolder(folderId, "My Experiment", ["root-folder"]);
    const experimentID = `ensure-derived-paths-happy-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      owner: uid,
      sessions: 0,
      metadataActive: true,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId },
    });

    const { status } = await callEndpoint(experimentID, idToken);
    expect(status).toBe(200);

    const dataFolder = mockDrive.findChild(folderId, "data");
    expect(dataFolder).toBeTruthy();
    const rawFolder = mockDrive.findChild(dataFolder.id, "raw");
    expect(rawFolder).toBeTruthy();
  });

  it("is idempotent: calling it twice does not create a second data or raw folder", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const folderId = `exp-folder-${randomUUID()}`;
    mockDrive.seedFolder(folderId, "My Experiment 2", ["root-folder"]);
    const experimentID = `ensure-derived-paths-idempotent-${randomUUID()}`;
    await db.collection("experiments").doc(experimentID).set({
      owner: uid,
      sessions: 0,
      metadataActive: true,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId },
    });

    const first = await callEndpoint(experimentID, idToken);
    expect(first.status).toBe(200);
    const second = await callEndpoint(experimentID, idToken);
    expect(second.status).toBe(200);

    expect(mockDrive.getCreateCount("data")).toBe(1);
    expect(mockDrive.getCreateCount("raw")).toBe(1);
  });
});
