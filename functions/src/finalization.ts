// Finalization: the end-of-study, PERMANENT pass that merges every remaining
// provider file into ONE archive carrying the whole Psych-DS tree
// (docs/finalization-spec.md). Structurally compactExperiment
// (compaction.ts) with a different selection rule and one irreversible extra
// step: once the merge is verified and sealed, the experiment is marked
// finalized and stops accepting submissions (see the guard this adds to
// api-data.ts / api-base64.ts).
//
// THE ORDERING RULE, unchanged from compaction.ts and just as load-bearing
// here: upload the archive, verify the checksum the provider reports back,
// seal the claims, and only THEN delete the originals. Never the reverse.
// DataPipe keeps no copy of submitted data, so a delete that runs before a
// verified upload is unrecoverable loss.
//
// WHY ONE ARCHIVE: multiple final archives break the Psych-DS compatibility
// this feature exists to produce (finalization-spec.md, decision 2). The
// merge streams straight to Cloud Storage via buildArchiveToStorage and is
// uploaded to the provider via writeStreamedFile, so its size is never bounded
// by function memory -- only by the provider's own hard per-file limit
// (capabilities.maxFileSizeBytes). This refuses to exceed that limit rather
// than silently splitting across multiple archives; splitting is out of scope
// for this pass (see finalization-spec.md's Phase 2 note on why the memory
// ceiling, not the provider ceiling, was the thing worth removing).
//
// CRASH SAFETY, same hinge as compactionBatches: a `finalizationRuns/current`
// record is written -- with the merged archive's expected md5 and every
// member's hash, never a raw filename (collision-cache.ts's "the raw filename
// is never stored anywhere" property) -- BEFORE the provider upload is
// attempted. An interrupted pass resumes from that record instead of
// re-merging (which would double the archive's contents) or, if the upload
// never landed, discards it and starts clean.

import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db, storage } from "./app.js";
import { getProvider } from "./providers/index.js";
import { StorageProvider, ContainerRef, ResolvedAuth, FileRef } from "./providers/types.js";
import { ExperimentData, UserData } from "./interfaces.js";
import resolveToken from "./resolve-token.js";
import { getSalt, claimDocId, sealClaimHashes } from "./collision-cache.js";
import { readArchive } from "./archive-reader.js";
import {
  buildArchiveToStorage,
  checksumMatches,
  archivePathsFor,
  isArchiveName,
  acquireLease,
  releaseLease,
} from "./compaction.js";

// Fixed name, unlike compaction's numbered datapipe-batch-NNNN.zip: the
// compaction lease this reuses guarantees at most one finalization pass is
// ever in flight for an experiment (see acquireLease), and finalization runs
// at most once ever (a second attempt refuses at "already-finalized"), so
// there is never more than one merged archive to name.
const FINAL_ARCHIVE_NAME = "datapipe-final.zip";

// dataset_description.json goes INSIDE the merged archive AND stays loose on
// the record. Both, deliberately.
//
// Inside, because Psych-DS requires it at the dataset root. The merged archive
// IS the dataset -- it is the only place the data/raw/... tree exists, since
// Zenodo cannot store a slash in a key. An archive without the descriptor is
// not a valid Psych-DS dataset, and neither is the record around it, whose
// data is sealed in a zip. Leaving it only on the outside produced an artifact
// that validated in neither view: half the spec met by unzipping and half by
// not.
//
// Loose, because the record should still show a human-readable descriptor
// without anyone downloading an archive, and because metadata-block.ts holds a
// metadataFileRef to that object.
//
// Duplicating it is safe here specifically because finalization is TERMINAL:
// the experiment stops accepting submissions, so nothing can update one copy
// and leave the other stale. That would not be safe during collection, which
// is why compaction still keeps it strictly out of its batches
// (NEVER_ARCHIVE in compaction.ts).
const KEEP_LOOSE_AFTER_MERGE = new Set(["dataset_description.json"]);

