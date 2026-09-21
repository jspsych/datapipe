// Give every existing logs/{experimentID} document the `owner` and
// `storageProvider` fields it should always have had.
//
// WHY THIS EXISTS
//
// firestore.rules gates log reads on:
//
//     allow read: if request.auth.uid != null && resource.data.owner == request.auth.uid;
//
// but functions/src/write-log.ts never wrote an `owner` field -- not in any
// revision, from the day the rule was added. The rule therefore could not
// pass for any document in the collection, the dashboard's logs/{id}
// subscription failed silently, and components/dashboard/ErrorPanel.js never
// rendered for anyone. Researchers have never been able to see their own
// rejected submissions.
//
// write-log.ts now writes `owner` (and `storageProvider`) on every log write,
// and create-experiment.ts seeds both when an experiment is created. That
// fixes every experiment that receives another request. It does NOT fix an
// experiment that is finished, paused, or simply idle -- its log document sits
// there with counters and errors that its owner still cannot read. This script
// is for those. It should need to be run once per project.
//
// Usage:
//   node functions/scripts/backfill-log-owner.mjs             # dry run, changes nothing
//   node functions/scripts/backfill-log-owner.mjs --apply     # actually writes
//
// Env:
//   GOOGLE_APPLICATION_CREDENTIALS  service-account key with Firebase Admin access
//   FIREBASE_PROJECT_ID             (optional) overrides the credential's project
//
// SAFETY: the owner is taken from experiments/{id}.owner -- the same field the
// rest of the codebase treats as authoritative -- and written with a merge, so
// nothing else in the document is touched. A log document whose experiment no
// longer exists is reported as `orphaned` and left alone: there is no owner to
// infer, and inventing one would hand somebody else's uid a document. A log
// document that already has an owner is skipped rather than overwritten, so
// re-running this is a no-op.

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");

const projectId = process.env.FIREBASE_PROJECT_ID;
initializeApp({
  credential: applicationDefault(),
  ...(projectId ? { projectId } : {}),
});

const db = getFirestore();

// Firestore caps a batch at 500 operations.
const BATCH_LIMIT = 500;

async function main() {
  console.log(apply ? "MODE: apply (writes)" : "MODE: dry run (no writes)");

  const logsSnap = await db.collection("logs").get();
  console.log(`logs documents: ${logsSnap.size}`);

  const pending = [];
  const counts = { alreadyOwned: 0, orphaned: 0, providerOnly: 0, toFix: 0 };

  for (const logDoc of logsSnap.docs) {
    const log = logDoc.data() || {};

    const expSnap = await db.collection("experiments").doc(logDoc.id).get();
    if (!expSnap.exists) {
      counts.orphaned += 1;
      console.log(`  orphaned: logs/${logDoc.id} (no matching experiment)`);
      continue;
    }
    const exp = expSnap.data() || {};

    // Both fields are considered independently: an experiment created before
    // the provider migration has no storageProvider to copy, and a log
    // document written by the new write-log.ts already has an owner but may
    // predate the provider field on its experiment.
    const update = {};
    if (!log.owner && exp.owner) update.owner = exp.owner;
    if (!log.storageProvider && exp.storageProvider) {
      update.storageProvider = exp.storageProvider;
    }

    if (Object.keys(update).length === 0) {
      counts.alreadyOwned += 1;
      continue;
    }
    if (!update.owner) counts.providerOnly += 1;

    counts.toFix += 1;
    pending.push({ ref: logDoc.ref, update });
    console.log(`  fix: logs/${logDoc.id} <- ${JSON.stringify(update)}`);
  }

  console.log("");
  console.log(`already complete: ${counts.alreadyOwned}`);
  console.log(`orphaned (skipped): ${counts.orphaned}`);
  console.log(`to update: ${counts.toFix} (of which provider-only: ${counts.providerOnly})`);

  if (!apply) {
    console.log("");
    console.log("Dry run. Re-run with --apply to write these changes.");
    return;
  }

  let written = 0;
  for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const { ref, update } of pending.slice(i, i + BATCH_LIMIT)) {
      batch.set(ref, update, { merge: true });
    }
    await batch.commit();
    written += Math.min(BATCH_LIMIT, pending.length - i);
    console.log(`committed ${written}/${pending.length}`);
  }

  console.log("");
  console.log(`done: ${written} log documents updated`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
