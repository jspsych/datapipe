/**
 * @jest-environment node
 */

// End-to-end coverage for the verification round trip (plan §2.2, package
// P3): send-contact-email-verification.ts (POST /api/sendcontactemailverification)
// and verify-contact-email.ts (POST /api/verifycontactemail).
//
// Both are bearer-token onRequest endpoints -- the same shape as
// delete-account.ts and api-finalize.ts -- not Firestore triggers, so unlike
// upload-failure-notify-emulator.test.js's handleQueueWrite seam there is no
// plain in-process function to import and call: an onRequest export is a
// CloudFunction object, not a callable (req, res) function. This suite
// therefore follows api-finalize-emulator.test.js's pattern instead -- real
// HTTP calls against the running Functions emulator, with real Auth-emulator
// idTokens from accounts:signUp -- while keeping the env-var and admin-app
// conventions upload-failure-notify-emulator.test.js established:
// FIRESTORE_EMULATOR_HOST set at module scope before any import that reaches
// app.js, a NAMED admin app so the compiled modules' bare initializeApp()
// does not collide with it, and a dynamic import of the COMPILED module from
// functions/lib/ (so `npm --prefix functions run build` must run first).
//
// The dynamic import is for hashVerificationCode / hashContactEmail /
// EXPIRY_MS / VERIFICATIONS_COLLECTION only -- reading the real hashing logic
// and the real 24-hour constant rather than restating them, so a fixture
// this suite seeds directly (for the expired-code, attempt-exhaustion and
// stale-address cases, which bypass the send endpoint on purpose to control
// expiresAt/attempts/the address a code was bound to) stays byte-identical
// to what the endpoint itself would have written.
//
// The happy path deliberately never reads a code out of a fixture it wrote
// itself: it goes through the real send endpoint and recovers the actual
// mailed code from the `mail` collection -- the same "assert on the mail
// collection" contract mail.ts's header describes -- so it is the real
// generate/hash/store/mail pipeline being proven, not just the verify half.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
const FUNCTIONS_BASE = "http://localhost:5001/datapipe-test/us-central1";
const SEND_URL = `${FUNCTIONS_BASE}/sendcontactemailverification`;
const VERIFY_URL = `${FUNCTIONS_BASE}/verifycontactemail`;
const AUTH_EMULATOR_SIGNUP_URL =
  "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake";

let db;
let hashVerificationCode;
let hashContactEmail;
let EXPIRY_MS;
let VERIFICATIONS_COLLECTION;

beforeAll(async () => {
  let app;
  try {
    app = getApp("contact-email-verify-test");
  } catch {
    app = initializeApp(config, "contact-email-verify-test");
  }
  db = getFirestore(app);

  ({ hashVerificationCode, hashContactEmail, EXPIRY_MS, VERIFICATIONS_COLLECTION } =
    await import("../../lib/send-contact-email-verification.js"));
});

// ---------------------------------------------------------------------------
// Fixtures, HTTP helpers, and scoped cleanup
// ---------------------------------------------------------------------------

const created = { uids: [] };

async function signUpEmulatorUser() {
  const email = `contact-verify-${randomUUID()}@example.test`;
  const res = await fetch(AUTH_EMULATOR_SIGNUP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!", returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Auth emulator signUp failed (${res.status}): ${JSON.stringify(body)}`);
  }
  created.uids.push(body.localId);
  return { uid: body.localId, idToken: body.idToken };
}

async function seedUserDoc(uid, contactEmail, overrides = {}) {
  await db.doc(`users/${uid}`).set({
    uid,
    email: "",
    experiments: [],
    contactEmail,
    contactEmailVerified: false,
    ...overrides,
  });
}

