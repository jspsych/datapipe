import { db, storage } from "./app.js";
import { mailCollection } from "./mail.js";
import { decrypt } from "./crypto-utils.js";
import { revokeGdriveToken } from "./providers/gdrive-oauth.js";
import { OAuth2AccountConnection } from "./providers/types.js";

// Everything that belongs to one researcher, removed in one pass.
//
// This exists because account deletion used to leave residue. The old
// implementation lived in on-user-deleted.ts and had defects that this
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
//   2. It deleted the experiment document but not its subcollections.
//      Deleting a Firestore document does not delete its subcollections, so
//      anything underneath -- `filenameClaims`, `compactionBatches`
//      (compaction.ts), `finalizationRuns` (finalization.ts), or whatever
//      gets added next -- would have outlived both the experiment and the
//      account. Fixed by enumerating each experiment's subcollections with
//      `listCollections()` rather than naming them one at a time, so a
//      subcollection nobody remembered to list here still gets deleted.
//
//   3. It deleted the `uploadQueue` Firestore documents but never the Cloud
//      Storage object each one points to (`storagePath`, written by
//      queue-upload.ts under `upload-queue/`). The document is the only
//      thing that names the object; delete it first and the encrypted
//      participant payload is orphaned in the bucket forever, with nothing
//      left to sweep it (scheduled-upload-retry.ts's cleanupOldEntries only
//      reaches the object through this same document). Fixed by deleting the
//      object before the document.
//
// Idempotent by construction: Firestore deletes of absent documents succeed,
// and the storage sweeps tolerate a missing object/prefix. That matters
// because both callers can run for the same uid -- deleteAccount purges and
// then deletes the auth record, which fires the onUserDeleted trigger, which
// purges again.
const BATCH_LIMIT = 500;

