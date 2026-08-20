// Archive compaction for providers with a hard file-count cap
// (docs/provider-migration-design.md, "The 100-file cap is handled by
// end-of-study compaction, not rollover").
//
// WHAT THIS DOES, AND THE TWO REASONS IT EXISTS
//
// 1. It keeps a study collecting. Zenodo allows 100 files per record and
//    refuses the 101st, so without this a study simply stops at session ~100:
//    the write maps to QUOTA_EXCEEDED, which is a slow-tier queue failure that
//    no amount of retrying can clear. Sealing older sessions into one zip
//    turns N files into 1 and returns the headroom.
//
// 2. It is where the Psych-DS directory structure lives. Zenodo's keyspace is
//    flat -- a slash cannot be stored by any route (zenodo.ts's toZenodoKey
//    documents the live evidence) -- so a metadataActive experiment's record
//    shows `data_raw_subject-1.json` where the layout calls for
//    `data/raw/subject-1.json`. Inside a zip the paths are ours to choose, so
//    the archive carries the real tree even though the record cannot.
//
// THE ORDERING RULE THAT MATTERS MOST: upload the archive, verify the checksum
// the provider reports back, seal the claims, and only then delete the
// originals. Never the reverse. DataPipe keeps no copy of submitted data, so a
// delete that runs before a verified upload is unrecoverable loss.
//
// Everything here is crash-safe by construction rather than by luck: a batch's
// membership is recorded before its archive is uploaded, so an interrupted
// pass resumes instead of sealing the same sessions into a second zip.

import archiver from "archiver";
import { PSYCHDS_IGNORE_FILENAME, PSYCHDS_IGNORE_CONTENT } from "@jspsych/metadata";
import { createHash } from "crypto";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db, storage } from "./app.js";
import { getProvider } from "./providers/index.js";
import { StorageProvider, ContainerRef, ResolvedAuth, FileRef } from "./providers/types.js";
import { ExperimentData, UserData } from "./interfaces.js";
import resolveToken from "./resolve-token.js";
import { getSalt, claimDocId, sealClaimHashes, readSealedNames } from "./collision-cache.js";

// Compact once the record is this full. The gap to the cap is deliberate
// headroom: compaction takes tens of seconds during which submissions keep
// arriving, and a study that only compacted at 100/100 would already be
// rejecting writes before this ran.
export const WATERMARK_RATIO = 0.8;

// Sessions left loose after a pass, so researchers can still open and
// spot-check recent data in the provider's own UI without downloading an
// archive. Purely a convenience -- correctness does not depend on it.
//
// Kept small deliberately. Every file held back is headroom given up, and
// headroom is what absorbs a burst: requirement 6 is 30-100 submissions inside
// a minute, and a metadataActive experiment writes several files per
// submission. Holding 20 loose left only ~74 files of room after a pass, which
// a single burst can exhaust. Five is enough to spot-check recent data, and
// the rest is available in the archives.
export const KEEP_LOOSE = 5;

// Upper bounds on one batch. MAX_BATCH_FILES keeps an archive small enough to
// stay quick to build and download; MAX_BATCH_BYTES is the real guard, since
// the whole batch is held in memory at once (see buildArchive) and an
// /api/base64 experiment collecting video has files orders of magnitude bigger
// than a JSON session. Whichever binds first wins, and a batch that hits the
// byte budget early simply seals fewer files -- the next run takes the rest.
// Sized to reclaim as much of the cap as one pass can, for the same
// burst-headroom reason as KEEP_LOOSE above: a pass that leaves the record
// half full has bought much less time than one that empties it.
export const MAX_BATCH_FILES = 95;
export const MAX_BATCH_BYTES = 150 * 1024 * 1024;

// A pass is a handful of provider round-trips per file, so this is generous;
// it exists to release the experiment if the function dies mid-pass, not to
// bound normal work.
const LEASE_MS = 10 * 60 * 1000;

const ARCHIVE_PREFIX = "datapipe-batch-";
const ARCHIVE_PATTERN = /^datapipe-batch-\d{4}\.zip$/;

