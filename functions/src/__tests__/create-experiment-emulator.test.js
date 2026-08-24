/**
 * @jest-environment node
 */

// RED-phase integration tests for step 7a (scratchpad/step7a-create-endpoint-
// spec.md), cases 5-9 of the test plan.
//
// createExperiment (functions/src/create-experiment.ts) does not exist yet:
// it isn't implemented, isn't exported from index.ts, and has no
// firebase.json rewrite. Every request to its emulator URL therefore 404s
// today -- a missing-behavior failure, not a mock-server/transport bug.
// Following the lowercase function-name convention (apiData -> apidata,
// connectProvider -> connectprovider), the URL under test is
// http://localhost:5001/datapipe-test/us-central1/createexperiment.
//
// Mock Google Drive: createDataContainer's two calls (find-or-create the
// shared "DataPipe" root folder, then always-create the experiment folder)
// are served by a fixed-port (3579) express server, reusing the same
// GDRIVE_API_BASE=http://127.0.0.1:3579 wiring in functions/.env.datapipe-test
// that gdrive-emulator.test.js's mock Drive server already uses -- there is
// only one GDRIVE_API_BASE for the whole Functions-emulator process, so any
// gdrive-touching suite in this test-ci run must bind that same address.
// Because gdrive-emulator.test.js's suite ALSO binds port 3579 and Jest may
// schedule the two test files onto different, truly-concurrent workers, this
// file's listen() retries on EADDRINUSE (with backoff) instead of assuming
// the port is free -- whichever suite starts first grabs it, the other waits
// for that suite's afterAll() to release it. This is defensive, not a claim
// that the two suites are meant to run interleaved: no two tests actually
// hold the port at the same instant.
//
// Auth: real Auth-emulator idTokens via accounts:signUp, exactly like
// oauth-connect-emulator.test.js's signUpEmulatorUser helper -- the future
// createExperiment endpoint is spec'd to verify ownership the same way
// connect-provider.ts's verifyOwnership does (401 missing, 403 mismatch).
//
// connectedAccounts.gdrive is seeded with a bare-plaintext encryptedToken
// (no "v1:" prefix), relying on crypto-utils.ts's decrypt() plaintext
// fallback -- same convention as gdrive-emulator.test.js, sidestepping the
// need for this process and the Functions-emulator child process to agree on
// TOKEN_ENCRYPTION_KEY.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_PORT = 3579;
const FUNCTIONS_BASE = "http://localhost:5001/datapipe-test/us-central1";
const CREATE_EXPERIMENT_URL = `${FUNCTIONS_BASE}/createexperiment`;
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

// Minimal mock Drive: only what createDataContainer needs (a folder lookup by
// name+parent, and a folder create), plus a forceStatus(name, status) hook
// for case 9. No upload/download routes -- this endpoint never touches file
// content.
function createMockDriveServer() {
  const app = express();
  app.use(express.json());

  const filesById = new Map();
  const createCountsByName = new Map();
  const forcedStatus = new Map();
  let nextSeq = 1;

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

    const forced = forcedStatus.get(payload.name);
    if (forced && forced !== 200 && forced !== 201) {
      res.status(forced).json({ errors: [{ reason: "mockForced", message: `mock-forced-status-${forced}` }] });
      return;
    }

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
          getCreateCount: (name) => createCountsByName.get(name) || 0,
          getFolderId: (name) => {
            for (const f of filesById.values()) {
              if (f.name === name) return f.id;
            }
            return null;
          },
          getParents: (name) => {
            for (const f of filesById.values()) {
              if (f.name === name) return f.parents;
            }
            return null;
          },
          forceStatus: (name, status) => forcedStatus.set(name, status),
          reset: () => {
            filesById.clear();
            createCountsByName.clear();
            forcedStatus.clear();
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
    tryListen(60); // up to ~30s, in case gdrive-emulator.test.js's suite holds the port
  });
}

