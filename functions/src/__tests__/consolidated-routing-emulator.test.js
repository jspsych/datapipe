/**
 * @jest-environment node
 *
 * Coverage for the participant-api consolidation's entry points:
 * participantapi (functions/src/participant-api.ts, dispatching /api/session
 * and /api/condition) and apidata's own "/api/base64" route (api-data.ts).
 *
 * This suite originally (step 1 of the rollout) proved these new entry
 * points matched the OLD standalone apisessionstart/apicondition/apibase64
 * functions response for response, while both sets stayed deployed side by
 * side. Step 2 (this commit) removes those standalone functions entirely --
 * see index.ts, api-session-start.ts, api-condition.ts, api-base64.ts -- so
 * there is nothing left to compare against. What remains is direct coverage
 * of the new entry points' own behavior, which is what every OTHER suite
 * that used to hit apisessionstart/apicondition/apibase64 also now asserts,
 * via fnUrl (see staging-emulator.test.js, get-condition-emulator.test.js,
 * base64data-emulator.test.js, and the rest -- grep the repo for fnUrl if
 * this comment goes stale).
 *
 * Covers:
 *   - fnUrl("/api/base64") (apidata's own "/api/base64" route) accepts a
 *     valid upload and rejects an invalid one.
 *   - apidata at its bare URL and at apidata/api/data both behave as the data
 *     endpoint -- the dispatcher's default branch, which direct invocations
 *     (this suite, and any caller using the raw function URL) depend on.
 *   - fnUrl("/api/session") and fnUrl("/api/condition") (participantapi)
 *     each have a success and a failure case.
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
const APIDATA_BARE_URL = `${FUNCTIONS_BASE}/apidata`;
const APIDATA_API_DATA_URL = `${FUNCTIONS_BASE}/apidata/api/data`;
const PARTICIPANTAPI_BASE = `${FUNCTIONS_BASE}/participantapi`;

const APIBASE64_URL = fnUrl("/api/base64");
const APISESSION_URL = fnUrl("/api/session");
const APICONDITION_URL = fnUrl("/api/condition");

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

  const sessionExperimentID = `consolidated-session-${randomUUID()}`;
  await db.collection("experiments").doc(sessionExperimentID).set({
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
  });
  createdExperimentIds.push(sessionExperimentID);

  const conditionExperimentID = `consolidated-condition-${randomUUID()}`;
  await db.collection("experiments").doc(conditionExperimentID).set({
    activeConditionAssignment: true,
    nConditions: 1,
    currentCondition: 0,
  });
  createdExperimentIds.push(conditionExperimentID);

  // Stashed on the module-level fixtures object below rather than re-derived
  // per test.
  fixtures.owner = owner;
  fixtures.base64ExperimentID = base64ExperimentID;
  fixtures.invalidBase64ExperimentID = invalidBase64ExperimentID;
  fixtures.inactiveDataExperimentID = inactiveDataExperimentID;
  fixtures.sessionExperimentID = sessionExperimentID;
  fixtures.conditionExperimentID = conditionExperimentID;
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
  it("rejects invalid base64 data", async () => {
    const response = await post(APIBASE64_URL, {
      experimentID: fixtures.invalidBase64ExperimentID,
      data: "{'not': 'base64'}",
      filename: "whatever",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(MESSAGES.INVALID_BASE64_DATA);
  });

  it("accepts a valid base64 upload and uploads the decoded bytes", async () => {
    const filename = `consolidated-success-${randomUUID()}.dat`;
    const originalBytes = Buffer.from("bytes routed through apidata's /api/base64 dispatch");
    const payload = `data:application/octet-stream;base64,${originalBytes.toString("base64")}`;

    const response = await post(APIBASE64_URL, {
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
  it("requires an experiment id", async () => {
    const response = await post(APISESSION_URL, {});

    expect(response.status).toBe(400);
    expect(response.body).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("admits a session for an open experiment", async () => {
    const response = await post(APISESSION_URL, {
      experimentID: fixtures.sessionExperimentID,
      filename: "p01.csv",
    });

    expect(response.status).toBe(200);
    expect(typeof response.body.sessionId).toBe("string");
    expect(response.body.sessionId.length).toBeGreaterThanOrEqual(20);
    expect(response.body.databaseURL).toEqual(expect.any(String));
    expect(response.body.maxTrialBytes).toEqual(expect.any(Number));
    expect(response.body.maxDisconnects).toEqual(expect.any(Number));
  });
});

describe("participantapi -- /api/condition", () => {
  it("requires an experiment id", async () => {
    const response = await post(APICONDITION_URL, {});

    expect(response.status).toBe(400);
    expect(response.body).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("returns a condition assignment", async () => {
    const response = await post(APICONDITION_URL, {
      experimentID: fixtures.conditionExperimentID,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Success", condition: 0 });
  });
});

describe("participantapi -- unmatched path", () => {
  it("404s in the same shape dashboardapi's dispatcher does", async () => {
    const response = await post(`${PARTICIPANTAPI_BASE}/api/not-a-real-route`, {});
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
  });
});