// Files that must never be swept into an archive.
//
// dataset_description.json is the record's own Psych-DS descriptor: it is what
// metadata-block.ts holds a metadataFileRef to and updates in place on every
// submission, and burying it inside a zip would both break that ref and hide
// the one file a visitor to the record should see first.
//
// .psychds-ignore is rewritten by metadata-derived-upload.ts on every
// submission, so archiving it would just churn -- it would reappear loose
// moments later.
const NEVER_ARCHIVE = new Set(["dataset_description.json", ".psychds-ignore"]);

export function archiveNameForIndex(index: number): string {
  return `${ARCHIVE_PREFIX}${String(index).padStart(4, "0")}.zip`;
}

export function isArchiveName(name: string): boolean {
  return ARCHIVE_PATTERN.test(name);
}

export interface CompactionResult {
  // Which experiment this describes. The trigger handlers log results without
  // otherwise holding the id, so carrying it here keeps every log line and
  // test assertion attributable.
  experimentID: string;
  status:
    | "compacted"
    | "below-watermark"
    | "nothing-to-archive"
    | "not-eligible"
    | "leased-elsewhere"
    // The record is at the cap AND has no reproducible file whose slot could
    // be borrowed, so compaction cannot make room for itself. Needs one file
    // removed by hand. See the saturation handling in runCompaction.
    | "saturated"
    | "failed";
  archived?: number;
  archiveName?: string;
  fileCountBefore?: number;
  fileCountAfter?: number;
  undeleted?: number;
  // True when the record was already at the cap and a slot had to be borrowed
  // to fit the archive in (see runCompaction). Not a failure — the pass
  // succeeded — but it means a burst outran the watermark, which is worth
  // seeing in logs.
  recoveredFromSaturation?: boolean;
  detail?: string;
}

// --------------------------------------------------------------------------
// Pure helpers (unit-testable without a provider or Firestore)
// --------------------------------------------------------------------------

/**
 * Chooses which of a container's files go into the next archive.
 *
 * Order is the provider's listing order, which Zenodo returns in insertion
 * order in practice but does not document as a guarantee. Nothing correctness-
 * bearing rests on it: the only thing order decides is WHICH files stay loose
 * for spot-checking, and every file is archived eventually either way.
 */
export function selectBatch(
  files: FileRef[],
  opts: { keepLoose?: number; maxFiles?: number; maxBytes?: number; alreadySealed?: Set<string> } = {}
): FileRef[] {
  const keepLoose = opts.keepLoose ?? KEEP_LOOSE;
  const maxFiles = opts.maxFiles ?? MAX_BATCH_FILES;
  const maxBytes = opts.maxBytes ?? MAX_BATCH_BYTES;
  const alreadySealed = opts.alreadySealed ?? new Set<string>();

  const candidates = files.filter(
    (file) =>
      !NEVER_ARCHIVE.has(file.name) && !isArchiveName(file.name) && !alreadySealed.has(file.name)
  );

  // Hold back the tail of the listing, not of the whole set: previously
  // archived batches and the protected files are already excluded, so this
  // keeps `keepLoose` real sessions loose rather than counting a zip as one.
  const archivable = keepLoose > 0 ? candidates.slice(0, Math.max(0, candidates.length - keepLoose)) : candidates;

  const batch: FileRef[] = [];
  let bytes = 0;
  for (const file of archivable) {
    if (batch.length >= maxFiles) {
      break;
    }
    // An unknown size counts as zero rather than blocking the batch. The
    // budget is a memory guard, and a provider that does not report sizes
    // would otherwise be unable to compact at all; buildArchive is still
    // bounded by maxFiles in that case.
    const size = file.size ?? 0;
    if (batch.length > 0 && bytes + size > maxBytes) {
      break;
    }
    batch.push(file);
    bytes += size;
  }

  return batch;
}

/**
 * Maps each stored name to the path it takes inside the archive.
 *
 * The reconstruction is skipped entirely unless the experiment is
 * metadataActive, because that is the only mode in which DataPipe writes
 * slashed paths at all. Without that gate, a researcher's own file named
 * `data_x.json` in a plain experiment would be "restored" into a `data/`
 * folder that never existed. See StorageProvider.archivePathFor.
 */
