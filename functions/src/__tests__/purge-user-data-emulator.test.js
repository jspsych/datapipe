/**
 * @jest-environment node
 */

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
// payload/token crypto: any 64-hex key works in tests
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
// app.js (imported transitively below) calls initializeApp() with no args and
// reads the default bucket from FIREBASE_CONFIG -- set before those imports.
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

const { randomUUID } = require("crypto");
const express = require("express");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { purgeUserData } = require("../../lib/purge-user-data.js");

jest.setTimeout(30000);

const db = getFirestore();
const bucket = getStorage().bucket();

// purgeUserData is called in-process (not through the Functions emulator's
// HTTP listener), so GDRIVE_REVOKE_URL only needs to be readable by THIS
// process at call time -- an OS-assigned port (listen(0)) is fine here, same
// pattern as metadata-emulator.test.js's createMockOSFServer, unlike
// oauth-connect-emulator.test.js's fixed port (which a separately-spawned
// Functions-emulator process has to be told about ahead of time).
function createMockRevokeServer() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const receivedTokens = [];

  app.post("/revoke", (req, res) => {
    receivedTokens.push(req.body.token);
    if (req.body.token === "revoke-should-fail") {
      res.status(500).send("mock revoke failure");
      return;
    }
    res.status(200).send("");
  });

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        server,
        port: server.address().port,
        getReceivedTokens: () => receivedTokens.slice(),
      });
    });
  });
}

let mockRevokeServer;
const ORIGINAL_GDRIVE_REVOKE_URL = process.env.GDRIVE_REVOKE_URL;

beforeAll(async () => {
  mockRevokeServer = await createMockRevokeServer();
  process.env.GDRIVE_REVOKE_URL = `http://127.0.0.1:${mockRevokeServer.port}/revoke`;
});

afterAll(() => {
  mockRevokeServer.server.close();
  process.env.GDRIVE_REVOKE_URL = ORIGINAL_GDRIVE_REVOKE_URL;
});

// Every document this suite creates is namespaced by a per-run uid so it can
// never collide with, or delete, anything belonging to a suite running in
// parallel. See the note in scheduled-pending-recovery-emulator.test.js.
function makeUid() {
  return `purge-test-${randomUUID()}`;
}

async function seedExperiment(uid, experimentID, { active = true } = {}) {
  await db.collection("experiments").doc(experimentID).set({
    active,
    owner: uid,
    title: "Purge fixture",
    storageProvider: "gdrive",
  });
  await db
    .collection("experiments")
    .doc(experimentID)
    .collection("filenameClaims")
    .doc("claim-one")
    .set({ filename: "subject-1.json", claimedAt: Date.now() });
  await db.collection("metadata").doc(experimentID).set({ owner: uid });
  await db.collection("logs").doc(experimentID).set({ owner: uid });
  await bucket
    .file(`pending-data/${experimentID}/subject-1.json_123`)
    .save(JSON.stringify({ experimentID, filename: "s.json", data: "[]" }), {
      contentType: "application/json",
    });
}

async function exists(ref) {
  return (await ref.get()).exists;
}

