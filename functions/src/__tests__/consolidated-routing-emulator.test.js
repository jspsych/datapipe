/**
 * @jest-environment node
 *
 * Step 1 of the participant-api consolidation (functions/src/participant-api.ts,
 * and api-data.ts's "/api/base64" dispatch): this suite proves the NEW entry
 * points work, side by side with the OLD standalone functions -- which stay
 * deployed and are exercised by their own existing suites (staging-emulator,
 * get-condition-emulator, base64data-emulator, data-emulator). Neither set of
 * tests is rewritten here; see the PR description for why that split is
 * deliberate for this commit.
 *
 * Covers:
 *   - fnUrl("/api/base64") (apidata's own "/api/base64" route) accepts a
 *     valid upload and rejects an invalid one exactly like apibase64 does.
 *   - apidata at its bare URL and at apidata/api/data both behave as the data
 *     endpoint -- the dispatcher's default branch, which direct invocations
 *     (this suite, and any caller using the raw function URL) depend on.
 *   - fnUrl("/api/session") and fnUrl("/api/condition") (participantapi)
 *     match the old apisessionstart / apicondition functions for one success
 *     and one failure case each.
 *   - An unknown path on participantapi 404s the same way dashboardapi's
 *     dispatcher does.
 *
 * Style follows base64data-emulator.test.js (the mock OSF server) and
 * staging-emulator.test.js / get-condition-emulator.test.js (fixture shape).
 * Every experiment/user fixture below gets a random suffix -- this suite runs
 * in the same emulator alongside every other suite named here, and none of
 * them may share a document.
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";
import MESSAGES from "../api-messages";
import { fnUrl } from "./helpers/fn-url.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
// Needed by the base64 success path: persistPending() writes the pending
// copy to Cloud Storage before the provider write, same as
// base64data-emulator.test.js / data-emulator.test.js.
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";

jest.setTimeout(30000);

const FUNCTIONS_BASE = "http://localhost:5001/datapipe-test/us-central1";
const OLD_APIBASE64_URL = `${FUNCTIONS_BASE}/apibase64`;
const OLD_APISESSIONSTART_URL = `${FUNCTIONS_BASE}/apisessionstart`;
const OLD_APICONDITION_URL = `${FUNCTIONS_BASE}/apicondition`;
const APIDATA_BARE_URL = `${FUNCTIONS_BASE}/apidata`;
const APIDATA_API_DATA_URL = `${FUNCTIONS_BASE}/apidata/api/data`;
const PARTICIPANTAPI_BASE = `${FUNCTIONS_BASE}/participantapi`;

const NEW_APIBASE64_URL = fnUrl("/api/base64");
const NEW_APISESSIONSTART_URL = fnUrl("/api/session");
const NEW_APICONDITION_URL = fnUrl("/api/condition");

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json();
  return { status: response.status, body: parsed };
}

// A minimal mock OSF "files" container, following the inline-server pattern
// in base64data-emulator.test.js (an OS-assigned port via listen(0)).
function createMockOSFServer() {
  const app = express();
  const receivedBytesByFilename = new Map();

  app.get("/files", (req, res) => {
    res.json({ data: [] });
  });

  app.put(
    "/files",
    express.raw({ type: "application/json", limit: "50mb" }),
    (req, res) => {
      const filename = String(req.query.name || "");
      receivedBytesByFilename.set(filename, Buffer.from(req.body));
      res.status(201).json({
        data: { attributes: { name: filename, kind: "file" }, id: "osfstorage/mock-upload" },
      });
    }
  );

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        server,
        port: server.address().port,
        getReceivedBytes: (filename) => receivedBytesByFilename.get(filename),
      });
    });
  });
}

const config = {
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
};

let db;
let mockOSF;
const createdExperimentIds = [];
const fixtures = {};

beforeAll(async () => {
  mockOSF = await createMockOSFServer();
  const app = initializeApp(config, "consolidated-routing-test");
  db = getFirestore(app);

  const owner = `consolidated-owner-${randomUUID()}`;
  await db.collection("users").doc(owner).set({
    osfTokenValid: true,
    osfToken: "valid",
    usingPersonalToken: true,
  });

  const base64ExperimentID = `consolidated-base64-${randomUUID()}`;
  await db.collection("experiments").doc(base64ExperimentID).set({
    activeBase64: true,
    owner,
    osfFilesLink: `http://localhost:${mockOSF.port}/files`,
  });
  createdExperimentIds.push(base64ExperimentID);

  const invalidBase64ExperimentID = `consolidated-base64-invalid-${randomUUID()}`;
  await db.collection("experiments").doc(invalidBase64ExperimentID).set({
    activeBase64: true,
    owner,
    osfFilesLink: `http://localhost:${mockOSF.port}/files`,
  });
  createdExperimentIds.push(invalidBase64ExperimentID);

  const inactiveDataExperimentID = `consolidated-data-inactive-${randomUUID()}`;
  await db.collection("experiments").doc(inactiveDataExperimentID).set({
    active: false,
    owner,
    storageProvider: "osf",
  });
  createdExperimentIds.push(inactiveDataExperimentID);

  const oldSessionExperimentID = `consolidated-session-old-${randomUUID()}`;
  const newSessionExperimentID = `consolidated-session-new-${randomUUID()}`;
  const sessionFixture = {
    active: true,
    activeBase64: false,
    activeConditionAssignment: false,
    owner,
    sessions: 0,
    nConditions: 1,
    currentCondition: 0,
    useValidation: false,
    allowJSON: true,
    allowCSV: true,
    requiredFields: [],
    maxSessions: 100,
    limitSessions: false,
    storageProvider: "gdrive",
    providerContainer: { kind: "gdrive", folderId: "consolidated-folder" },
  };
  await db.collection("experiments").doc(oldSessionExperimentID).set(sessionFixture);
  await db.collection("experiments").doc(newSessionExperimentID).set(sessionFixture);
  createdExperimentIds.push(oldSessionExperimentID, newSessionExperimentID);

  const oldConditionExperimentID = `consolidated-condition-old-${randomUUID()}`;
  const newConditionExperimentID = `consolidated-condition-new-${randomUUID()}`;
  const conditionFixture = { activeConditionAssignment: true, nConditions: 1, currentCondition: 0 };
  await db.collection("experiments").doc(oldConditionExperimentID).set(conditionFixture);
  await db.collection("experiments").doc(newConditionExperimentID).set(conditionFixture);
  createdExperimentIds.push(oldConditionExperimentID, newConditionExperimentID);

  // Stashed on the module-level fixtures object below rather than re-derived
  // per test.
  fixtures.owner = owner;
  fixtures.base64ExperimentID = base64ExperimentID;
  fixtures.invalidBase64ExperimentID = invalidBase64ExperimentID;
  fixtures.inactiveDataExperimentID = inactiveDataExperimentID;
  fixtures.oldSessionExperimentID = oldSessionExperimentID;
  fixtures.newSessionExperimentID = newSessionExperimentID;
  fixtures.oldConditionExperimentID = oldConditionExperimentID;
  fixtures.newConditionExperimentID = newConditionExperimentID;
});

afterAll(async () => {
  mockOSF.server.close();
  const batch = db.batch();
  for (const id of createdExperimentIds) {
    batch.delete(db.collection("experiments").doc(id));
  }
  if (fixtures.owner) batch.delete(db.collection("users").doc(fixtures.owner));
  await batch.commit();
});

describe("apidata's own /api/base64 route", () => {
  it("rejects invalid base64 exactly like apibase64 does", async () => {
    const oldResponse = await post(OLD_APIBASE64_URL, {
      experimentID: fixtures.invalidBase64ExperimentID,
      data: "{'not': 'base64'}",
      filename: "whatever",
    });
    const newResponse = await post(NEW_APIBASE64_URL, {
      experimentID: fixtures.invalidBase64ExperimentID,
      data: "{'not': 'base64'}",
      filename: "whatever",
    });

    expect(newResponse.status).toBe(oldResponse.status);
    expect(newResponse.body).toEqual(oldResponse.body);
    expect(newResponse.body).toEqual(MESSAGES.INVALID_BASE64_DATA);
  });

  it("accepts a valid base64 upload and uploads the decoded bytes", async () => {
    const filename = `consolidated-success-${randomUUID()}.dat`;
    const originalBytes = Buffer.from("bytes routed through apidata's /api/base64 dispatch");
    const payload = `data:application/octet-stream;base64,${originalBytes.toString("base64")}`;

    const response = await post(NEW_APIBASE64_URL, {
      experimentID: fixtures.base64ExperimentID,
      data: payload,
      filename,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(MESSAGES.SUCCESS);

    const received = mockOSF.getReceivedBytes(filename);
    expect(received).toBeDefined();
    expect(Buffer.compare(received, originalBytes)).toBe(0);
  });
});

describe("apidata's default branch (the data endpoint)", () => {
  it("behaves the same at the bare function URL and at /api/data for a validation failure", async () => {
    const bareResponse = await post(APIDATA_BARE_URL, { experimentID: "test" });
    const apiDataPathResponse = await post(APIDATA_API_DATA_URL, { experimentID: "test" });

    expect(bareResponse.status).toBe(400);
    expect(bareResponse.body).toEqual(MESSAGES.MISSING_PARAMETER);
    expect(apiDataPathResponse.status).toBe(bareResponse.status);
    expect(apiDataPathResponse.body).toEqual(bareResponse.body);
  });

  it("behaves the same at the bare function URL and at /api/data for a real gate rejection", async () => {
    const body = {
      experimentID: fixtures.inactiveDataExperimentID,
      data: "irrelevant",
      filename: "irrelevant.json",
    };

    const bareResponse = await post(APIDATA_BARE_URL, body);
    const apiDataPathResponse = await post(APIDATA_API_DATA_URL, body);

    expect(bareResponse.status).toBe(400);
    expect(bareResponse.body).toEqual(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
    expect(apiDataPathResponse.status).toBe(bareResponse.status);
    expect(apiDataPathResponse.body).toEqual(bareResponse.body);
  });
});

describe("participantapi -- /api/session", () => {
  it("matches apisessionstart's failure case: a missing experiment id", async () => {
    const oldResponse = await post(OLD_APISESSIONSTART_URL, {});
    const newResponse = await post(NEW_APISESSIONSTART_URL, {});

    expect(newResponse.status).toBe(oldResponse.status);
    expect(newResponse.body).toEqual(oldResponse.body);
    expect(newResponse.body).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("matches apisessionstart's success case (session id aside)", async () => {
    const oldResponse = await post(OLD_APISESSIONSTART_URL, {
      experimentID: fixtures.oldSessionExperimentID,
      filename: "p01.csv",
    });
    const newResponse = await post(NEW_APISESSIONSTART_URL, {
      experimentID: fixtures.newSessionExperimentID,
      filename: "p01.csv",
    });

    expect(oldResponse.status).toBe(200);
    expect(newResponse.status).toBe(200);
    expect(typeof newResponse.body.sessionId).toBe("string");
    expect(newResponse.body.sessionId.length).toBeGreaterThanOrEqual(20);
    // Every field except the (necessarily distinct) sessionId must agree.
    const { sessionId: _old, ...oldRest } = oldResponse.body;
    const { sessionId: _new, ...newRest } = newResponse.body;
    expect(newRest).toEqual(oldRest);
  });
});

describe("participantapi -- /api/condition", () => {
  it("matches apicondition's failure case: a missing experiment id", async () => {
    const oldResponse = await post(OLD_APICONDITION_URL, {});
    const newResponse = await post(NEW_APICONDITION_URL, {});

    expect(newResponse.status).toBe(oldResponse.status);
    expect(newResponse.body).toEqual(oldResponse.body);
    expect(newResponse.body).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("matches apicondition's success case", async () => {
    const oldResponse = await post(OLD_APICONDITION_URL, {
      experimentID: fixtures.oldConditionExperimentID,
    });
    const newResponse = await post(NEW_APICONDITION_URL, {
      experimentID: fixtures.newConditionExperimentID,
    });

    expect(oldResponse.status).toBe(200);
    expect(newResponse.status).toBe(200);
    expect(newResponse.body).toEqual(oldResponse.body);
    expect(newResponse.body).toEqual({ message: "Success", condition: 0 });
  });
});

describe("participantapi -- unmatched path", () => {
  it("404s in the same shape dashboardapi's dispatcher does", async () => {
    const response = await post(`${PARTICIPANTAPI_BASE}/api/not-a-real-route`, {});
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
  });
});