export function archivePathsFor(
  provider: StorageProvider,
  metadataActive: boolean,
  names: string[]
): Map<string, string> {
  const paths = new Map<string, string>();
  const seen = new Set<string>();

  for (const name of names) {
    const path = metadataActive && provider.archivePathFor ? provider.archivePathFor(name) : name;
    // Distinct keys cannot collide under any archivePathFor DataPipe ships
    // (the Zenodo one only inserts separators at fixed prefixes), but a zip
    // with two members at one path is silent corruption, so fall back to the
    // flat name rather than trusting that property to hold for a future
    // adapter.
    if (seen.has(path)) {
      paths.set(name, name);
      continue;
    }
    seen.add(path);
    paths.set(name, path);
  }

  return paths;
}

/**
 * Builds the zip in memory and returns its bytes plus an md5 of exactly those
 * bytes — the same value the provider is expected to report back, and the
 * basis for deciding whether deleting the originals is safe.
 *
 * In-memory rather than streamed because the archive has to be uploaded with a
 * Content-Length (Zenodo's bucket PUT) and its checksum has to be known before
 * anything is deleted. MAX_BATCH_BYTES is what keeps that honest.
 */
export async function buildArchive(
  entries: { path: string; content: Buffer }[]
): Promise<{ zip: Buffer; md5: string }> {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];

  const collected = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("warning", reject);
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
  });

  for (const entry of entries) {
    // A fixed date keeps the archive byte-reproducible for a given input,
    // which is what lets a resumed pass re-derive the same md5 rather than
    // having to trust a recorded one.
    archive.append(entry.content, { name: entry.path, date: new Date(0) });
  }
  await archive.finalize();

  const zip = await collected;
  return { zip, md5: createHash("md5").update(zip).digest("hex") };
}

/**
 * buildArchive's streaming sibling, for finalization
 * (docs/finalization-spec.md), which merges an entire study into ONE archive
 * -- Psych-DS compatibility requires it -- with no size ceiling but the
 * provider's own (Zenodo: 50 GB per file). buildArchive's in-memory Buffer
 * would put that ceiling back at function memory, so this pipes archiver
 * straight into Cloud Storage instead and never holds a built zip in memory
 * at all.
 *
 * `entries` is consumed LAZILY: a `for await` loop pulls exactly one member
 * at a time, so the caller's generator (which downloads each member just in
 * time) never has more than one member's bytes resident here. This is the
 * whole point of taking an AsyncIterable instead of an array.
 *
 * The md5 is computed from the bytes archiver actually emits, via a
 * passthrough `data` listener alongside the pipe to Cloud Storage -- not by
 * re-reading the uploaded object afterward -- so nothing has to be re-read to
 * verify what was written. Entry dates are pinned the same way buildArchive
 * pins them, which is what makes the two byte-identical for the same input.
 */
