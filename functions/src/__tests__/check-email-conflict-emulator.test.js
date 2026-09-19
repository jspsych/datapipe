/**
 * @jest-environment node
 */

// Emulator integration tests for check-email-conflict.ts, an unauthenticated
// endpoint that answers whether an email belongs to an OSF-linked account
// (used by the sign-up form to steer a researcher toward "sign in with OSF"
// instead of creating a duplicate password account). ZERO tests before this
// change.
//
// Deliberately unauthenticated by design (it has to answer before the caller
// has any credential), so this suite just pins its request/response shape
// and the exact query it runs: conflict only when authMethod === 'osf', not
// merely a matching email.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { fnUrl } from "./helpers/fn-url.js";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
const CHECK_URL = fnUrl("/api/checkemailconflict");

let db;

beforeAll(() => {
  let app;
  try {
    app = getApp("check-email-conflict-test");
  } catch {
    app = initializeApp(config, "check-email-conflict-test");
  }
  db = getFirestore(app);
});

const created = { uids: [] };

afterEach(async () => {
  const batch = db.batch();
  for (const uid of created.uids) {
    batch.delete(db.doc(`users/${uid}`));
  }
  await batch.commit();
  created.uids.length = 0;
});

async function callCheck(payload) {
  const res = await fetch(CHECK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function trackUid(uid) {
  created.uids.push(uid);
  return uid;
}

describe("request shape", () => {
  it("rejects non-POST methods", async () => {
    const res = await fetch(CHECK_URL, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("400 when email is missing", async () => {
    const { status, body } = await callCheck({});
    expect(status).toBe(400);
    expect(body.error).toBe("Email is required");
  });
});

describe("conflict resolution", () => {
  it("conflict:false for an email nobody has used", async () => {
    const { status, body } = await callCheck({ email: `no-such-user-${randomUUID()}@example.test` });
    expect(status).toBe(200);
    expect(body).toEqual({ conflict: false });
  });

  it("conflict:false when the email belongs to a password account (no authMethod: 'osf')", async () => {
    const uid = trackUid(`check-email-password-${randomUUID()}`);
    const email = `check-email-password-${randomUUID()}@example.test`;
    await db.doc(`users/${uid}`).set({ email, uid, experiments: [] });

    const { status, body } = await callCheck({ email });
    expect(status).toBe(200);
    expect(body).toEqual({ conflict: false });
  });

  it("conflict:true when the email belongs to an OSF-linked account (authMethod === 'osf')", async () => {
    const uid = trackUid(`check-email-osf-${randomUUID()}`);
    const email = `check-email-osf-${randomUUID()}@example.test`;
    await db.doc(`users/${uid}`).set({ email, uid, authMethod: "osf", experiments: [] });

    const { status, body } = await callCheck({ email });
    expect(status).toBe(200);
    expect(body).toEqual({ conflict: true });
  });
});
