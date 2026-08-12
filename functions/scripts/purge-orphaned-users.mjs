// Find and remove data belonging to accounts that no longer exist in Firebase
// Auth.
//
// WHY THIS EXISTS
//
// Account deletion used to run client-side: deleteUser(auth.currentUser)
// destroyed the Auth record first, and cleanup hung off the onUserDeleted
// trigger afterwards. When that cleanup did not run, or ran against a stale
// users/{uid}.experiments array, the data outlived the account with no owner
// left to notice. datapipe-test carries the proof -- two users/ documents and
// two experiments (one of them still `active`) belonging to uids that have no
// Auth record.
//
// An orphaned experiment is not inert. It still resolves in /api/data, and
// api-data.ts persists the submission to Cloud Storage BEFORE it checks that
// the owner exists, so every submission to an orphan leaves a file behind and
// then answers 400. That accrues storage indefinitely for a study nobody owns.
//
// functions/src/delete-account.ts fixes the ordering going forward (purge
// first, delete the Auth record last). This script cleans up what the old
// order already left behind. It should need to be run once per project.
//
// Usage:
//   node functions/scripts/purge-orphaned-users.mjs             # dry run, changes nothing
//   node functions/scripts/purge-orphaned-users.mjs --apply     # actually deletes
//
// Env:
//   GOOGLE_APPLICATION_CREDENTIALS  service-account key with Firebase Admin access
//   FIREBASE_PROJECT_ID             (optional) overrides the credential's project
//
// SAFETY: an account is treated as orphaned only when getUser(uid) raises
// auth/user-not-found. Any other error -- rate limit, transport failure,
// permission problem -- is reported as `undetermined` and skipped, because
// mistaking a live account for a dead one here would delete a researcher's
// study.

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const apply = process.argv.includes("--apply");

const projectId = process.env.FIREBASE_PROJECT_ID;
initializeApp({
  credential: applicationDefault(),
  ...(projectId ? { projectId } : {}),
  storageBucket: `${projectId || ""}.appspot.com`,
});

const auth = getAuth();
const db = getFirestore();
const bucket = getStorage().bucket();

async function authRecordState(uid) {
  try {
    await auth.getUser(uid);
    return "live";
  } catch (e) {
    if (e?.errorInfo?.code === "auth/user-not-found") return "missing";
    console.warn(`  ! could not resolve ${uid}: ${e?.message || e}`);
    return "undetermined";
  }
}

// Every uid that owns something, whether or not it still has a users/ doc.
// Collected from both directions because the two can disagree -- that
// disagreement is the bug.
async function collectCandidateUids() {
  const uids = new Set();
  const userDocs = await db.collection("users").get();
  for (const doc of userDocs.docs) uids.add(doc.id);
  const experiments = await db.collection("experiments").get();
  for (const doc of experiments.docs) {
    const owner = doc.data().owner;
    if (owner) uids.add(owner);
  }
  return [...uids];
}

async function describe(uid) {
  const owned = await db
    .collection("experiments")
    .where("owner", "==", uid)
    .get();
  const queued = await db
    .collection("uploadQueue")
    .where("owner", "==", uid)
    .get();
  const userDoc = await db.collection("users").doc(uid).get();

  let pendingFiles = 0;
  for (const doc of owned.docs) {
    const [files] = await bucket.getFiles({
      prefix: `pending-data/${doc.id}/`,
    });
    pendingFiles += files.length;
  }

  return {
    experiments: owned.docs.map((d) => ({
      id: d.id,
      title: d.data().title,
      active: d.data().active === true,
    })),
    queueEntries: queued.size,
    pendingFiles,
    email: userDoc.exists ? userDoc.data().email : "(no users/ document)",
  };
}

async function purge(uid, summary) {
  const batch = db.batch();
  for (const exp of summary.experiments) {
    const claims = await db
      .collection("experiments")
      .doc(exp.id)
      .collection("filenameClaims")
      .get();
    for (const claim of claims.docs) batch.delete(claim.ref);

    const [files] = await bucket.getFiles({ prefix: `pending-data/${exp.id}/` });
    for (const file of files) await file.delete({ ignoreNotFound: true });

    batch.delete(db.collection("experiments").doc(exp.id));
    batch.delete(db.collection("metadata").doc(exp.id));
    batch.delete(db.collection("logs").doc(exp.id));
  }
  const queued = await db
    .collection("uploadQueue")
    .where("owner", "==", uid)
    .get();
  for (const doc of queued.docs) batch.delete(doc.ref);
  batch.delete(db.collection("users").doc(uid));
  await batch.commit();
}

const report = { orphaned: [], live: 0, undetermined: [] };

const candidates = await collectCandidateUids();
console.log(
  `${apply ? "APPLY" : "DRY RUN"}: checking ${candidates.length} uid(s)\n`
);

for (const uid of candidates) {
  const state = await authRecordState(uid);
  if (state === "live") {
    report.live += 1;
    continue;
  }
  if (state === "undetermined") {
    report.undetermined.push(uid);
    continue;
  }

  const summary = await describe(uid);
  report.orphaned.push({ uid, ...summary });

  console.log(`ORPHAN ${uid}  (${summary.email})`);
  for (const exp of summary.experiments) {
    console.log(
      `    experiment ${exp.id} "${exp.title}"${exp.active ? "  [ACTIVE - still accepting data]" : ""}`
    );
  }
  if (summary.queueEntries) console.log(`    ${summary.queueEntries} queue entries`);
  if (summary.pendingFiles) console.log(`    ${summary.pendingFiles} pending files`);

  if (apply) {
    await purge(uid, summary);
    console.log("    purged");
  }
  console.log("");
}

console.log("---");
console.log(`live accounts:      ${report.live}`);
console.log(`orphaned accounts:  ${report.orphaned.length}`);
console.log(
  `  experiments:      ${report.orphaned.reduce((n, o) => n + o.experiments.length, 0)}` +
    ` (${report.orphaned.reduce((n, o) => n + o.experiments.filter((e) => e.active).length, 0)} active)`
);
console.log(
  `  pending files:    ${report.orphaned.reduce((n, o) => n + o.pendingFiles, 0)}`
);
console.log(`undetermined:       ${report.undetermined.length}`);
if (report.undetermined.length) {
  console.log(`  ${report.undetermined.join("\n  ")}`);
}
if (!apply && report.orphaned.length) {
  console.log("\nNothing was changed. Re-run with --apply to delete.");
}