export async function buildArchiveToStorage(
  entries: AsyncIterable<{ path: string; content: Buffer }>,
  storagePath: string
): Promise<{ size: number; md5: string }> {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const writeStream = storage.bucket().file(storagePath).createWriteStream({
    contentType: "application/zip",
  });

  const hash = createHash("md5");
  let size = 0;

  // Settles once, however it settles -- the archive stream, the destination
  // stream, and (below) an entries-iterable failure are three independent
  // sources of "this pass is over", and only the first one should decide the
  // outcome. A second event after that (e.g. the destination erroring after
  // archive.abort() closes it) must not try to resolve/reject an already
  // -settled promise.
  let settled = false;
  const done = new Promise<void>((resolve, reject) => {
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    archive.on("warning", fail);
    archive.on("error", fail);
    writeStream.on("error", fail);
    writeStream.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });
  // If the entries iterable throws (see the catch block below), `done` may
  // never be awaited -- but the archive/writeStream error handlers above can
  // still fire later during cleanup. Without this, that would surface as an
  // unhandled rejection despite the real error already having been thrown.
  done.catch(() => undefined);

  archive.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    size += chunk.length;
  });
  archive.pipe(writeStream);

  try {
    for await (const entry of entries) {
      // Same fixed date as buildArchive -- required for the two builders to
      // produce byte-identical output for the same input.
      archive.append(entry.content, { name: entry.path, date: new Date(0) });
    }
    await archive.finalize();
    await done;
  } catch (err) {
    archive.abort();
    writeStream.destroy(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  return { size, md5: hash.digest("hex") };
}

/**
 * True when a provider-reported checksum matches a locally computed md5.
 *
 * Providers decorate the value (Zenodo reports "md5:<hex>"), and a provider
 * that reports nothing at all yields `false` — callers must treat an
 * unverifiable upload as unverified and keep the originals.
 */
export function checksumMatches(reported: string | undefined, expectedMd5: string): boolean {
  if (!reported) {
    return false;
  }
  const normalized = reported.trim().toLowerCase().replace(/^md5:/, "");
  return normalized === expectedMd5.toLowerCase();
}

// --------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------

function experimentRef(experimentID: string) {
  return db.collection("experiments").doc(experimentID);
}

function batchesCollection(experimentID: string) {
  return experimentRef(experimentID).collection("compactionBatches");
}

// Leases the experiment to one compaction pass. Same shape as the collision
// cache's rehydration lease: a stale lease simply expires, so a crashed pass
// cannot wedge an experiment permanently.
//
// Exported so finalization.ts (docs/finalization-spec.md) can acquire and
// release the SAME lease field -- finalization is "structurally
// compactExperiment with a different selection rule" and reuses this lease
// rather than inventing a second one, which is also what makes the write gate
// (compaction-gate.ts) hold submissions for free during a finalization pass.
export async function acquireLease(experimentID: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(experimentRef(experimentID));
    const until = snap.data()?.compaction?.compactingUntil as FirebaseFirestore.Timestamp | undefined;
    if (until && until.toMillis() > Date.now()) {
      return false;
    }
    tx.update(experimentRef(experimentID), {
      "compaction.compactingUntil": Timestamp.fromMillis(Date.now() + LEASE_MS),
    });
    return true;
  });
}

/**
 * Ends a pass, recording what it observed.
 *
 * `sessionsSeen` is what makes the scheduled worker's change trigger work: it
 * compares the experiment's current `sessions` against this to decide whether
 * anything could have been added since, instead of re-listing on a timer. It
 * is deliberately the value read at the START of the pass — a submission that
 * lands while compaction is running leaves the two unequal, so the next run
 * looks again rather than assuming this pass saw it.
 */
export async function releaseLease(
  experimentID: string,
  sessionsSeen: number,
  patch: Record<string, unknown> = {}
): Promise<void> {
  await experimentRef(experimentID).update({
    "compaction.compactingUntil": FieldValue.delete(),
    "compaction.lastCheckedAt": Timestamp.now(),
    "compaction.sessionsAtLastCheck": sessionsSeen,
    ...patch,
  });
}

interface BatchRecord {
  index: number;
  archiveName: string;
  status: "uploading" | "sealed";
  memberHashes: string[];
  expectedMd5: string;
  fileCount: number;
}

/**
 * Compacts one experiment. Safe to call on anything — it self-selects and
 * returns a status rather than throwing for the ordinary "not applicable"
 * cases.
 */
export async function compactExperiment(experimentID: string): Promise<CompactionResult> {
  // Stamped here rather than at each of runCompaction's dozen return points,
  // so a new early return can never ship without it.
  const result = { ...(await runCompaction(experimentID)), experimentID };

  // Two sets of queue entries are waiting on this pass: submissions the
  // provider refused for lack of room, and submissions the write gate held
  // back while the pass ran (compaction-gate.ts). Releasing both here rather
  // than in a caller means every entry point into compaction closes the loop.
  //
  // Done on any terminal outcome, not just "compacted": a pass that found
  // nothing to do, or failed, has still released its lease, so anything held
  // for it should stop waiting.
  if (result.status !== "leased-elsewhere") {
    // Best-effort, and deliberately NOT allowed to fail the caller. This is an
    // accelerator: the entries it releases are already on the 60-second fast
    // tier (CONTENTION) or will be retried anyway (QUOTA_EXCEEDED), so losing
    // it costs a slightly slower drain and nothing else.
    //
    // The motivating case is a deploy. This query needs a composite index, and
    // `firebase deploy` only SUBMITS index definitions -- builds run
    // asynchronously for minutes afterwards while the new functions are
    // already live. An unguarded throw here would propagate out of
    // compactExperiment, fail the Firestore trigger that called it, and get
    // retried for up to seven days -- on every experiment-document update for
    // every capped-provider experiment near the watermark, for the whole build
    // window. The compaction itself has already completed and committed by
    // this point, so there is nothing to roll back and nothing to gain from
    // failing loudly.
    try {
      await releaseHeldUploads(experimentID);
    } catch (e) {
      console.error(
        `compaction: could not release held uploads for ${experimentID} (they will drain on their own): `,
        e instanceof Error ? e.message : e
      );
    }
  }

  return result;
}