async function signUpEmulatorUser() {
  const email = `create-experiment-${randomUUID()}@example.test`;
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

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

function callCreateExperiment(payload) {
  return postJson(CREATE_EXPERIMENT_URL, payload);
}

async function seedGdriveUser(uid, overrides = {}) {
  await db.collection("users").doc(uid).set({
    connectedAccounts: {
      gdrive: {
        authMethod: "oauth2",
        encryptedToken: "create-experiment-plaintext-token", // plaintext fallback, see header comment
        encryptedRefreshToken: "create-experiment-plaintext-refresh",
        tokenExpiresAt: Date.now() + 60 * 60 * 1000,
        providerAccountId: "create-experiment-acct",
        ...overrides,
      },
    },
  });
}

async function experimentsForOwner(uid) {
  const snap = await db.collection("experiments").where("owner", "==", uid).get();
  return snap.docs;
}

let db;
let mockDrive;

beforeAll(async () => {
  mockDrive = await createMockDriveServer();

  let app;
  try {
    app = getApp("create-experiment-test");
  } catch {
    app = initializeApp(config, "create-experiment-test");
  }
  db = getFirestore(app);
});

afterEach(() => {
  mockDrive.reset();
});

afterAll(() => {
  mockDrive.server.close();
});

describe("5. createExperiment happy path (gdrive)", () => {
  it("returns 200 and creates an experiment doc matching the client's default field set, plus provider fields and no OSF fields", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const title = `Case5 Experiment ${randomUUID()}`;

    const { status, body } = await callCreateExperiment({ provider: "gdrive", title, idToken, uid });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Same id format as lib/experiment-creation.js's customAlphabet(
    // "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 12).
    expect(body.experimentID).toMatch(/^[0-9A-Za-z]{12}$/);

    const folderId = mockDrive.getFolderId(title);
    expect(typeof folderId).toBe("string");
    expect(body.providerContainer).toEqual({ provider: "gdrive", folderId });

    // Mock Drive saw the DataPipe-root find/create and the experiment-folder
    // create with name=title.
    expect(mockDrive.getCreateCount("DataPipe")).toBe(1);
    expect(mockDrive.getCreateCount(title)).toBe(1);

    const expDoc = await db.collection("experiments").doc(body.experimentID).get();
    expect(expDoc.exists).toBe(true);
    const expData = expDoc.data();

    // Exact default-field parity with the retired client-side OSF creation
    // path, so documents written before and after it was removed agree: title,
    // active:false, activeBase64:false, activeConditionAssignment:false,
    // sessions:0, id, owner, nConditions:1, currentCondition:0,
    // useValidation:true, allowJSON:true, allowCSV:true,
    // requiredFields:["trial_type"] (NOT [] -- the client hardcodes
    // ["trial_type"], it was hardcoded there, not a parameterized default),
    // limitSessions:false,
    // maxSessions:1 -- PLUS storageProvider/providerContainer instead of
    // osfRepo/osfComponent/osfFilesLink.
    expect(expData).toEqual({
      title,
      active: false,
      activeBase64: false,
      activeConditionAssignment: false,
      sessions: 0,
      limitSessions: false,
      maxSessions: 1,
      id: body.experimentID,
      owner: uid,
      nConditions: 1,
      currentCondition: 0,
      useValidation: true,
      allowJSON: true,
      allowCSV: true,
      requiredFields: ["trial_type"],
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId },
    });
    expect(expData.osfRepo).toBeUndefined();
    expect(expData.osfComponent).toBeUndefined();
    expect(expData.osfFilesLink).toBeUndefined();

    const userDoc = await db.collection("users").doc(uid).get();
    expect(userDoc.data().experiments).toContain(body.experimentID);
  });
});

