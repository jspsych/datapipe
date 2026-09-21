/**
 * @jest-environment node
 */

// Emulator integration tests for apiQueueStatus (functions/src/api-queue-status.ts),
// GET /api/queuestatus, documented at pages/docs/api.js under "Queue status".
// This module had zero tests before this file.
//
// Scope: the plain list form only (no `download`/`downloadAll` query param) --
// auth, ownership, and the shape/order of the returned entries. The
// `download` and `downloadAll` branches (storage reads, decrypt-or-passthrough,
// ZIP archiving) are a different risk surface and are not covered here.
//
// This suite exists specifically because the list query
// (.where("experimentID","==",X).where("status","in",[...]).orderBy("createdAt","desc"))
// needs a composite Firestore index that production was missing (see
// firestore-indexes.test.js, which pins the fix in firestore.indexes.json).
// The Firestore EMULATOR DOES NOT ENFORCE composite indexes -- it happily
// runs this query with no index at all -- so a green result here proves the
// endpoint's auth/ownership/response-shape behavior, NOT that the index
// exists in production. Only firestore-indexes.test.js (a pure test against
// the committed JSON) guards that.
//
// Auth pattern (real Auth-emulator idTokens via accounts:signUp) follows
// get-provider-access-token-emulator.test.js. Queue-document seeding follows
// upload-queue.test.js's direct db.collection("uploadQueue").doc(id).set(...)
// convention, scoped to this suite's own docs for cleanup.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
const FUNCTIONS_BASE = "http://localhost:5001/datapipe-test/us-central1";
// Per index.ts's lowercase export convention (apiQueueStatus -> apiqueuestatus).
const QUEUE_STATUS_URL = `${FUNCTIONS_BASE}/apiqueuestatus`;
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

let db;

beforeAll(() => {
  let app;
  try {
    app = getApp("api-queue-status-test");
  } catch {
    app = initializeApp(config, "api-queue-status-test");
  }
  db = getFirestore(app);
});

// ---- helpers ----

async function signUpEmulatorUser() {
  const email = `api-queue-status-${randomUUID()}@example.test`;
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

async function getQueueStatus(experimentID, idToken) {
  const res = await fetch(`${QUEUE_STATUS_URL}?experimentID=${experimentID}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${idToken}` },
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

const createdQueueDocIds = [];
const createdExperimentIds = [];

function queueDoc(docId) {
  createdQueueDocIds.push(docId);
  return db.collection("uploadQueue").doc(docId);
}

function experimentDoc(experimentID) {
  createdExperimentIds.push(experimentID);
  return db.collection("experiments").doc(experimentID);
}

afterEach(async () => {
  const batch = db.batch();
  for (const docId of createdQueueDocIds) {
    batch.delete(db.collection("uploadQueue").doc(docId));
  }
  for (const experimentID of createdExperimentIds) {
    batch.delete(db.collection("experiments").doc(experimentID));
  }
  if (createdQueueDocIds.length > 0 || createdExperimentIds.length > 0) {
    await batch.commit();
  }
  createdQueueDocIds.length = 0;
  createdExperimentIds.length = 0;
});

async function seedExperiment(owner) {
  const experimentID = `queue-status-exp-${randomUUID()}`;
  await experimentDoc(experimentID).set({
    owner,
    active: true,
    storageProvider: "gdrive",
  });
  return experimentID;
}

async function seedQueueEntry(experimentID, { filename, status, createdAtMs }) {
  const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
  await queueDoc(docId).set({
    experimentID,
    owner: "irrelevant-for-this-endpoint", // ownership is checked on the experiment, not the queue doc
    filename,
    storagePath: `upload-queue/${docId}`,
    dataType: "data",
    status,
    errorCode: 0,
    retryCount: 0,
    maxRetries: 5,
    createdAt: Timestamp.fromMillis(createdAtMs),
    lastAttemptAt: null,
    nextRetryAt: null,
    completedAt: null,
    failureReason: null,
  });
  return docId;
}

// ---- cases ----

describe("apiQueueStatus list form (GET /api/queuestatus)", () => {
  it("returns 200 with the owner's queue entries in createdAt descending order", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = await seedExperiment(uid);

    const now = Date.now();
    // Seeded out of order on purpose: the endpoint's orderBy must do the
    // sorting, not insertion order.
    await seedQueueEntry(experimentID, {
      filename: "older.csv",
      status: "pending",
      createdAtMs: now - 60_000,
    });
    await seedQueueEntry(experimentID, {
      filename: "newer.csv",
      status: "failed",
      createdAtMs: now,
    });

    const { status, body } = await getQueueStatus(experimentID, idToken);

    expect(status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.entries.map((e) => e.filename)).toEqual(["newer.csv", "older.csv"]);
    expect(body.entries[0].status).toBe("failed");
    expect(body.entries[1].status).toBe("pending");
  });

  it("returns 403 when the caller does not own the experiment", async () => {
    const owner = await signUpEmulatorUser();
    const nonOwner = await signUpEmulatorUser();
    const experimentID = await seedExperiment(owner.uid);

    await seedQueueEntry(experimentID, {
      filename: "data.csv",
      status: "pending",
      createdAtMs: Date.now(),
    });

    const { status, body } = await getQueueStatus(experimentID, nonOwner.idToken);

    expect(status).toBe(403);
    expect(body.error).toBeDefined();
  });
});