export interface FinalizationResult {
  // Carried on every result the same way CompactionResult carries it, so log
  // lines and test assertions stay attributable without the caller having to
  // hold the id separately.
  experimentID: string;
  status:
    | "finalized"
    | "already-finalized"
    | "not-eligible"
    | "leased-elsewhere"
    // No collision-cache salt means nothing has ever been submitted through
    // DataPipe -- mirrors compaction's identical "nothing-to-archive" for the
    // identical reason (see runCompaction).
    | "nothing-to-archive"
    // Something is still sitting in uploadQueue for this experiment. That
    // data belongs INSIDE the merge -- finalizeExperiment only ever looks at
    // what the provider currently lists, which a queued entry is by
    // definition not part of yet -- so the correct move is to wait for the
    // queue to drain, not seal a record that is missing it.
    | "queued-uploads-pending"
    // The merged archive is bigger than the provider's hard per-file limit.
    // Splitting is a last resort this pass does not implement (see the module
    // header) -- nothing has been uploaded or deleted, so this is always safe
    // to retry once the provider's own limit is what's addressed, e.g. by
    // migrating to a provider with a higher (or no) cap.
    | "archive-too-large"
    | "failed";
  archived?: number;
  archiveName?: string;
  detail?: string;
}

function experimentRef(experimentID: string) {
  return db.collection("experiments").doc(experimentID);
}

// Fixed doc id -- see FINAL_ARCHIVE_NAME above for why only one run can ever
// be in flight or ever needs to exist.
function finalizationRunRef(experimentID: string) {
  return experimentRef(experimentID).collection("finalizationRuns").doc("current");
}

interface FinalizationRecord {
  archiveName: string;
  // The Cloud Storage object buildArchiveToStorage wrote the merge to.
  // Recorded so a resumed pass (or the cleanup after a normal one) can find
  // and remove it without having to reconstruct the path from convention.
  storagePath: string;
  status: "uploading" | "sealed";
  memberHashes: string[];
  expectedMd5: string;
  fileCount: number;
  createdAt: Timestamp;
  sealedAt?: Timestamp;
}

function storagePathFor(experimentID: string): string {
  return `finalization/${experimentID}/${FINAL_ARCHIVE_NAME}`;
}

async function deleteStorageObject(storagePath: string): Promise<void> {
  await storage
    .bucket()
    .file(storagePath)
    .delete()
    .catch(() => undefined); // best-effort scratch cleanup; a leftover temp object is harmless
}

/**
 * Finalizes one experiment. Safe to call on anything -- it self-selects and
 * returns a status rather than throwing for the ordinary "not applicable"
 * cases, same convention as compactExperiment.
 */
export async function finalizeExperiment(experimentID: string): Promise<FinalizationResult> {
  return { ...(await runFinalization(experimentID)), experimentID };
}

