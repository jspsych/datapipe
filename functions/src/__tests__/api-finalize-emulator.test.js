/**
 * @jest-environment node
 */

// End-to-end coverage for the Phase 4 surface of docs/finalization-spec.md:
// apiFinalize (onRequest, POST /api/finalize) and finalizeTask
// (onTaskDispatched), which apiFinalize hands off to via a real Cloud Task.
//
// This suite is deliberately NOT about finalizeExperiment's own correctness
// -- that is finalization-emulator.test.js's job, exercised in-process
// against a mock Zenodo. This suite is about the PLUMBING around it: auth,
// ownership, the cheap pre-checks, the HTTP contract, and -- the genuinely
// new risk surface -- whether a task enqueued through the real Cloud Tasks
// emulator actually reaches finalizeTask and whether finalizeTask correctly
// narrates `experiments/{id}.finalization` through queued -> running ->
// a terminal status.
//
// Both scenarios below are chosen SPECIFICALLY so finalizeExperiment reaches
// its terminal status without any network call at all, so this suite needs no
// mock provider server (and no fixed port to contend for):
//   - a gdrive-shaped experiment: gdrive.capabilities.maxFileCount is null,
//     so finalizeExperiment returns "not-eligible" immediately after
//     getProvider() (a pure in-memory lookup), before ever touching the
//     provider or the owner's token.
//   - a zenodo-shaped experiment with a collisionCache.salt already set and a
//     pending uploadQueue entry: finalizeExperiment's queued-uploads-pending
//     check runs BEFORE it acquires the compaction lease or calls
//     provider.listFiles, so this also resolves with no network call.
//
// Real Auth-emulator idTokens via accounts:signUp, same helper as
// create-experiment-emulator.test.js and oauth-connect-emulator.test.js.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(60000);

const config = { projectId: "datapipe-test" };
const FUNCTIONS_BASE = "http://localhost:5001/datapipe-test/us-central1";
const APIFINALIZE_URL = `${FUNCTIONS_BASE}/apifinalize`;
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

