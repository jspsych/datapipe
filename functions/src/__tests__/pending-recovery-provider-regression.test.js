/**
 * @jest-environment node
 */

// RED-phase regression test for step 7a's scheduled-pending-recovery.ts audit
// (scratchpad/step7a-create-endpoint-spec.md, case 10 of the test plan).
//
// The audit: scheduledPendingRecovery's re-queue path (promoteToQueue in
// functions/src/scheduled-pending-recovery.ts) builds its uploadQueue doc by
// hand, reading only `expData.osfFilesLink` off the recovered experiment --
// it never reads/forwards `expData.storageProvider` /
// `expData.providerContainer`. Unlike queue-upload.ts (which explicitly
// passes storageProvider/providerContainer through, see api-data.ts's calls),
// this path has no such wiring. A recovered pending upload for a gdrive
// experiment would therefore fall back to the legacy OSF shape in the queue
// doc and fail when scheduled-upload-retry.ts later tries to process it.
// This test seeds exactly that scenario and asserts the queue doc carries the
// provider fields -- expected RED today.
//
// Seam: scheduled-pending-recovery.ts exports only `scheduledPendingRecovery`
// (an onSchedule-wrapped function); `recoverPendingUploads`/`promoteToQueue`
// are private. Rather than going through the Functions-emulator's HTTP
// manual-trigger URL (the "scheduledpendingrecovery-0" pattern established by
// oauth-connect-scheduled-regression.test.js's case 11), this test uses a
// more direct seam: firebase-functions v2's onSchedule() implementation
// (node_modules/firebase-functions/lib/v2/providers/scheduler.js) stashes the
// raw, unwrapped handler on the returned function as `.run` (`func.run =
// handler`). Dynamically importing the COMPILED module (functions/lib/,
// requires `npm run build` first -- same convention as
// oauth-connect-emulator.test.js's `await import("../../lib/crypto-utils.js")`)
// and calling `scheduledPendingRecovery.run()` invokes recoverPendingUploads()
// directly in THIS process.
//
// That matters because recoverPendingUploads() only recovers files older
// than STALE_THRESHOLD_MS (15 minutes) -- a real pending-data file would need
// to sit in the emulator for 15 real minutes before this suite could observe
// it being recovered, which is impractical for CI. Because `.run()` executes
// the real handler in-process (not over HTTP to the separate
// Functions-emulator child process), this test can mock the global `Date.now`
// that recoverPendingUploads() reads to compute its cutoff, shifting the
// cutoff forward past the (really, just-created) file's real timeCreated --
// without touching STALE_THRESHOLD_MS or any other production code.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
jest.setTimeout(30000);

const config = {
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
};

const STALE_THRESHOLD_MS = 15 * 60 * 1000;

let db;
let bucket;
let scheduledPendingRecovery;

beforeAll(async () => {
  // A NAMED app for this test's own seeding/assertions -- deliberately not
  // "[DEFAULT]", so that dynamically importing the compiled
  // scheduled-pending-recovery.js below (whose app.js calls bare
  // initializeApp() with no name) doesn't collide with an already-existing
  // default app in this same module registry.
  let app;
  try {
    app = getApp("pending-recovery-regression-test");
  } catch {
    app = initializeApp(config, "pending-recovery-regression-test");
  }
  db = getFirestore(app);
  bucket = getStorage(app).bucket();

  ({ scheduledPendingRecovery } = await import("../../lib/scheduled-pending-recovery.js"));
});

async function seedPendingFile(experimentID, filename, data) {
  const storagePath = `pending-data/${experimentID}/${filename}_${Date.now()}`;
  const envelope = { experimentID, filename, data };
  const file = bucket.file(storagePath);
  await file.save(JSON.stringify(envelope), { contentType: "application/json" });
  return storagePath;
}

describe("10. scheduled-pending-recovery carries provider fields through for a gdrive experiment", () => {
  it("promotes a stale pending file for a gdrive experiment into uploadQueue with storageProvider + providerContainer set", async () => {
    const experimentID = `pending-recovery-gdrive-${randomUUID()}`;
    const filename = `case10-${randomUUID()}.json`;
    const owner = `pending-recovery-owner-${randomUUID()}`;
    const folderId = `folder-${randomUUID()}`;

    await db.collection("experiments").doc(experimentID).set({
      active: true,
      owner,
      storageProvider: "gdrive",
      providerContainer: { provider: "gdrive", folderId },
      // osfFilesLink deliberately absent -- a gdrive experiment has none.
    });

    await seedPendingFile(experimentID, filename, `[{"trial_type":"html-keyboard-response"}]`);

    // Shift the recovery pass's notion of "now" forward so its
    // STALE_THRESHOLD_MS cutoff falls after this file's real (just-now)
    // timeCreated, without waiting 15 real minutes.
    const realNow = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(realNow + STALE_THRESHOLD_MS + 5 * 60 * 1000);
    try {
      await scheduledPendingRecovery.run({});
    } finally {
      nowSpy.mockRestore();
    }

    const docId = `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
    const queueDoc = await db.collection("uploadQueue").doc(docId).get();
    expect(queueDoc.exists).toBe(true);

    const queueData = queueDoc.data();
    expect(queueData.experimentID).toBe(experimentID);
    expect(queueData.owner).toBe(owner);
    // The actual gap: promoteToQueue must pass these through, the same way
    // queue-upload.ts's callers in api-data.ts already do.
    expect(queueData.storageProvider).toBe("gdrive");
    expect(queueData.providerContainer).toEqual({ provider: "gdrive", folderId });
    expect(queueData.osfFilesLink).toBeUndefined();
  });
});