/**
 * Makes this experiment's waiting queue entries retryable immediately.
 *
 * Two kinds are waiting, and both are waiting on something that has now
 * happened. QUOTA_EXCEEDED entries were refused for lack of room and sit on
 * the slow tier -- correct when nothing is coming to fix it, wrong the moment
 * compaction has. Entries held by the write gate were never even attempted.
 *
 * Only nextRetryAt moves. retryCount, backoff state and the payload are
 * untouched, so a submission failing for some other reason gains no extra
 * attempts, and an entry that is genuinely mid-flight (`processing`) is not
 * disturbed.
 */
async function releaseHeldUploads(experimentID: string): Promise<void> {
  const waiting = await db
    .collection("uploadQueue")
    .where("experimentID", "==", experimentID)
    .where("status", "==", "pending")
    .where("providerErrorCode", "in", ["QUOTA_EXCEEDED", "CONTENTION"])
    .get();

  if (waiting.empty) {
    return;
  }

  const batch = db.batch();
  const now = Timestamp.now();
  waiting.docs.forEach((doc) => batch.update(doc.ref, { nextRetryAt: now }));
  await batch.commit();

  console.log(
    `compaction: released ${waiting.size} waiting upload(s) for ${experimentID} to the next retry pass`
  );
}

async function runCompaction(experimentID: string): Promise<Omit<CompactionResult, "experimentID">> {
  const expSnap = await experimentRef(experimentID).get();
  if (!expSnap.exists) {
    return { status: "not-eligible", detail: "experiment does not exist" };
  }
  const expData = expSnap.data() as ExperimentData;

  // Read once, at the start, and recorded by every releaseLease below. The
  // scheduled worker compares this against the live `sessions` to decide
  // whether anything could have been added since — see releaseLease.
  const sessionsSeen = expData.sessions ?? 0;

  if (!expData.storageProvider || !expData.providerContainer) {
    return { status: "not-eligible", detail: "legacy experiment with no provider container" };
  }

  let provider: StorageProvider;
  try {
    provider = getProvider(expData.storageProvider);
  } catch {
    return { status: "not-eligible", detail: `unknown provider ${expData.storageProvider}` };
  }

  const cap = provider.capabilities.maxFileCount;
  if (cap === null) {
    return { status: "not-eligible", detail: "provider has no file-count cap" };
  }
  // Enforced rather than assumed: capabilities.maxFileCount is documented as a
  // contract that these two exist, and a provider that breaks it would
  // otherwise fail partway through a pass -- possibly after uploading an
  // archive it then cannot clean up behind.
  if (!provider.deleteFile || !provider.downloadFileBytes) {
    return {
      status: "not-eligible",
      detail: `provider ${provider.id} declares maxFileCount but implements no deleteFile/downloadFileBytes`,
    };
  }

  const salt = await getSalt(experimentID);
  if (!salt) {
    // No salt means no filename has ever been claimed, i.e. nothing has been
    // submitted. Compacting would have nothing to seal, and sealing is what
    // keeps duplicate detection working once files leave the listing.
    return { status: "nothing-to-archive", detail: "experiment has no collision-cache salt" };
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

    // Resume before anything else: an interrupted pass left an archive that
    // may already hold these sessions, and building a second one would put the
    // same data in two places (and, once the first is deleted from, lose the
    // link between them).
    const resumed = await resumeInterruptedBatch(experimentID, provider, auth, container, files);
    if (resumed) {
      const after = await provider.listFiles(auth, container);
      await releaseLease(experimentID, sessionsSeen, {
        "compaction.lastRunAt": Timestamp.now(),
        "compaction.lastFileCount": after.length,
      });
      return {
        status: "compacted",
        archived: resumed.archived,
        archiveName: resumed.archiveName,
        fileCountBefore: files.length,
        fileCountAfter: after.length,
        undeleted: resumed.undeleted,
        detail: "resumed an interrupted pass",
      };
    }

    if (files.length < Math.floor(cap * WATERMARK_RATIO)) {
      // lastFileCount is recorded so the scheduled worker can pick a re-check
      // interval from how close this experiment is to the cap, rather than
      // waiting out a fixed cooldown while a fast-collecting study saturates.
      await releaseLease(experimentID, sessionsSeen, { "compaction.lastFileCount": files.length });
      return { status: "below-watermark", fileCountBefore: files.length };
    }

    // The record is already at the cap, so there is no room for the archive,
    // which is itself a new file. Handled further down, once a batch exists to
    // justify borrowing a slot.
    const saturated = files.length >= cap;

    const sealed = await readSealedNames(
      experimentID,
      salt,
      files.map((file) => file.name)
    );
    const batch = selectBatch(files, { alreadySealed: sealed });
    if (batch.length === 0) {
      await releaseLease(experimentID, sessionsSeen, { "compaction.lastFileCount": files.length });
      return { status: "nothing-to-archive", fileCountBefore: files.length };
    }

    const index = await nextBatchIndex(experimentID);
    const archiveName = archiveNameForIndex(index);
    const paths = archivePathsFor(provider, expData.metadataActive === true, batch.map((f) => f.name));

    const entries: { path: string; content: Buffer }[] = [];
    for (const file of batch) {
      const download = await provider.downloadFileBytes(auth, container, file);
      if (!download.success) {
        // Abort the whole batch rather than archive a subset: a partial
        // archive that then had its (complete) member list deleted would lose
        // whatever failed to download.
        await releaseLease(experimentID, sessionsSeen, {
          "compaction.lastError": `download failed for one member: ${download.providerMessage ?? download.error}`,
        });
        return { status: "failed", detail: `download failed: ${download.error}` };
      }
      entries.push({ path: paths.get(file.name) ?? file.name, content: download.content });
    }

    const { zip, md5 } = await buildArchive(entries);
    const memberHashes = batch.map((file) => claimDocId(salt, file.name));

    // Recorded BEFORE the upload. This is the crash-safety hinge: if the
    // function dies between here and the delete step, the next pass finds this
    // document, matches its hashes against the live listing, and finishes the
    // job instead of starting a duplicate one.
    const batchRef = batchesCollection(experimentID).doc(String(index).padStart(4, "0"));
    await batchRef.set({
      index,
      archiveName,
      status: "uploading",
      memberHashes,
      expectedMd5: md5,
      fileCount: batch.length,
      createdAt: Timestamp.now(),
    });

    // MAKING ROOM WHEN THE RECORD IS ALREADY FULL.
    //
    // The archive is itself a new file, so a record at the cap cannot accept
    // it. Steady-state growth never gets here -- a pass leaves the record
    // nearly empty -- but files arriving DURING a pass can, and requirement 6's
    // burst (30-100 submissions inside a minute, several files each for a
    // metadataActive experiment) exceeds the entire 100-file cap, so no
    // watermark setting makes this unreachable.
    //
    // One slot is all that is needed, and .psychds-ignore is a slot that can be
    // given up for free: its content is a fixed constant shared with the
    // Psych-DS tooling, so deleting it loses nothing and restoring it is a PUT
    // of a literal. It is put back once the pass completes; if the pass dies
    // first, metadata-derived-upload.ts rewrites it on the next submission
    // anyway, which is why this needs no resume state.
    //
    // An experiment without that file has nothing reproducible to give up, and
    // overwriting a session instead would risk its only copy, so it stops and
    // asks for a hand. It writes one file per submission, so it has far more
    // headroom to begin with.
    if (saturated) {
      if (!files.some((file) => file.name === PSYCHDS_IGNORE_FILENAME)) {
        await releaseLease(experimentID, sessionsSeen, {
          "compaction.lastFileCount": files.length,
          "compaction.lastError": "record is at the provider file cap with no reproducible file to free",
        });
        return {
          status: "saturated",
          fileCountBefore: files.length,
          detail:
            `record holds ${files.length} of ${cap} files and has no .psychds-ignore to free; ` +
            `remove one file to let compaction proceed`,
        };
      }
      const freed = await provider.deleteFile(auth, container, { name: PSYCHDS_IGNORE_FILENAME });
      if (!freed.success) {
        await releaseLease(experimentID, sessionsSeen, {
          "compaction.lastFileCount": files.length,
          "compaction.lastError": `could not free a slot: ${freed.providerMessage ?? freed.error}`,
        });
        return { status: "failed", detail: `could not free a slot for the archive: ${freed.error}` };
      }
    }

    const uploaded = await putVerifiedArchive(provider, auth, container, archiveName, zip, md5);
    if (!uploaded.ok) {
      await batchRef.delete();
      if (saturated) {
        await restoreIgnoreFile(provider, auth, container);
      }
      await releaseLease(experimentID, sessionsSeen, {
        "compaction.lastFileCount": files.length,
        "compaction.lastError": uploaded.detail,
      });
      return { status: "failed", detail: uploaded.detail };
    }

    // Everything in the batch is now inside a verified archive on the
    // provider, so the originals can go.
    const undeleted = await sealAndDelete(
      experimentID,
      provider,
      auth,
      container,
      batchRef,
      memberHashes,
      batch
    );

    if (saturated) {
      // Deleting the batch above returned far more room than the one slot that
      // was borrowed, so this always fits now.
      await restoreIgnoreFile(provider, auth, container);
    }

    const after = await provider.listFiles(auth, container);
    await releaseLease(experimentID, sessionsSeen, {
      "compaction.lastRunAt": Timestamp.now(),
      "compaction.lastFileCount": after.length,
      "compaction.lastError": FieldValue.delete(),
    });

    return {
      status: "compacted",
      archived: batch.length,
      archiveName,
      fileCountBefore: files.length,
      fileCountAfter: after.length,
      undeleted,
      recoveredFromSaturation: saturated,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await releaseLease(experimentID, sessionsSeen, { "compaction.lastError": detail }).catch(() => undefined);
    return { status: "failed", detail };
  }
}

/**
 * Puts .psychds-ignore back after its slot was borrowed to fit an archive into
 * a full record.
 *
 * Reproducing it needs nothing from the provider: the content is a constant
 * shared with the Psych-DS tooling, which is the entire reason this is the
 * file whose slot gets borrowed. metadata-derived-upload.ts would rewrite it
 * on the next submission anyway; doing it here means the record is never left
 * missing a file a validator expects.
 */
async function restoreIgnoreFile(
  provider: StorageProvider,
  auth: ResolvedAuth,
  container: ContainerRef
): Promise<void> {
  const result = await provider.writeSessionFile(
    auth,
    container,
    PSYCHDS_IGNORE_FILENAME,
    Buffer.from(PSYCHDS_IGNORE_CONTENT),
    { size: Buffer.byteLength(PSYCHDS_IGNORE_CONTENT), contentType: "text/plain" }
  );
  if (!result.success) {
    // Not fatal, and deliberately not retried here: the next submission
    // rewrites this file regardless.
    console.warn(`compaction: could not restore ${PSYCHDS_IGNORE_FILENAME}: ${result.error}`);
  }
}

/**
 * Uploads the archive under `name` and confirms the provider stored exactly
 * the bytes we built. A mismatch removes the object rather than leaving
 * something that could later be mistaken for a sealed batch.
 *
 * This is the gate every delete in this module depends on: DataPipe keeps no
 * copy of submitted data, so an unverified archive must never authorize
 * removing the sessions that went into it.
 */
async function putVerifiedArchive(
  provider: StorageProvider,
  auth: ResolvedAuth,
  container: ContainerRef,
  name: string,
  zip: Buffer,
  md5: string
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const write = await provider.writeSessionFile(auth, container, name, zip, {
    size: zip.length,
    contentType: "application/zip",
  });
  if (!write.success) {
    return { ok: false, detail: `archive upload failed: ${write.providerMessage ?? write.error}` };
  }
  if (!checksumMatches(write.fileRef.checksum, md5)) {
    await provider.deleteFile!(auth, container, { name });
    return {
      ok: false,
      detail: `archive checksum mismatch (reported ${write.fileRef.checksum ?? "nothing"})`,
    };
  }
  return { ok: true };
}

async function nextBatchIndex(experimentID: string): Promise<number> {
  const existing = await batchesCollection(experimentID).get();
  let max = 0;
  existing.forEach((doc) => {
    const index = doc.data().index as number | undefined;
    if (typeof index === "number" && index > max) {
      max = index;
    }
  });
  return max + 1;
}

/**
 * Seals the batch's claims, then deletes the loose originals.
 *
 * The order is not interchangeable. Sealing first means that if the deletes
 * are interrupted, the surviving files are already protected from a second
 * archiving pass and their filenames are still recognised as taken. Deleting
 * first would open a window where a file is gone from the provider and its
 * claim can still expire, silently re-opening a filename that was collected
 * months earlier.
 *
 * Returns how many originals could not be deleted. Those stay loose and are
 * skipped (not re-archived) on the next pass, because their claims are sealed.
 */
async function sealAndDelete(
  experimentID: string,
  provider: StorageProvider,
  auth: ResolvedAuth,
  container: ContainerRef,
  batchRef: FirebaseFirestore.DocumentReference,
  memberHashes: string[],
  members: FileRef[]
): Promise<number> {
  await sealClaimHashes(experimentID, memberHashes);
  await batchRef.update({ status: "sealed", sealedAt: Timestamp.now() });

  let undeleted = 0;
  for (const file of members) {
    const result = await provider.deleteFile!(auth, container, file);
    if (!result.success) {
      undeleted += 1;
      console.error(
        `compaction: failed to delete ${experimentID} member after archiving: ${result.providerMessage ?? result.error}`
      );
    }
  }
  return undeleted;
}

/**
 * Finishes a pass that died after its archive was recorded.
 *
 * Member names are recovered by hashing the CURRENT listing and matching
 * against the recorded hashes, never by reading names out of Firestore — the
 * batch record deliberately stores only hashes (see sealClaimHashes). Files
 * already deleted simply do not appear in the listing, which is exactly right:
 * they need no further work.
 */
async function resumeInterruptedBatch(
  experimentID: string,
  provider: StorageProvider,
  auth: ResolvedAuth,
  container: ContainerRef,
  files: FileRef[]
): Promise<{ archived: number; archiveName: string; undeleted: number } | null> {
  const pending = await batchesCollection(experimentID).where("status", "==", "uploading").get();
  if (pending.empty) {
    return null;
  }

  const salt = await getSalt(experimentID);
  if (!salt) {
    return null;
  }

  let resumedArchive: string | null = null;
  let archived = 0;
  let undeleted = 0;

  for (const doc of pending.docs) {
    const record = doc.data() as BatchRecord;

    const listed = files.find((file) => file.name === record.archiveName);

    // The upload never landed, or landed as something other than the archive
    // that was built. Either way nothing has been deleted yet, so discarding
    // the record is safe and the index gets reused.
    if (!listed || !checksumMatches(listed.checksum, record.expectedMd5)) {
      if (listed) {
        await provider.deleteFile!(auth, container, listed);
      }
      await doc.ref.delete();
      continue;
    }

    const hashes = new Set(record.memberHashes);
    const survivors = files.filter((file) => hashes.has(claimDocId(salt, file.name)));

    undeleted += await sealAndDelete(
      experimentID,
      provider,
      auth,
      container,
      doc.ref,
      record.memberHashes,
      survivors
    );

    resumedArchive = record.archiveName;
    archived += record.fileCount;
  }

  return resumedArchive ? { archived, archiveName: resumedArchive, undeleted } : null;
}
