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
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { purgeUserData } = require("../../lib/purge-user-data.js");

jest.setTimeout(30000);

const db = getFirestore();
const bucket = getStorage().bucket();

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

    const counts = await purgeUserData(uid);

    expect(counts).toMatchObject({
      experiments: 1,
      filenameClaims: 1,
      metadata: 1,
      logs: 1,
      queueEntries: 1,
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