async function runFinalization(experimentID: string): Promise<Omit<FinalizationResult, "experimentID">> {
  const expSnap = await experimentRef(experimentID).get();
  if (!expSnap.exists) {
    return { status: "not-eligible", detail: "experiment does not exist" };
  }
  const expData = expSnap.data() as ExperimentData;
  const sessionsSeen = expData.sessions ?? 0;

  // Permanent, and checked before anything else that might otherwise look
  // like grounds to proceed -- see the finalized field's doc comment in
  // interfaces.ts.
  if (expData.finalized === true) {
    return { status: "already-finalized" };
  }

  if (!expData.storageProvider || !expData.providerContainer) {
    return { status: "not-eligible", detail: "legacy experiment with no provider container" };
  }

  let provider: StorageProvider;
  try {
    provider = getProvider(expData.storageProvider);
  } catch {
    return { status: "not-eligible", detail: `unknown provider ${expData.storageProvider}` };
  }

  // Same eligibility contract as compaction's: a non-null maxFileCount is
  // what makes a provider's flat keyspace need this archive-of-record in the
  // first place (see compaction.ts's header, "where the Psych-DS directory
  // structure lives"), and it is the contract that deleteFile/
  // downloadFileBytes also exist. writeStreamedFile is finalization's own
  // extra requirement, since the merge is uploaded from a stream rather than
  // a Buffer.
  if (provider.capabilities.maxFileCount === null) {
    return { status: "not-eligible", detail: "provider has no file-count cap" };
  }
  if (!provider.deleteFile || !provider.downloadFileBytes || !provider.writeStreamedFile) {
    return {
      status: "not-eligible",
      detail: `provider ${provider.id} declares maxFileCount but implements no deleteFile/downloadFileBytes/writeStreamedFile`,
    };
  }

  const salt = await getSalt(experimentID);
  if (!salt) {
    return { status: "nothing-to-archive", detail: "experiment has no collision-cache salt" };
  }

  // A queued upload (still retrying after a provider hiccup, or waiting out
  // this very lease via the write gate -- compaction-gate.ts) belongs INSIDE
  // the merge. finalizeExperiment only ever looks at provider.listFiles, which
  // a queued entry is by definition not part of yet, so proceeding here would
  // strand that data outside the sealed record -- not through any race, just
  // because the check never looked. Checked BEFORE the lease is taken (a
  // pending/processing entry means there is real work left to do, so there is
  // nothing this pass could usefully hold) and it also shrinks the race this
  // module's own lease can otherwise create (see scheduled-upload-retry.ts's
  // matching `finalized` guard for the remaining sliver: an entry that gets
  // queued in the gap between this check and the provider write below).
  const pendingQueue = await db
    .collection("uploadQueue")
    .where("experimentID", "==", experimentID)
    .where("status", "in", ["pending", "processing"])
    .get();
  if (!pendingQueue.empty) {
    return {
      status: "queued-uploads-pending",
      detail: `${pendingQueue.size} upload(s) for this experiment are still queued; finalize once the queue has drained`,
    };
  }

  if (!(await acquireLease(experimentID))) {
    return { status: "leased-elsewhere" };
  }

  try {
    const userSnap = await db.collection("users").doc(expData.owner).get();
    if (!userSnap.exists) {
      await releaseLease(experimentID, sessionsSeen);
      return { status: "failed", detail: "owner record missing" };
    }
    const tokenResult = await resolveToken(userSnap.data() as UserData, expData);
    if (!tokenResult.success) {
      await releaseLease(experimentID, sessionsSeen, { "compaction.lastError": tokenResult.error });
      return { status: "failed", detail: `token resolution failed: ${tokenResult.error}` };
    }
    const auth: ResolvedAuth = { token: tokenResult.token, serverUrl: tokenResult.serverUrl };
    const container = expData.providerContainer as ContainerRef;

    const files = await provider.listFiles(auth, container);

    // Resume before anything else -- an interrupted pass may already have a
    // verified (or even sealed) merge sitting on the provider, and re-merging
    // would double its contents. Same precedence compactExperiment gives
    // resumeInterruptedBatch.
    const resumed = await resumeInterruptedFinalization(experimentID, provider, auth, container, files, salt);
    if (resumed) {
      await markFinalized(experimentID, sessionsSeen);
      return {
        status: "finalized",
        archived: resumed.archived,
        archiveName: resumed.archiveName,
        detail: resumed.detail,
      };
    }

    // Everything goes into the archive; only some of it is then removed from
    // the record. See KEEP_LOOSE_AFTER_MERGE.
    const members = files;
    const removable = files.filter((file) => !KEEP_LOOSE_AFTER_MERGE.has(file.name));

    if (removable.length === 0) {
      // Nothing was ever collected beyond the descriptor -- finalizing is
      // still the correct terminal state (the study is over either way), just
      // with no archive to build.
      await markFinalized(experimentID, sessionsSeen);
      return {
        status: "finalized",
        archived: 0,
        detail: "nothing to merge; the experiment had no provider files besides dataset_description.json",
      };
    }

    const looseMembers = members.filter((file) => !isArchiveName(file.name));
    const loosePaths = archivePathsFor(
      provider,
      expData.metadataActive === true,
      looseMembers.map((file) => file.name)
    );

    const storagePath = storagePathFor(experimentID);
    let build: { size: number; md5: string };
    try {
      build = await buildArchiveToStorage(mergeEntries(provider, auth, container, members, loosePaths), storagePath);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await deleteStorageObject(storagePath);
      await releaseLease(experimentID, sessionsSeen, {
        "compaction.lastError": `failed to build merged archive: ${detail}`,
      });
      return { status: "failed", detail: `failed to build merged archive: ${detail}` };
    }

    const maxFileSizeBytes = provider.capabilities.maxFileSizeBytes;
    if (maxFileSizeBytes !== null && build.size > maxFileSizeBytes) {
      await deleteStorageObject(storagePath);
      const detail =
        `merged archive is ${build.size} bytes, over ${provider.id}'s ${maxFileSizeBytes}-byte ` +
        `per-file limit; splitting into multiple final archives is not implemented`;
      await releaseLease(experimentID, sessionsSeen, { "compaction.lastError": detail });
      return { status: "archive-too-large", detail };
    }

    // Hashes cover only what is actually leaving the listing. The descriptor
    // stays loose, so a cold cache still rehydrates its claim normally and it
    // needs no sealing.
    const memberHashes = removable.map((file) => claimDocId(salt, file.name));
    const runRef = finalizationRunRef(experimentID);

    // Recorded BEFORE the provider upload -- this is the crash-safety hinge.
    // If the function dies between here and the delete step, the next pass
    // finds this document and either resumes (upload already verified) or
    // discards it and re-merges (upload never landed), rather than trusting a
    // half-finished attempt.
    await runRef.set({
      archiveName: FINAL_ARCHIVE_NAME,
      storagePath,
      status: "uploading",
      memberHashes,
      expectedMd5: build.md5,
      fileCount: removable.length,
      createdAt: Timestamp.now(),
    });

    const uploaded = await putVerifiedFinalizationArchive(provider, auth, container, storagePath, build.size, build.md5);
    if (!uploaded.ok) {
      await runRef.delete();
      await deleteStorageObject(storagePath);
      await releaseLease(experimentID, sessionsSeen, { "compaction.lastError": uploaded.detail });
      return { status: "failed", detail: uploaded.detail };
    }

    // Everything in the merge is now inside a verified archive on the
    // provider, so the originals can go.
    await sealAndDeleteMembers(experimentID, provider, auth, container, runRef, memberHashes, removable);
    await deleteStorageObject(storagePath);

    await markFinalized(experimentID, sessionsSeen);

    return { status: "finalized", archived: removable.length, archiveName: FINAL_ARCHIVE_NAME };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await releaseLease(experimentID, sessionsSeen, { "compaction.lastError": detail }).catch(() => undefined);
    return { status: "failed", detail };
  }
}