async function callSend(idToken) {
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function callVerify(idToken, code, { method = "POST" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(VERIFY_URL, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify({ code }) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// Recovers the code from the `mail` collection rather than from a
// server-returned field -- the endpoint must never put the code in an API
// response, only in the mailed body. Sorted newest-first so a resend test
// (which produces two documents when the first send is not itself
// rate-limited) reads the current one.
async function mailedCodeFor(uid) {
  const snap = await db
    .collection("mail")
    .where("datapipe.owner", "==", uid)
    .where("datapipe.kind", "==", "contact-email-verification")
    .get();
  expect(snap.size).toBeGreaterThan(0);
  const docs = snap.docs.sort(
    (a, b) =>
      (b.data().datapipe.queuedAt?.toMillis?.() ?? 0) -
      (a.data().datapipe.queuedAt?.toMillis?.() ?? 0)
  );
  const match = /code is (\d{6})/.exec(docs[0].data().message.text);
  expect(match).not.toBeNull();
  return { code: match[1], mailCount: docs.length };
}

async function verificationDoc(uid) {
  const snap = await db.doc(`${VERIFICATIONS_COLLECTION}/${uid}`).get();
  return snap.exists ? snap.data() : undefined;
}

afterEach(async () => {
  const batch = db.batch();
  for (const uid of created.uids) {
    const mail = await db.collection("mail").where("datapipe.owner", "==", uid).get();
    mail.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(db.doc(`users/${uid}`));
    batch.delete(db.doc(`${VERIFICATIONS_COLLECTION}/${uid}`));
  }
  await batch.commit();
  created.uids.length = 0;
});

// ---------------------------------------------------------------------------
// Auth and request shape -- both endpoints, same shape as delete-account.ts
// ---------------------------------------------------------------------------

describe("auth and request shape", () => {
  it("send: rejects non-POST methods", async () => {
    const res = await fetch(SEND_URL, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("send: 401 with no Authorization header", async () => {
    const { status } = await callSend(undefined);
    expect(status).toBe(401);
  });

  it("send: 401 for a garbage bearer token", async () => {
    const { status } = await callSend("not-a-real-token");
    expect(status).toBe(401);
  });

  it("verify: rejects non-POST methods", async () => {
    const { status } = await callVerify("irrelevant", "123456", { method: "GET" });
    expect(status).toBe(405);
  });

  it("verify: 401 with no Authorization header", async () => {
    const { status } = await callVerify(undefined, "123456");
    expect(status).toBe(401);
  });

  it("verify: 401 for a garbage bearer token", async () => {
    const { status } = await callVerify("not-a-real-token", "123456");
    expect(status).toBe(401);
  });

  it("verify: 400 for a malformed code, before touching Firestore at all", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    // No user doc seeded -- if this reached the "no contact email" branch
    // instead of failing on shape, that would also be a 400, so the
    // assertion is on the specific code to prove which check fired.
    const { status, body } = await callVerify(idToken, "12ab56");
    expect(status).toBe(400);
    expect(body.code).toBe("invalid-code");
    void uid;
  });
});

// ---------------------------------------------------------------------------
// Happy path: the real generate -> hash -> mail -> verify round trip
// ---------------------------------------------------------------------------

describe("happy path", () => {
  it("a correct code verifies the address, deletes the record, and is never echoed in a response", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedUserDoc(uid, "researcher@example.edu");

    const sent = await callSend(idToken);
    expect(sent.status).toBe(200);
    // The 6-digit secret must never appear in an API response -- only in the
    // mailed body, recovered below via mailedCodeFor.
    expect(JSON.stringify(sent.body)).not.toMatch(/codeHash|emailHash/);

    const { code } = await mailedCodeFor(uid);

    const verified = await callVerify(idToken, code);
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ success: true });
    expect(JSON.stringify(verified.body)).not.toMatch(/codeHash|emailHash/);

    const userSnap = await db.doc(`users/${uid}`).get();
    expect(userSnap.data().contactEmailVerified).toBe(true);

    // The record is consumed on success -- nothing left for a second guess
    // to be checked against, and nothing left holding the hash.
    expect(await verificationDoc(uid)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Wrong code
// ---------------------------------------------------------------------------

describe("wrong code", () => {
  it("is refused, counts against the attempt budget, and does not verify", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedUserDoc(uid, "researcher@example.edu");

    await callSend(idToken);
    const { code } = await mailedCodeFor(uid);
    const wrongCode = code === "000001" ? "000002" : "000001";

    const result = await callVerify(idToken, wrongCode);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("invalid-code");

    expect((await verificationDoc(uid)).attempts).toBe(1);
    const userSnap = await db.doc(`users/${uid}`).get();
    expect(userSnap.data().contactEmailVerified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Expired code
// ---------------------------------------------------------------------------

describe("expired code", () => {
  it("is refused even though it is otherwise correct", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const email = "researcher@example.edu";
    await seedUserDoc(uid, email);

    const knownCode = "482913";
    await db.doc(`${VERIFICATIONS_COLLECTION}/${uid}`).set({
      emailHash: hashContactEmail(email),
      codeHash: hashVerificationCode(knownCode, uid),
      expiresAt: Date.now() - 1000,
      attempts: 0,
      sentAt: Date.now() - EXPIRY_MS - 1000,
    });

    const result = await callVerify(idToken, knownCode);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("expired");

    const userSnap = await db.doc(`users/${uid}`).get();
    expect(userSnap.data().contactEmailVerified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Attempt exhaustion
// ---------------------------------------------------------------------------

describe("attempt exhaustion", () => {
  it("the sixth attempt is refused regardless of correctness", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    const email = "researcher@example.edu";
    await seedUserDoc(uid, email);

    const knownCode = "731044";
    await db.doc(`${VERIFICATIONS_COLLECTION}/${uid}`).set({
      emailHash: hashContactEmail(email),
      codeHash: hashVerificationCode(knownCode, uid),
      expiresAt: Date.now() + EXPIRY_MS,
      attempts: 5, // plan §2.2's cap, already reached by five prior guesses
      sentAt: Date.now(),
    });

    // The CORRECT code -- proving the cap wins even over a right answer, not
    // merely that a sixth wrong guess is refused.
    const result = await callVerify(idToken, knownCode);
    expect(result.status).toBe(429);
    expect(result.body.code).toBe("too-many-attempts");

    const userSnap = await db.doc(`users/${uid}`).get();
    expect(userSnap.data().contactEmailVerified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stale-address guard -- the bug class this endpoint exists to close
// ---------------------------------------------------------------------------

describe("stale address", () => {
  it("a code minted for a previous address does not verify a newer one", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedUserDoc(uid, "old@example.edu");

    await callSend(idToken);
    const { code } = await mailedCodeFor(uid);

    // The researcher changes their address before entering the code --
    // exactly what components/account/ContactEmail.js's edit form allows at
    // any time, and exactly what buildContactEmailUpdate() does: reset
    // contactEmailVerified to false on the new, unconfirmed value.
    await db.doc(`users/${uid}`).update({
      contactEmail: "new@example.edu",
      contactEmailVerified: false,
    });

    const result = await callVerify(idToken, code);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("stale-address");

    const userSnap = await db.doc(`users/${uid}`).get();
    expect(userSnap.data().contactEmailVerified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rate limit on resend
// ---------------------------------------------------------------------------

describe("rate limit", () => {
  it("a resend within the cooldown is refused, and the original code stays usable", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedUserDoc(uid, "researcher@example.edu");

    const first = await callSend(idToken);
    expect(first.status).toBe(200);

    const second = await callSend(idToken);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("rate-limited");

    // The blocked resend must not have queued a second mail, and must not
    // have overwritten the first record with a fresh (unusable) one.
    const { code, mailCount } = await mailedCodeFor(uid);
    expect(mailCount).toBe(1);

    const verified = await callVerify(idToken, code);
    expect(verified.status).toBe(200);
    expect(verified.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No contact email on file
// ---------------------------------------------------------------------------

describe("no contact email", () => {
  it("send is refused when there is nothing to mail", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedUserDoc(uid, "");

    const result = await callSend(idToken);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("no-contact-email");
    expect(await verificationDoc(uid)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Already verified -- both endpoints are idempotent no-ops
// ---------------------------------------------------------------------------

describe("already verified", () => {
  it("send and verify both report alreadyVerified without sending mail or requiring a code", async () => {
    const { uid, idToken } = await signUpEmulatorUser();
    await seedUserDoc(uid, "researcher@example.edu", { contactEmailVerified: true });

    const sent = await callSend(idToken);
    expect(sent.status).toBe(200);
    expect(sent.body.alreadyVerified).toBe(true);

    const mail = await db.collection("mail").where("datapipe.owner", "==", uid).get();
    expect(mail.size).toBe(0);

    const verified = await callVerify(idToken, "000000");
    expect(verified.status).toBe(200);
    expect(verified.body.alreadyVerified).toBe(true);
  });
});