export interface PurgeCounts {
  experiments: number;
  filenameClaims: number;
  compactionBatches: number;
  finalizationRuns: number;
  // Any other experiment subcollection listCollections() turns up that isn't
  // one of the named ones above -- exists so a future subcollection nobody
  // remembers to name here still gets counted, not just deleted.
  otherExperimentSubcollections: number;
  metadata: number;
  logs: number;
  queueEntries: number;
  // Cloud Storage objects behind uploadQueue documents (upload-queue/{id},
  // queue-upload.ts), deleted before their Firestore document.
  queuePayloadObjects: number;
  // Live-sessions dashboard rows (functions/src/live-sessions.ts).
  liveSessions: number;
  pendingFiles: number;
  userDocument: number;
  // Contact-email additions (functions/src/mail.ts, lib/contact-email.js).
  mailDocuments: number;
  contactEmailVerification: number;
  // Whether a connected Google Drive grant was successfully revoked with
  // Google (see revokeGdriveToken, functions/src/providers/gdrive-oauth.ts).
  // Best-effort: false covers both "nothing to revoke" and "revocation
  // failed" -- either way it never blocks the rest of the purge.
  gdriveRevoked: boolean;
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
    compactionBatches: 0,
    finalizationRuns: 0,
    otherExperimentSubcollections: 0,
    metadata: 0,
    logs: 0,
    queueEntries: 0,
    queuePayloadObjects: 0,
    liveSessions: 0,
    pendingFiles: 0,
    userDocument: 0,
    mailDocuments: 0,
    contactEmailVerification: 0,
    gdriveRevoked: false,
  };

  const ownedExperiments = await db
    .collection("experiments")
    .where("owner", "==", uid)
    .get();

  const experimentIds = ownedExperiments.docs.map((doc) => doc.id);

  for (const experimentId of experimentIds) {
    const experimentRef = db.collection("experiments").doc(experimentId);

    // Subcollections first: once the parent document is gone they are
    // unreachable through the console but still billable and still returned
    // by collection-group queries. Enumerated rather than named one at a
    // time so a subcollection this list doesn't know about (today or in the
    // future) still gets swept.
    const subcollections = await experimentRef.listCollections();
    for (const subcollection of subcollections) {
      const docs = await subcollection.get();
      const deleted = await deleteInBatches(docs.docs.map((doc) => doc.ref));
      switch (subcollection.id) {
        case "filenameClaims":
          counts.filenameClaims += deleted;
          break;
        case "compactionBatches":
          counts.compactionBatches += deleted;
          break;
        case "finalizationRuns":
          counts.finalizationRuns += deleted;
          break;
        default:
          counts.otherExperimentSubcollections += deleted;
      }
    }

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

  // Delete the encrypted Cloud Storage payload behind each entry BEFORE the
  // Firestore document that names it: storagePath is only reachable through
  // this document, so deleting the document first orphans the object forever
  // (see the module header). Best-effort per object -- a missing object is
  // success (ignoreNotFound), and a transient failure is logged and does not
  // abort the purge, matching how the pending-data sweep above and
  // scheduled-upload-retry.ts's cleanupOldEntries both treat this same
  // bucket.
  for (const doc of queued.docs) {
    const storagePath = doc.data().storagePath as string | undefined;
    if (!storagePath) continue;
    try {
      await storage.bucket().file(storagePath).delete({ ignoreNotFound: true });
      counts.queuePayloadObjects += 1;
    } catch (e) {
      console.warn(
        `purgeUserData: failed to delete upload-queue payload ${storagePath} for ${uid}:`,
        e instanceof Error ? e.message : "Unknown error"
      );
    }
  }

  counts.queueEntries = await deleteInBatches(queued.docs.map((doc) => doc.ref));

  // liveSessions is keyed by a hash of a session id and carries the owner, so
  // it is found the same way. Short-lived -- each is deleted when its session
  // ends -- but a researcher deleting their account mid-study must not leave
  // rows behind naming their uid.
  const live = await db
    .collection("liveSessions")
    .where("owner", "==", uid)
    .get();
  counts.liveSessions = await deleteInBatches(live.docs.map((doc) => doc.ref));

  // mail/ docs carry the researcher's contactEmail in their `to` field and are
  // otherwise keyed by an autoId, so datapipe.owner == uid (an automatic
  // single-field index -- see mail.ts's MailMeta) is the only way to find
  // them. Deleting these is why account deletion must not leave an address
  // behind: an undelivered or already-processed mail document is still a
  // record of where DataPipe last tried to reach this person.
  const queuedMail = await mailCollection()
    .where("datapipe.owner", "==", uid)
    .get();
  counts.mailDocuments = await deleteInBatches(
    queuedMail.docs.map((doc) => doc.ref)
  );

  // contactEmailVerifications/{uid} holds a hash of the researcher's
  // in-flight verification code (functions/src/mail.ts's sibling, the
  // server-only collection the plan describes at §2.2). Doc id is the uid
  // itself, so this is a direct lookup, not a query.
  const verificationRef = db.collection("contactEmailVerifications").doc(uid);
  if ((await verificationRef.get()).exists) {
    await verificationRef.delete();
    counts.contactEmailVerification = 1;
  }

  // Last: the user document holds connectedAccounts, i.e. the storage
  // provider credentials. If an earlier step throws, the researcher still
  // owns a coherent account.
  const userDocRef = db.collection("users").doc(uid);
  const userSnap = await userDocRef.get();
  if (userSnap.exists) {
    // Best-effort: tell Google the grant is done with before the document
    // that names it is gone. Revocation failing (network blip, already-
    // revoked token) must not stop the account from being deleted -- an
    // un-revoked grant the researcher can still clear from
    // myaccount.google.com/permissions is a far smaller problem than a
    // deletion request that silently does nothing.
    const gdriveConnection = userSnap.data()?.connectedAccounts?.gdrive as
      | OAuth2AccountConnection
      | undefined;
    if (gdriveConnection?.encryptedRefreshToken) {
      try {
        const refreshToken = decrypt(gdriveConnection.encryptedRefreshToken);
        const result = await revokeGdriveToken(refreshToken);
        counts.gdriveRevoked = result.ok;
      } catch (e) {
        console.warn(
          `purgeUserData: failed to revoke gdrive grant for ${uid}:`,
          e instanceof Error ? e.message : "Unknown error"
        );
      }
    }

    await userDocRef.delete();
    counts.userDocument = 1;
  }

  return counts;
}