/**
 * Marks the experiment permanently finalized and releases the lease in the
 * same write. `compaction.lastError` is cleared the way a successful
 * compaction pass clears it -- a stale error from an earlier attempt should
 * not linger once the pass it belongs to has actually succeeded.
 */
async function markFinalized(experimentID: string, sessionsSeen: number): Promise<void> {
  await releaseLease(experimentID, sessionsSeen, {
    finalized: true,
    finalizedAt: Timestamp.now(),
    "compaction.lastError": FieldValue.delete(),
  });
}

/**
 * Lazily re-emits every member's content at its Psych-DS path, one member at
 * a time -- fed straight into buildArchiveToStorage, which drains it exactly
 * that way (see its own header). A batch archive's members are re-emitted at
 * the paths recorded INSIDE it (readArchive returns exactly those), never
 * recomputed, because archivePathsFor was already applied once when the batch
 * was built; a loose file's path is looked up in `loosePaths`, computed for
 * the whole loose set up front so its own collision-avoidance (see
 * archivePathsFor in compaction.ts) sees every loose name at once.
 */
async function* mergeEntries(
  provider: StorageProvider,
  auth: ResolvedAuth,
  container: ContainerRef,
  members: FileRef[],
  loosePaths: Map<string, string>
): AsyncIterable<{ path: string; content: Buffer }> {
  const seenPaths = new Set<string>();

  // A path collision across two DIFFERENT source members (a batch built at
  // one time and a loose file claimed at another, say) cannot happen under
  // any archivePathFor DataPipe ships, but two zip members at one path is
  // silent corruption -- the same defensive fallback archivePathsFor takes,
  // just scoped across the whole merge rather than one provider's listing.
  const claimPath = (candidate: string, originName: string): string => {
    if (!seenPaths.has(candidate)) {
      seenPaths.add(candidate);
      return candidate;
    }
    const fallback = `${originName}__${candidate}`;
    seenPaths.add(fallback);
    return fallback;
  };

  for (const member of members) {
    const download = await provider.downloadFileBytes!(auth, container, member);
    if (!download.success) {
      throw new Error(
        `failed to download "${member.name}" while merging: ${download.providerMessage ?? download.error}`
      );
    }

    if (isArchiveName(member.name)) {
      // A batch archive: unpack it (readArchive verifies each member's CRC-32
      // and uncompressed size before handing it back -- see archive-reader.ts)
      // and re-emit its contents at their recorded paths, rather than nesting
      // the zip itself inside the merge.
      let inner: Map<string, Buffer>;
      try {
        inner = readArchive(download.content);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(`batch archive "${member.name}" could not be read while merging: ${detail}`);
      }
      for (const [path, content] of inner) {
        yield { path: claimPath(path, member.name), content };
      }
    } else {
      const path = loosePaths.get(member.name) ?? member.name;
      yield { path: claimPath(path, member.name), content: download.content };
    }
  }
}

/**
 * Uploads the merged archive from its Cloud Storage temp object and confirms
 * the provider stored exactly the bytes buildArchiveToStorage wrote --
 * putVerifiedArchive's (compaction.ts) streaming sibling. A mismatch removes
 * the provider-side object rather than leaving something that could later be
 * mistaken for a verified merge.
 *
 * This is the gate the delete in runFinalization depends on: an unverified
 * upload must never authorize removing the sessions that went into it.
 */