describe("purgeUserData", () => {
  const strays = [];

  afterEach(async () => {
    // Only what this suite created and the purge did not remove.
    while (strays.length) {
      await strays.pop().delete().catch(() => {});
    }
  });

  it("removes every trace of the account", async () => {
    const uid = makeUid();
    const experimentID = `exp-${randomUUID()}`;
    await seedExperiment(uid, experimentID);
    await db
      .collection("users")
      .doc(uid)
      .set({ uid, email: "purge@example.com", experiments: [experimentID] });
    const queueDocId = `queue-${randomUUID()}`;
    await db
      .collection("uploadQueue")
      .doc(queueDocId)
      .set({ owner: uid, experimentID, status: "pending" });
    const mailRef = db.collection("mail").doc();
    await mailRef.set({
      to: ["purge@example.com"],
      message: { subject: "s", text: "t" },
      datapipe: { kind: "upload-failure", owner: uid, experimentID },
    });
    await db
      .collection("contactEmailVerifications")
      .doc(uid)
      .set({ emailHash: "h", codeHash: "h", expiresAt: Date.now(), attempts: 0, sentAt: Date.now() });

    // A live-sessions dashboard row: keyed by a session hash, found by owner.
    const liveRef = db.collection("liveSessions").doc(`purge-${uid}`);
    await liveRef.set({ owner: uid, experimentID: "x", state: "active" });

    const counts = await purgeUserData(uid);

    expect(await exists(liveRef)).toBe(false);
    expect(counts).toMatchObject({
      experiments: 1,
      filenameClaims: 1,
      metadata: 1,
      logs: 1,
      queueEntries: 1,
      liveSessions: 1,
      pendingFiles: 1,
      userDocument: 1,
      mailDocuments: 1,
      contactEmailVerification: 1,
    });

    expect(await exists(db.collection("users").doc(uid))).toBe(false);
    expect(await exists(db.collection("experiments").doc(experimentID))).toBe(
      false
    );
    expect(await exists(db.collection("metadata").doc(experimentID))).toBe(
      false
    );
    expect(await exists(db.collection("logs").doc(experimentID))).toBe(false);
    expect(await exists(db.collection("uploadQueue").doc(queueDocId))).toBe(
      false
    );
    expect(await exists(mailRef)).toBe(false);
    expect(
      await exists(db.collection("contactEmailVerifications").doc(uid))
    ).toBe(false);

    const [pending] = await bucket.getFiles({
      prefix: `pending-data/${experimentID}/`,
    });
    expect(pending).toHaveLength(0);
  });

  // A user who never set a contact email, or never had a verification
  // in flight, has neither document -- purging must not error or find
  // phantom counts.
  it("purges clean when there are no mail docs or verification doc", async () => {
    const uid = makeUid();
    const experimentID = `exp-${randomUUID()}`;
    await seedExperiment(uid, experimentID);
    await db
      .collection("users")
      .doc(uid)
      .set({ uid, email: "no-mail@example.com", experiments: [experimentID] });

    const counts = await purgeUserData(uid);

    expect(counts.mailDocuments).toBe(0);
    expect(counts.contactEmailVerification).toBe(0);
    expect(counts.userDocument).toBe(1);
  });

  // The regression that left a live experiment behind in datapipe-test: the
  // old implementation read users/{uid}.experiments, so anything missing from
  // that array survived its owner -- and a surviving `active` experiment still
  // accepts submissions and writes them to Cloud Storage.
  it("deletes experiments missing from the users/{uid}.experiments array", async () => {
    const uid = makeUid();
    const listed = `exp-${randomUUID()}`;
    const drifted = `exp-${randomUUID()}`;
    await seedExperiment(uid, listed);
    await seedExperiment(uid, drifted);
    // The array knows about only one of the two.
    await db
      .collection("users")
      .doc(uid)
      .set({ uid, email: "drift@example.com", experiments: [listed] });

    const counts = await purgeUserData(uid);

    expect(counts.experiments).toBe(2);
    expect(await exists(db.collection("experiments").doc(drifted))).toBe(false);
  });

  // Deleting a Firestore document does not delete its subcollections.
  it("clears the filenameClaims subcollection under each experiment", async () => {
    const uid = makeUid();
    const experimentID = `exp-${randomUUID()}`;
    await seedExperiment(uid, experimentID);

    await purgeUserData(uid);

    const claims = await db
      .collection("experiments")
      .doc(experimentID)
      .collection("filenameClaims")
      .get();
    expect(claims.empty).toBe(true);
  });

  it("works when the user document is already gone", async () => {
    const uid = makeUid();
    const experimentID = `exp-${randomUUID()}`;
    await seedExperiment(uid, experimentID);
    // No users/{uid} doc at all -- the orphan state already in datapipe-test.

    const counts = await purgeUserData(uid);

    expect(counts.experiments).toBe(1);
    expect(counts.userDocument).toBe(0);
  });

  // Best-effort Google Drive grant revocation (functions/src/providers/
  // gdrive-oauth.ts's revokeGdriveToken), run before the user document that
  // names the connection is deleted.
  it("revokes a connected gdrive grant with Google before deleting the account", async () => {
    const uid = makeUid();
    const refreshToken = `purge-refresh-${randomUUID()}`;
    await db
      .collection("users")
      .doc(uid)
      .set({
        uid,
        connectedAccounts: {
          gdrive: {
            authMethod: "oauth2",
            encryptedToken: "purge-access-token-placeholder",
            encryptedRefreshToken: refreshToken,
            tokenExpiresAt: Date.now() + 60 * 60 * 1000,
          },
        },
      });

    const counts = await purgeUserData(uid);

    expect(counts.gdriveRevoked).toBe(true);
    expect(counts.userDocument).toBe(1);
    expect(mockRevokeServer.getReceivedTokens()).toContain(refreshToken);
    expect(await exists(db.collection("users").doc(uid))).toBe(false);
  });

  // Revocation failing must not stop the rest of the purge -- the account is
  // still deleted, just with gdriveRevoked: false to report it.
  it("still deletes the account when gdrive revocation fails", async () => {
    const uid = makeUid();
    await db
      .collection("users")
      .doc(uid)
      .set({
        uid,
        connectedAccounts: {
          gdrive: {
            authMethod: "oauth2",
            encryptedToken: "purge-access-token-placeholder",
            encryptedRefreshToken: "revoke-should-fail",
            tokenExpiresAt: Date.now() + 60 * 60 * 1000,
          },
        },
      });

    const counts = await purgeUserData(uid);

    expect(counts.gdriveRevoked).toBe(false);
    expect(counts.userDocument).toBe(1);
    expect(await exists(db.collection("users").doc(uid))).toBe(false);
  });

  // deleteAccount purges and then deletes the auth record, which fires
  // onUserDeleted, which purges again.
  it("is idempotent", async () => {
    const uid = makeUid();
    const experimentID = `exp-${randomUUID()}`;
    await seedExperiment(uid, experimentID);
    await db
      .collection("users")
      .doc(uid)
      .set({ uid, email: "twice@example.com", experiments: [experimentID] });
    await db
      .collection("mail")
      .doc()
      .set({
        to: ["twice@example.com"],
        message: { subject: "s", text: "t" },
        datapipe: { kind: "upload-failure", owner: uid },
      });
    await db
      .collection("contactEmailVerifications")
      .doc(uid)
      .set({ emailHash: "h", codeHash: "h", expiresAt: Date.now(), attempts: 0, sentAt: Date.now() });

    await purgeUserData(uid);
    const second = await purgeUserData(uid);

    expect(second).toMatchObject({
      experiments: 0,
      filenameClaims: 0,
      metadata: 0,
      logs: 0,
      queueEntries: 0,
      liveSessions: 0,
      pendingFiles: 0,
      userDocument: 0,
      mailDocuments: 0,
      contactEmailVerification: 0,
    });
  });

  it("leaves another researcher's data untouched", async () => {
    const victim = makeUid();
    const bystander = makeUid();
    const victimExp = `exp-${randomUUID()}`;
    const bystanderExp = `exp-${randomUUID()}`;
    await seedExperiment(victim, victimExp);
    await seedExperiment(bystander, bystanderExp);
    const bystanderUserRef = db.collection("users").doc(bystander);
    await bystanderUserRef.set({
      uid: bystander,
      email: "bystander@example.com",
      experiments: [bystanderExp],
    });
    strays.push(bystanderUserRef);
    strays.push(db.collection("experiments").doc(bystanderExp));
    strays.push(db.collection("metadata").doc(bystanderExp));
    strays.push(db.collection("logs").doc(bystanderExp));
    const bystanderMailRef = db.collection("mail").doc();
    await bystanderMailRef.set({
      to: ["bystander@example.com"],
      message: { subject: "s", text: "t" },
      datapipe: { kind: "upload-failure", owner: bystander },
    });
    strays.push(bystanderMailRef);
    const bystanderVerificationRef = db
      .collection("contactEmailVerifications")
      .doc(bystander);
    await bystanderVerificationRef.set({
      emailHash: "h",
      codeHash: "h",
      expiresAt: Date.now(),
      attempts: 0,
      sentAt: Date.now(),
    });
    strays.push(bystanderVerificationRef);

    await purgeUserData(victim);

    expect(await exists(db.collection("experiments").doc(bystanderExp))).toBe(
      true
    );
    expect(await exists(bystanderUserRef)).toBe(true);
    expect(await exists(bystanderMailRef)).toBe(true);
    expect(await exists(bystanderVerificationRef)).toBe(true);
    const [pending] = await bucket.getFiles({
      prefix: `pending-data/${bystanderExp}/`,
    });
    expect(pending).toHaveLength(1);
    await Promise.all(pending.map((f) => f.delete()));
  });
});