async function signUpEmulatorUser() {
  const email = `api-finalize-${randomUUID()}@example.test`;
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

async function callFinalize(experimentID, idToken, { method = "POST" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (idToken !== undefined) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  const res = await fetch(APIFINALIZE_URL, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify({ experimentID }) : undefined,
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

let db;

beforeAll(() => {
  let app;
  try {
    app = getApp("api-finalize-test");
  } catch {
    app = initializeApp(config, "api-finalize-test");
  }
  db = getFirestore(app);
});

async function seedNotEligibleExperiment(uid) {
  const experimentID = `finalize-notelig-${randomUUID()}`;
  await db.collection("experiments").doc(experimentID).set({
    owner: uid,
    active: true,
    sessions: 0,
    storageProvider: "gdrive",
    providerContainer: { provider: "gdrive", folderId: "irrelevant-folder" },
  });
  return experimentID;
}

async function seedQueuedUploadsPendingExperiment(uid) {
  const experimentID = `finalize-queued-${randomUUID()}`;
  await db.collection("experiments").doc(experimentID).set({
    owner: uid,
    active: true,
    sessions: 1,
    storageProvider: "zenodo",
    providerContainer: {
      provider: "zenodo",
      depositionId: 1,
      bucketUrl: "http://127.0.0.1:1/api/files/nonexistent-bucket",
      serverUrl: "https://zenodo.org",
    },
    collisionCache: { salt: "api-finalize-test-salt" },
  });
  await db.collection("uploadQueue").add({
    experimentID,
    owner: uid,
    status: "pending",
    filename: "sub-1_data.json",
    dataType: "data",
    storageProvider: "zenodo",
  });
  return experimentID;
}

async function seedLegacyExperiment(uid) {
  // No storageProvider/providerContainer at all -- the cheap pre-check
  // apiFinalize is meant to run itself, without ever reaching a Cloud Task.
  const experimentID = `finalize-legacy-${randomUUID()}`;
  await db.collection("experiments").doc(experimentID).set({
    owner: uid,
    active: true,
    sessions: 0,
    osfRepo: "abc12",
    osfComponent: "def34",
    osfFilesLink: "https://files.osf.io/v1/resources/abc12/providers/osfstorage/",
  });
  return experimentID;
}

async function waitForTerminalFinalization(experimentID, { timeoutMs = 30000, pollMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await db.collection("experiments").doc(experimentID).get();
    const data = snap.data();
    const status = data?.finalization?.status;
    if (status && status !== "queued" && status !== "running") {
      return data;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `finalization on ${experimentID} never reached a terminal status (last seen: ${status ?? "none"})`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

describe("apiFinalize — auth and request shape", () => {
  it("rejects non-POST methods", async () => {
    const { status } = await callFinalize("whatever", "irrelevant", { method: "GET" });
    expect(status).toBe(405);
  });

  it("returns 401 when there is no Authorization header", async () => {
    const { status } = await callFinalize("whatever", undefined);
    expect(status).toBe(401);
  });

  it("returns 401 for a garbage bearer token", async () => {
    const { status } = await callFinalize("whatever", "not-a-real-token");
    expect(status).toBe(401);
  });

  it("returns 400 when experimentID is missing from the body", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const res = await fetch(APIFINALIZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    void uid;
  });

  it("returns 403 for an experiment that does not exist", async () => {
    const { idToken } = await signUpEmulatorUser();
    const { status } = await callFinalize(`no-such-experiment-${randomUUID()}`, idToken);
    expect(status).toBe(403);
  });

  it("returns 403 when the caller does not own the experiment", async () => {
    const owner = await signUpEmulatorUser();
    const intruder = await signUpEmulatorUser();
    const experimentID = await seedNotEligibleExperiment(owner.uid);

    const { status } = await callFinalize(experimentID, intruder.idToken);
    expect(status).toBe(403);

    // And nothing was enqueued on the owner's behalf by the rejected call.
    const snap = await db.collection("experiments").doc(experimentID).get();
    expect(snap.data().finalization).toBeUndefined();
  });
});

describe("apiFinalize — cheap pre-checks (no Cloud Task involved)", () => {
  it("returns not-eligible for a legacy OSF-shaped experiment without enqueueing anything", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = await seedLegacyExperiment(uid);

    const { status, body } = await callFinalize(experimentID, idToken);
    expect(status).toBe(400);
    expect(body.status).toBe("not-eligible");

    // A synchronous pre-check rejection must not leave a "queued" state
    // behind for the dashboard to poll against forever.
    const snap = await db.collection("experiments").doc(experimentID).get();
    expect(snap.data().finalization).toBeUndefined();
  });

  it("returns already-finalized without touching finalization state", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = await seedNotEligibleExperiment(uid);
    await db.collection("experiments").doc(experimentID).update({
      finalized: true,
      finalizedAt: Timestamp.now(),
    });

    const { status, body } = await callFinalize(experimentID, idToken);
    expect(status).toBe(200);
    expect(body.status).toBe("already-finalized");

    const snap = await db.collection("experiments").doc(experimentID).get();
    expect(snap.data().finalization).toBeUndefined();
  });
});

describe("apiFinalize + finalizeTask — real Cloud Tasks round trip", () => {
  it("enqueues a task that carries finalization.status through queued/running to a terminal not-eligible result", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = await seedNotEligibleExperiment(uid);

    const { status, body } = await callFinalize(experimentID, idToken);
    expect(status).toBe(202);
    expect(body.status).toBe("queued");

    const final = await waitForTerminalFinalization(experimentID);
    expect(final.finalization.status).toBe("not-eligible");
    expect(typeof final.finalization.detail).toBe("string");
    expect(final.finalization.startedAt).toBeTruthy();
    expect(final.finalization.finishedAt).toBeTruthy();
    // not-eligible is a refusal, not a success -- the experiment must not
    // have been marked finalized.
    expect(final.finalized).not.toBe(true);
  });

  it("surfaces queued-uploads-pending as its own terminal status, not a generic failure", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = await seedQueuedUploadsPendingExperiment(uid);

    const { status, body } = await callFinalize(experimentID, idToken);
    expect(status).toBe(202);
    expect(body.status).toBe("queued");

    const final = await waitForTerminalFinalization(experimentID);
    expect(final.finalization.status).toBe("queued-uploads-pending");
    expect(final.finalization.detail).toMatch(/queued/i);
    expect(final.finalized).not.toBe(true);
  });

  it("is idempotent against a duplicate click: a second call while the first is in flight does not error", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const experimentID = await seedNotEligibleExperiment(uid);

    const first = await callFinalize(experimentID, idToken);
    expect(first.status).toBe(202);

    const second = await callFinalize(experimentID, idToken);
    // Whether the first task already flipped this to "running" or is still
    // "queued", the second call must report the in-flight state rather than
    // enqueueing a second task or erroring.
    expect(second.status).toBe(202);
    expect(["queued", "running"]).toContain(second.body.status);

    // The pass still reaches exactly one clean terminal state.
    const final = await waitForTerminalFinalization(experimentID);
    expect(final.finalization.status).toBe("not-eligible");
  });
});
