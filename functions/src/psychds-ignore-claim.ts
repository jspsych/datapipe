// Per-experiment claim on writing .psychds-ignore -- ONCE per experiment, not
// once per submission.
//
// metadata-derived-files.ts includes .psychds-ignore among the derived files
// for EVERY submission a metadata-active experiment makes, on the theory that
// the provider's NAME_CONFLICT response (metadata-derived-upload.ts) makes a
// repeat write a no-op: "an earlier attempt already landed the file; nothing
// to do." That theory holds for OSF, Dataverse and Zenodo, which all refuse a
// duplicate name. It does not hold for Google Drive, which permits duplicate
// names and therefore never answers NAME_CONFLICT -- every submission after
// the first lands a fresh copy. providers/types.ts states the principle this
// violates: "Collision detection lives in Firestore, not here." This module
// is that collision detection, applied to the one derived file that is
// identical on every submission and therefore only needs writing once ever,
// for every provider alike (not a per-provider capability -- Drive is simply
// the provider that exposed the bug OSF/Dataverse/Zenodo happened to mask).
//
// The claim is a single field on experiments/{id}: `psychdsIgnoreWrittenAt`.
// api-data.ts reads it for free off the experiment document it has already
// loaded for the submission, so the overwhelming majority of calls -- every
// submission after the first -- drop .psychds-ignore from derivedFiles with
// ZERO extra reads. Only the (at most one, ever) submission that finds the
// field absent pays for the transaction below.
//
// KNOWN, ACCEPTED LIMITATION. Every metadata-active experiment that exists
// before this ships already has .psychds-ignore in its storage but no claim
// recorded for it -- there was nothing to record one before now. Its next
// submission finds the field absent, wins the claim, and writes ONE more
// redundant copy (on Drive; a NAME_CONFLICT no-op everywhere else) -- and then
// stops, forever, because the claim is now set. This is accepted rather than
// engineered around: closing it would mean asking the provider whether the
// file already exists before every claim, which is exactly the per-submission
// provider round trip this whole module exists to avoid. Likewise, a
// researcher who deletes .psychds-ignore by hand from their storage will not
// get it back automatically -- the claim has no way to know the file is gone,
// and re-checking would have the same cost. Do not add a provider existence
// check to work around either case.

import { FieldValue } from "firebase-admin/firestore";
import { db } from "./app.js";

function experimentRef(experimentID: string) {
  return db.collection("experiments").doc(experimentID);
}

/**
 * Attempts to claim .psychds-ignore for `experimentID`. Returns true exactly
 * once per experiment -- the caller that gets `true` is the one, and only
 * one, that should write the file; everyone else (every later submission,
 * and every concurrent submission that loses the transaction) gets `false`
 * and drops it from what they write.
 *
 * A single-document Firestore transaction: Firestore transactions are
 * serializable, so of any number of concurrent callers racing this on the
 * same experiment, exactly one observes the field absent, sets it, and
 * commits; every other one re-reads after that commit (on retry) and sees it
 * already set. No document outside experiments/{id} is touched, so this
 * cannot contend with anything but another claim attempt (or a release) on
 * the same experiment.
 */
export async function claimPsychdsIgnore(experimentID: string): Promise<boolean> {
  const ref = experimentRef(experimentID);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.data()?.psychdsIgnoreWrittenAt != null) {
      return false;
    }
    tx.update(ref, { psychdsIgnoreWrittenAt: FieldValue.serverTimestamp() });
    return true;
  });
}

/**
 * Releases a claim that did not result in the file being written OR queued
 * for retry -- see metadata-derived-upload.ts's queueDerivedFiles catch block
 * and compaction.ts's restoreIgnoreFile failure branch for the two real
 * callers. Deletes the field outright (not merely clears it) so the next
 * submission's claimPsychdsIgnore sees it as genuinely absent and retries the
 * write from scratch.
 *
 * Best-effort and swallows its own errors: this runs from inside an
 * already-best-effort failure path (a derived file failing to queue, or a
 * compaction restore failing), and a second failure here must not mask or
 * replace the first one being logged and handled by its caller. A claim that
 * is never released because THIS write also failed is not a correctness bug,
 * only a repeat of the same known, accepted limitation the module header
 * already documents -- the next submission's write is skipped once more, and
 * it will keep being skipped until an operator investigates why both writes
 * failed.
 */
export async function releasePsychdsIgnoreClaim(experimentID: string): Promise<void> {
  try {
    await experimentRef(experimentID).update({
      psychdsIgnoreWrittenAt: FieldValue.delete(),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(`psychds-ignore-claim: could not release claim for ${experimentID}: ${detail}`);
  }
}