async function putVerifiedFinalizationArchive(
  provider: StorageProvider,
  auth: ResolvedAuth,
  container: ContainerRef,
  storagePath: string,
  size: number,
  md5: string
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const body = storage.bucket().file(storagePath).createReadStream();
  const write = await provider.writeStreamedFile!(auth, container, FINAL_ARCHIVE_NAME, body, size, {
    size,
    contentType: "application/zip",
  });
  if (!write.success) {
    return { ok: false, detail: `merged archive upload failed: ${write.providerMessage ?? write.error}` };
  }
  if (!checksumMatches(write.fileRef.checksum, md5)) {
    await provider.deleteFile!(auth, container, { name: FINAL_ARCHIVE_NAME });
    return {
      ok: false,
      detail: `merged archive checksum mismatch (reported ${write.fileRef.checksum ?? "nothing"})`,
    };
  }
  return { ok: true };
}

/**
 * Seals the merge's claims, then deletes the loose/archived originals --
 * sealAndDelete's (compaction.ts) sibling, recording against the
 * finalizationRuns doc instead of a compactionBatches one. Order is the same
 * and for the same reason: sealing first means an interruption during the
 * deletes still leaves every remaining original protected from being
 * re-merged, and its filename still recognised as taken.
 */
async function sealAndDeleteMembers(
  experimentID: string,
  provider: StorageProvider,
  auth: ResolvedAuth,
  container: ContainerRef,
  runRef: FirebaseFirestore.DocumentReference,
  memberHashes: string[],
  members: FileRef[]
): Promise<number> {
  await sealClaimHashes(experimentID, memberHashes);
  await runRef.update({ status: "sealed", sealedAt: Timestamp.now() });

  let undeleted = 0;
  for (const file of members) {
    const result = await provider.deleteFile!(auth, container, file);
    if (!result.success) {
      undeleted += 1;
      console.error(
        `finalization: failed to delete ${experimentID} member after merging: ${result.providerMessage ?? result.error}`
      );
    }
  }
  return undeleted;
}

/**
 * Finishes a pass that died after its finalizationRuns record was written --
 * resumeInterruptedBatch's (compaction.ts) sibling, extended with the one
 * extra crash point finalization has that compaction does not: dying after
 * the record was sealed but before the experiment was marked finalized.
 *
 * Member names are recovered by hashing the CURRENT listing and matching
 * against the recorded hashes, never by reading names out of Firestore -- the
 * record deliberately stores only hashes (see sealClaimHashes).
 *
 * Returns null when there is nothing to resume (no record at all, or a
 * record whose upload never landed and was discarded), meaning the caller
 * should proceed with an ordinary fresh pass.
 */
async function resumeInterruptedFinalization(
  experimentID: string,
  provider: StorageProvider,
  auth: ResolvedAuth,
  container: ContainerRef,
  files: FileRef[],
  salt: string
): Promise<{ archived: number; archiveName: string; detail: string } | null> {
  const runRef = finalizationRunRef(experimentID);
  const runSnap = await runRef.get();
  if (!runSnap.exists) {
    return null;
  }
  const record = runSnap.data() as FinalizationRecord;

  if (record.status === "sealed") {
    // Died after every member was sealed and deleted, before the experiment
    // was marked finalized. Nothing left to redo on the provider -- just the
    // flag, which the caller sets once this returns.
    await deleteStorageObject(record.storagePath);
    return {
      archived: record.fileCount,
      archiveName: record.archiveName,
      detail: "resumed after seal, before the finalized flag was set",
    };
  }

  // status === "uploading"
  const listed = files.find((file) => file.name === record.archiveName);

  // The upload never landed, or landed as something other than the archive
  // that was built. Either way nothing has been deleted yet, so discarding
  // the record and letting the caller re-merge from scratch is safe.
  if (!listed || !checksumMatches(listed.checksum, record.expectedMd5)) {
    if (listed) {
      await provider.deleteFile!(auth, container, listed);
    }
    await deleteStorageObject(record.storagePath);
    await runRef.delete();
    return null;
  }

  const hashes = new Set(record.memberHashes);
  const survivors = files.filter((file) => hashes.has(claimDocId(salt, file.name)));

  await sealAndDeleteMembers(experimentID, provider, auth, container, runRef, record.memberHashes, survivors);
  await deleteStorageObject(record.storagePath);

  return {
    archived: record.fileCount,
    archiveName: record.archiveName,
    detail: "resumed an interrupted finalization pass",
  };
}
