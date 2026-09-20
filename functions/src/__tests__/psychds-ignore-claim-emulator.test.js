/**
 * @jest-environment node
 *
 * psychds-ignore-claim.ts against the Firestore emulator: the per-experiment
 * claim that lets api-data.ts write .psychds-ignore at most once per
 * experiment instead of once per submission (see that module's header for
 * why -- Google Drive permits duplicate names, so the provider's own
 * NAME_CONFLICT dedup, which every other derived file relies on, never fires
 * for this one).
 */

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

const { randomUUID } = require("crypto");
const { initializeApp, getApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { claimPsychdsIgnore, releasePsychdsIgnoreClaim } = require("../../lib/psychds-ignore-claim.js");

let app;
try {
  app = getApp();
} catch {
  app = initializeApp();
}

jest.setTimeout(30000);

const db = getFirestore(app);

const createdExperiments = [];
async function makeExperiment() {
  const id = `psychds-ignore-claim-${randomUUID()}`;
  await db.collection("experiments").doc(id).set({ active: true, owner: "claim-test-owner" });
  createdExperiments.push(id);
  return id;
}

afterAll(async () => {
  const batch = db.batch();
  for (const id of createdExperiments) {
    batch.delete(db.collection("experiments").doc(id));
  }
  await batch.commit();
});

describe("claimPsychdsIgnore", () => {
  it("returns true and sets the field on the first call", async () => {
    const experimentID = await makeExperiment();

    const won = await claimPsychdsIgnore(experimentID);

    expect(won).toBe(true);
    const doc = await db.collection("experiments").doc(experimentID).get();
    expect(doc.data().psychdsIgnoreWrittenAt).toBeTruthy();
    expect(typeof doc.data().psychdsIgnoreWrittenAt.toMillis).toBe("function");
  });

  it("returns false on a second call, and leaves the field unchanged", async () => {
    const experimentID = await makeExperiment();

    await claimPsychdsIgnore(experimentID);
    const firstWrite = (await db.collection("experiments").doc(experimentID).get()).data()
      .psychdsIgnoreWrittenAt;

    const wonAgain = await claimPsychdsIgnore(experimentID);

    expect(wonAgain).toBe(false);
    const after = (await db.collection("experiments").doc(experimentID).get()).data()
      .psychdsIgnoreWrittenAt;
    expect(after.isEqual(firstWrite)).toBe(true);
  });

  it("returns true again after the claim is released", async () => {
    const experimentID = await makeExperiment();

    await claimPsychdsIgnore(experimentID);
    await releasePsychdsIgnoreClaim(experimentID);

    const doc = await db.collection("experiments").doc(experimentID).get();
    expect(doc.data().psychdsIgnoreWrittenAt).toBeUndefined();

    const wonAgain = await claimPsychdsIgnore(experimentID);
    expect(wonAgain).toBe(true);
  });

  // The whole point of doing this inside a Firestore transaction rather than
  // a plain read-then-write: Firestore transactions are serializable, so of
  // any number of callers racing the SAME experiment, exactly one can ever
  // observe the field absent and commit setting it.
  it("under concurrent claims on the same experiment, exactly one wins", async () => {
    const experimentID = await makeExperiment();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimPsychdsIgnore(experimentID))
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("never throws: a claim that cannot be decided answers 'write it'", async () => {
    // tx.update on a document that does not exist rejects the transaction --
    // the cheapest way to make it fail for real. api-data.ts calls this in the
    // request path before the raw data is uploaded, so a throw here would 500
    // a participant's submission over a marker file.
    await expect(claimPsychdsIgnore(`no-such-experiment-${Date.now()}`)).resolves.toBe(true);
  });

  it("release is a no-op (does not throw) when there is nothing to release", async () => {
    const experimentID = await makeExperiment();

    await expect(releasePsychdsIgnoreClaim(experimentID)).resolves.toBeUndefined();
  });

  it("release swallows errors for a nonexistent experiment rather than throwing", async () => {
    // No corresponding experiments/{id} doc was ever created -- update() on a
    // missing document rejects, and releasePsychdsIgnoreClaim's whole point is
    // to be safe to call from an already-best-effort failure path.
    await expect(
      releasePsychdsIgnoreClaim(`psychds-ignore-claim-missing-${randomUUID()}`)
    ).resolves.toBeUndefined();
  });
});
