import { db, storage } from "./app.js";

// Everything that belongs to one researcher, removed in one pass.
//
// This exists because account deletion used to leave residue. The old
// implementation lived in on-user-deleted.ts and had two defects that this
// module fixes:
//
//   1. It found experiments through `users/{uid}.experiments`, an array the
//      client maintains. When that array drifts, the experiment survives its
//      owner -- and a surviving experiment is the dangerous kind of orphan,
//      not a harmless one. api-data.ts writes the submission to Cloud Storage
//      (persistPending) BEFORE it checks that the owner still exists, so a
//      still-`active` orphan accepts and stores a file on every submission
//      and then answers 400. Querying `where owner == uid` cannot drift.
//
//   2. It deleted the experiment document but not the `filenameClaims`
//      subcollection underneath it. Deleting a Firestore document does not
//      delete its subcollections; the claims would have outlived both the
//      experiment and the account.
//
// Idempotent by construction: Firestore deletes of absent documents succeed,
// and the storage sweep tolerates a missing prefix. That matters because both
// callers can run for the same uid -- deleteAccount purges and then deletes
// the auth record, which fires the onUserDeleted trigger, which purges again.
const BATCH_LIMIT = 500;

export interface PurgeCounts {
  experiments: number;
  filenameClaims: number;
  metadata: number;
  logs: number;
  queueEntries: number;
  pendingFiles: number;
  userDocument: number;
}

async function deleteInBatches(
  refs: FirebaseFirestore.DocumentReference[]
): Promise<number> {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
  return refs.length;
}

/**
 * Remove every Firestore document and Cloud Storage object belonging to `uid`.
 *
 * Deliberately does NOT touch the Firebase Auth record. Callers order that
 * themselves, and the order is load-bearing: purge first, delete the auth
 * record last. Deleting the account first and then failing mid-purge would
 * leave data with no owner and no way for the researcher to sign back in and
 * retry -- the exact state this module is meant to prevent.
 */
export async function purgeUserData(uid: string): Promise<PurgeCounts> {
  const counts: PurgeCounts = {
    experiments: 0,
    filenameClaims: 0,
    metadata: 0,
    logs: 0,
    queueEntries: 0,
    pendingFiles: 0,
    userDocument: 0,
  };

  const ownedExperiments = await db
    .collection("experiments")
    .where("owner", "==", uid)
    .get();

  const experimentIds = ownedExperiments.docs.map((doc) => doc.id);

  for (const experimentId of experimentIds) {
    // Subcollection first: once the parent document is gone the claims are
    // unreachable through the console but still billable and still returned
    // by collection-group queries.
    const claims = await db
      .collection("experiments")
      .doc(experimentId)
      .collection("filenameClaims")
      .get();
    counts.filenameClaims += await deleteInBatches(
      claims.docs.map((doc) => doc.ref)
    );

    // Submissions that were persisted but never uploaded. Left behind, these
    // are replayed by scheduledPendingRecovery forever.
    const [pendingFiles] = await storage
      .bucket()
      .getFiles({ prefix: `pending-data/${experimentId}/` });
    for (const file of pendingFiles) {
      await file.delete({ ignoreNotFound: true });
    }
    counts.pendingFiles += pendingFiles.length;
  }

  counts.experiments = await deleteInBatches(
    ownedExperiments.docs.map((doc) => doc.ref)
  );

  // metadata/ and logs/ are keyed by experiment id, not by uid.
  counts.metadata = await deleteInBatches(
    experimentIds.map((id) => db.collection("metadata").doc(id))
  );
  counts.logs = await deleteInBatches(
    experimentIds.map((id) => db.collection("logs").doc(id))
  );

  // uploadQueue is keyed by its own id and carries the owner as a field, so it
  // has to be queried separately -- an entry can outlive the experiment it
  // came from.
  const queued = await db
    .collection("uploadQueue")
    .where("owner", "==", uid)
    .get();
  counts.queueEntries = await deleteInBatches(queued.docs.map((doc) => doc.ref));

  // Last: the user document holds connectedAccounts, i.e. the storage
  // provider credentials. If an earlier step throws, the researcher still
  // owns a coherent account.
  const userDocRef = db.collection("users").doc(uid);
  if ((await userDocRef.get()).exists) {
    await userDocRef.delete();
    counts.userDocument = 1;
  }

  return counts;
}