describe("6. createExperiment provider validation", () => {
  it("returns 400 for provider 'osf' (OSF creation stays browser-driven)", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const title = `Case6 OSF ${randomUUID()}`;

    const { status } = await callCreateExperiment({ provider: "osf", title, idToken, uid });

    expect(status).toBe(400);
    expect((await experimentsForOwner(uid)).length).toBe(0);
  });

  it("returns 400 for an unknown provider", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const title = `Case6 Unknown ${randomUUID()}`;

    const { status } = await callCreateExperiment({ provider: "not-a-real-provider", title, idToken, uid });

    expect(status).toBe(400);
    expect((await experimentsForOwner(uid)).length).toBe(0);
  });

  // `title` is the name of a real folder/dataset/deposition in the
  // researcher's own account, and DataPipe has no rename path for any
  // provider -- so a container created with a whitespace-only name is stuck
  // with it. The old `!title` guard let " " through (a non-empty string), and
  // so did the client's `providerTitle.length === 0`. Both now trim first.
  it("returns 400 for a whitespace-only title and creates nothing", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);

    const { status } = await callCreateExperiment({ provider: "gdrive", title: "   ", idToken, uid });

    expect(status).toBe(400);
    expect((await experimentsForOwner(uid)).length).toBe(0);
  });

  // The trimmed value is what gets STORED and what is sent to the provider,
  // so DataPipe's title and the Drive folder's name cannot disagree by a
  // stray space the researcher never sees.
  it("stores a padded title trimmed, and names the Drive folder with the same trimmed value", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const title = `Case6 Padded ${randomUUID()}`;

    const { status, body } = await callCreateExperiment({
      provider: "gdrive",
      title: `  ${title}  `,
      idToken,
      uid,
    });

    expect(status).toBe(200);
    const experimentDoc = await db.collection("experiments").doc(body.experimentID).get();
    expect(experimentDoc.data().title).toBe(title);
    expect(mockDrive.getFolderId(title)).toBeTruthy();
  });
});

describe("7. createExperiment with no connected gdrive account", () => {
  it("returns 400 surfacing PROVIDER_NOT_CONNECTED", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    // Deliberately no connectedAccounts.gdrive seeded.
    const title = `Case7 ${randomUUID()}`;

    const { status, body } = await callCreateExperiment({ provider: "gdrive", title, idToken, uid });

    expect(status).toBe(400);
    expect(body).toEqual(expect.objectContaining(MESSAGES.PROVIDER_NOT_CONNECTED));
    expect((await experimentsForOwner(uid)).length).toBe(0);
  });
});

describe("8. createExperiment auth failures", () => {
  it("returns 403 for a wrong-user idToken and creates nothing", async () => {
    const userA = await signUpEmulatorUser();
    const userB = await signUpEmulatorUser();
    await seedGdriveUser(userA.uid);
    const title = `Case8 wrong-user ${randomUUID()}`;

    const { status } = await callCreateExperiment({
      provider: "gdrive",
      title,
      idToken: userB.idToken,
      uid: userA.uid,
    });

    expect(status).toBe(403);
    expect((await experimentsForOwner(userA.uid)).length).toBe(0);
    const userAData = (await db.collection("users").doc(userA.uid).get()).data();
    expect(userAData.experiments || []).toEqual([]);
  });

  it("returns 401 for a missing idToken and creates nothing", async () => {
    const { uid } = await signUpEmulatorUser();
    const title = `Case8 missing-idtoken ${randomUUID()}`;

    const { status } = await callCreateExperiment({ provider: "gdrive", title, uid });

    expect(status).toBe(401);
    expect((await experimentsForOwner(uid)).length).toBe(0);
  });
});

describe("9. createExperiment Drive container-creation failure", () => {
  it("returns 502 when Drive folder creation fails, and creates nothing", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const title = `Case9 ${randomUUID()}`;

    // The DataPipe root-folder create still succeeds; only the
    // experiment-named folder create is forced to fail.
    mockDrive.forceStatus(title, 500);

    const { status, body } = await callCreateExperiment({ provider: "gdrive", title, idToken, uid });

    expect(status).toBe(502);
    expect(body.error).toBe("Failed to create storage container");
    expect((await experimentsForOwner(uid)).length).toBe(0);
    const userData = (await db.collection("users").doc(uid).get()).data();
    expect(userData?.experiments || []).toEqual([]);
  });
});

describe("10. createExperiment with parentFolderId", () => {
  it("creates the experiment folder directly under the given parent, skipping the DataPipe-root lookup entirely", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const title = `Case10 ${randomUUID()}`;
    const parentFolderId = `picker-folder-${randomUUID()}`;

    const { status, body } = await callCreateExperiment({
      provider: "gdrive",
      title,
      idToken,
      uid,
      parentFolderId,
    });

    expect(status).toBe(200);
    const folderId = mockDrive.getFolderId(title);
    expect(typeof folderId).toBe("string");
    expect(body.providerContainer).toEqual({ provider: "gdrive", folderId });
    expect(mockDrive.getParents(title)).toEqual([parentFolderId]);

    // The DataPipe-root find-or-create is skipped entirely when a
    // researcher-chosen parent is supplied.
    expect(mockDrive.getCreateCount("DataPipe")).toBe(0);
  });

  it("still lands under the DataPipe root when parentFolderId is omitted (regression)", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const title = `Case10b ${randomUUID()}`;

    const { status } = await callCreateExperiment({ provider: "gdrive", title, idToken, uid });

    expect(status).toBe(200);
    const dataPipeId = mockDrive.getFolderId("DataPipe");
    expect(typeof dataPipeId).toBe("string");
    expect(mockDrive.getParents(title)).toEqual([dataPipeId]);
    expect(mockDrive.getCreateCount("DataPipe")).toBe(1);
  });
});

describe("11. createExperiment generic containerInput validation (dataverse)", () => {
  it("returns 400 naming every missing required field for a dataverse experiment, and creates no experiment doc", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    // Deliberately no connectedAccounts.dataverse seeded, and no
    // researcherInput sent -- dataverse's containerInput declares
    // collectionAlias/authorName/contactEmail/description as required (see
    // providers/dataverse.ts), none of which are present here.
    const title = `Case11 missing-fields ${randomUUID()}`;

    const { status, body } = await callCreateExperiment({ provider: "dataverse", title, idToken, uid });

    expect(status).toBe(400);
    expect(body.error).toContain("collectionAlias");
    expect(body.error).toContain("authorName");
    expect(body.error).toContain("contactEmail");
    expect(body.error).toContain("description");
    // subject is optional -- must NOT be named as missing.
    expect(body.error).not.toContain("subject");
    expect((await experimentsForOwner(uid)).length).toBe(0);
  });

  it("returns 400 before token resolution: the user has no dataverse connection at all, yet the error names missing fields rather than PROVIDER_NOT_CONNECTED", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    // No connectedAccounts.dataverse seeded at all -- if the endpoint
    // resolved a token before validating containerInput, this would surface
    // MESSAGES.PROVIDER_NOT_CONNECTED instead. Getting the missing-fields
    // message proves validation runs first and never reaches resolveToken
    // (and therefore never reaches any provider HTTP call either).
    const title = `Case11 no-connection ${randomUUID()}`;

    const { status, body } = await callCreateExperiment({ provider: "dataverse", title, idToken, uid });

    expect(status).toBe(400);
    expect(body).not.toEqual(expect.objectContaining(MESSAGES.PROVIDER_NOT_CONNECTED));
    expect(body.error).toContain("Missing required fields for dataverse");
    expect((await experimentsForOwner(uid)).length).toBe(0);
  });

  it("succeeds when researcherInput supplies every required dataverse field (regression guard on the happy path, no mock Dataverse server needed since this asserts only the validation gate is passable)", async () => {
    // This suite has no mock Dataverse HTTP server (createDataContainer would
    // need to reach a real/mocked installation), so this case only proves
    // the 400 goes away once every required field is supplied -- pairing
    // with the two tests above it confirms the gate is neither too strict
    // nor a no-op. It's expected to fail past validation (no dataverse
    // account connected, so resolveToken -> PROVIDER_NOT_CONNECTED), which
    // itself confirms containerInput validation let the request through.
    const { uid, idToken } = await signUpEmulatorUser();
    const title = `Case11 complete-fields ${randomUUID()}`;

    const { status, body } = await callCreateExperiment({
      provider: "dataverse",
      title,
      idToken,
      uid,
      researcherInput: {
        collectionAlias: "my-lab",
        authorName: "Lastname, Firstname",
        contactEmail: "you@example.edu",
        description: "A test dataset",
      },
    });

    expect(status).toBe(400);
    expect(body).toEqual(expect.objectContaining(MESSAGES.PROVIDER_NOT_CONNECTED));
    expect((await experimentsForOwner(uid)).length).toBe(0);
  });
});

describe("12. createExperiment gdrive with only a title (regression: gdrive's single containerInput field is optional)", () => {
  it("succeeds with no parentFolderId and no researcherInput at all", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedGdriveUser(uid);
    const title = `Case12 ${randomUUID()}`;

    const { status, body } = await callCreateExperiment({ provider: "gdrive", title, idToken, uid });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const folderId = mockDrive.getFolderId(title);
    expect(typeof folderId).toBe("string");
    expect(body.providerContainer).toEqual({ provider: "gdrive", folderId });
  });
});
