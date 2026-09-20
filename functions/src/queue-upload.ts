import { Timestamp } from "firebase-admin/firestore";
import { db, storage } from "./app.js";
import { StorageProviderId, ContainerRef, ProviderErrorCode } from "./providers/types.js";
import { encryptPayload, ENCRYPTED_CONTENT_TYPE } from "./payload-crypto.js";

interface QueueUploadParams {
  experimentID: string;
  owner: string;
  filename: string;
  data: string;
  dataType: "data" | "base64";
  // Optional — undefined for provider-migrated (e.g. gdrive) experiments,
  // which carry storageProvider/providerContainer instead.
  osfFilesLink?: string;
  errorCode: number;
  sessionIncremented: boolean;
  failureReason?: string;
  claimToken?: string;
  // Provider-migration fields (additive; absent for legacy OSF experiments —
  // omitted from the Firestore write below rather than stored as undefined,
  // since Firestore rejects undefined field values).
  storageProvider?: StorageProviderId;
  providerContainer?: ContainerRef;
  // Taxonomy code from the provider WriteResult that caused this call, when
  // one is available (i.e. this is a provider write failure, not a
  // collision-cache/metadata failure). Drives which retry tier the first
  // nextRetryAt below — and every subsequent backoff computed by
  // scheduled-upload-retry.ts's handleRetryFailure — falls into. Omitted from
  // the Firestore write below when undefined, same convention as
  // osfFilesLink/storageProvider/providerContainer.
  providerErrorCode?: ProviderErrorCode;
  // Set only by scheduled-staging-sweep.ts: this entry is a session recovered
  // from the RTDB staging tier after the participant abandoned it, not a
  // submission anyone made. upload-failure-notify.ts refuses to open a
  // notification episode on one -- see the comment there. Omitted from the
  // Firestore write when undefined, same convention as the fields above.
  partial?: boolean;
  // Set only by scheduled-staging-sweep.ts, for the same recovered-partial
  // entries as `partial` above (the two happen to coincide today, but this
  // flag is about scheduling, not about what kind of entry this is -- a
  // future caller with a never-attempted, non-partial entry could set it
  // too). Says "nothing has been attempted yet, so there is no failure to
  // back off from" -- see firstRetryDelayMs below. NOT a field on the
  // Firestore doc itself; it only changes the nextRetryAt this call computes.
  attemptImmediately?: boolean;
}

const MAX_RETRIES = 5;

// CONTENTION means "another write to this same container is in flight right
// now" -- verified live against demo.dataverse.org to clear in seconds -- so
// it is the one code worth retrying on a minutes-scale schedule. Exported so
// scheduled-upload-retry.ts reads the exact same tier boundary rather than
// keeping its own copy that could drift out of sync with this one.
//
// RATE_LIMITED is deliberately NOT here, though it looks like it belongs. A
// 429 is the provider telling us to back off for as long as ITS window lasts,
// which for OSF and Drive is a scale of hours, not seconds. On the fast tier
// its five attempts (60s base, 30-minute cap) are all spent inside ~31
// minutes, every one of them re-hitting the endpoint that just rate-limited
// us; the item is then marked permanently failed and cleanupOldEntries
// deletes its Cloud Storage payload seven days later. The slow tier's ~31
// hours is what a rate-limit window actually needs to outlast, so 429 stays
// there -- exactly where it was before the fast tier existed.
export const FAST_RETRY_CODES: ReadonlySet<string> = new Set(["CONTENTION"]);

export function isFastRetry(code?: string | null): boolean {
  return !!code && FAST_RETRY_CODES.has(code);
}

// Codes that get ONE minute-scale look before falling back to the hours-scale
// schedule. This is not the fast tier: a probe code takes a single early
// attempt and, if that fails, resumes the ordinary slow backoff (2, 4, 8, 16
// hours) from there. Nothing in scheduled-upload-retry.ts needs to know about
// this set -- the probe only moves the FIRST delay, and the worker's existing
// `Math.pow(2, newRetryCount) * baseMs` already produces 2 hours for the next
// attempt. The asymmetry with FAST_RETRY_CODES is deliberate, not an omission.
//
// The attempt is free rather than additive: it displaces the 1-hour first
// attempt instead of extending the chain, so an item still gets five tries
// across ~30 hours -- the same budget and nearly the same total window as
// before, with the first look ~59 minutes earlier.
//
// Both members are codes that CANNOT distinguish a transient failure from a
// terminal one, so the cheapest way to find out is to look once.
//
// AUTH_EXPIRED: on Zenodo this conflates the two outright. Zenodo answers 403
// for a revoked token, an under-scoped token, no token at all, AND an access
// token that a concurrent refresh rotated away moments ago (all four measured
// against the sandbox, 2026-08-21). That last case heals itself the instant
// the winning refresh persists -- so waiting an hour to look again is an hour
// of delay for a submission that would have succeeded on the next tick. See
// docs/provider-migration-design.md, spike gate N.
//
// UNAVAILABLE: a 5xx or a network fault, which covers everything from a
// one-off blip to a multi-hour outage. The blip is common and clears in
// seconds; the outage costs one extra request to discover, then falls back to
// the same hours-scale chain it would have used anyway.
//
// DELIBERATELY NOT HERE:
//   RATE_LIMITED   -- the provider has told us how long it will keep refusing;
//                     probing inside its own stated window is the one thing it
//                     asked us not to do.
//   QUOTA_EXCEEDED -- needs compaction to free a slot or a human to raise a
//                     limit. Neither happens within a minute.
export const PROBE_RETRY_CODES: ReadonlySet<string> = new Set(["AUTH_EXPIRED", "UNAVAILABLE"]);

export function isProbeRetry(code?: string | null): boolean {
  return !!code && PROBE_RETRY_CODES.has(code);
}

/**
 * The uploadQueue document id for a given experiment/filename pair -- the
 * same value stored as `deduplicationKey` below, sanitised into a legal
 * Firestore document id.
 *
 * Exported so a caller that needs to know whether an entry ALREADY EXISTS for
 * a filename -- scheduled-staging-sweep.ts, before re-queueing a recovered
 * partial whose earlier discard may have failed -- computes the identical id
 * this module uses, rather than keeping a second copy that could drift out of
 * sync with it.
 */
export function queueDocIdFor(experimentID: string, filename: string): string {
  return `${experimentID}:${filename}`.replace(/[/\\]/g, "_");
}

export default async function queueUpload(params: QueueUploadParams): Promise<string> {
  const deduplicationKey = `${params.experimentID}:${params.filename}`;
  const docId = queueDocIdFor(params.experimentID, params.filename);

  const docRef = db.collection("uploadQueue").doc(docId);

  const now = Timestamp.now();
  // Three cases for the FIRST delay. Every later retry ignores all of this and
  // runs on computeBackoffMs's tier arithmetic (upload-backoff.ts), keyed off
  // the providerErrorCode of whichever attempt just failed -- none of that
  // changes here.
  //
  //  - attemptImmediately: no delay at all (nextRetryAt = now). Set only by
  //    scheduled-staging-sweep.ts for a recovered partial -- an entry that has
  //    never been attempted, so there is no failure to back off from. `now` is
  //    a floor, not a promise: scheduled-upload-retry.ts's
  //    `where("nextRetryAt", "<=", now)` query is what actually picks it up,
  //    and scheduled-sweep-core.ts runs the staging sweep before upload retry
  //    in the same invocation specifically so that happens on the SAME tick
  //    this entry was queued on, not the next one.
  //  - fast tier (CONTENTION) or a one-off probe (AUTH_EXPIRED,
  //    UNAVAILABLE): 60 seconds. The two differ in what happens NEXT, not
  //    here: CONTENTION keeps a minutes-scale schedule for all five attempts,
  //    a probe code takes this one early look and then reverts to hours.
  //  - everything else, including no providerErrorCode at all: 1 hour.
  //
  // 60 seconds (and attemptImmediately's zero) are floors, not promises.
  // scheduled-upload-retry.ts runs on */5, so the real first attempt lands at
  // the next 5-minute tick -- which is the number to reason about when judging
  // whether either is worth it.
  const firstRetryDelayMs = params.attemptImmediately
    ? 0
    : isFastRetry(params.providerErrorCode) || isProbeRetry(params.providerErrorCode)
      ? 60 * 1000
      : 60 * 60 * 1000;
  const nextRetryAt = Timestamp.fromMillis(now.toMillis() + firstRetryDelayMs);

  // If the doc already exists: a "processing" entry is actively being
  // uploaded, so leave it alone (retry worker owns the storage payload right
  // now). A "pending" entry has the same dedup key by construction — it's the
  // same logical submission having failed before — so refresh its Cloud
  // Storage payload with the latest content and let the existing Firestore
  // doc/status/retry schedule stand, rather than queueing a doc the retry
  // worker can never see because a newer call with fresher data returned
  // early here without ever writing it. Completed/failed docs fall through
  // and get freshly re-queued below.
  //
  // `attemptImmediately` does NOT reach into this branch to pull the existing
  // doc's `nextRetryAt` forward, on purpose. This is the "let the existing
  // schedule stand" branch: whatever is already there has its own history --
  // it could be mid-backoff after a real provider failure, held by a
  // compaction hold, or a previous recovery of this same session that is
  // already on the immediate schedule -- and `attemptImmediately` only speaks
  // to entries this call is about to WRITE, which by definition have no
  // history yet. Overwriting a real backoff with "now" would re-hit a
  // provider that just told us (via that backoff) to wait.
  const existingDoc = await docRef.get();
  if (existingDoc.exists) {
    const status = existingDoc.data()?.status;
    if (status === "processing") {
      return docId;
    }
    if (status === "pending") {
      const storagePath = `upload-queue/${docId}`;
      const bucket = storage.bucket();
      const file = bucket.file(storagePath);
      await file.save(encryptPayload(params.data), {
        contentType: ENCRYPTED_CONTENT_TYPE,
      });
      // The read above is not atomic with this save: the retry worker could
      // claim (pending -> processing) or finish (-> completed/failed, which
      // deletes the storage object) the doc in between. Re-read to confirm.
      // Still pending/processing: the worker either hasn't started or now owns
      // the doc and will read the payload we just wrote — either way we're
      // done. Otherwise the doc finished out from under us and our fresh
      // payload is orphaned, so fall through to re-queue a clean pending doc.
      const recheck = await docRef.get();
      const recheckStatus = recheck.exists ? recheck.data()?.status : undefined;
      if (recheckStatus === "pending" || recheckStatus === "processing") {
        return docId;
      }
    }
  }

  // Write data to Cloud Storage, encrypted at rest (payload-crypto.ts). This
  // object is the researcher's only copy of the submission until the retry
  // worker lands it or it expires after 7 days, so it is exactly the thing the
  // FAQ's encryption-at-rest claim is about.
  const storagePath = `upload-queue/${docId}`;
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);
  await file.save(encryptPayload(params.data), {
    contentType: ENCRYPTED_CONTENT_TYPE,
  });

  // Write metadata to Firestore. osfFilesLink/storageProvider/providerContainer
  // are included only when present — Firestore rejects undefined field
  // values, and a gdrive experiment has no osfFilesLink just as a legacy OSF
  // experiment has no storageProvider/providerContainer.
  const queueDocData: Record<string, unknown> = {
    experimentID: params.experimentID,
    owner: params.owner,
    filename: params.filename,
    storagePath,
    dataType: params.dataType,
    status: "pending",
    errorCode: params.errorCode,
    retryCount: 0,
    maxRetries: MAX_RETRIES,
    createdAt: now,
    lastAttemptAt: null,
    nextRetryAt,
    completedAt: null,
    failureReason: params.failureReason || null,
    deduplicationKey,
    sessionIncremented: params.sessionIncremented,
    claimToken: params.claimToken || null,
  };

  if (params.osfFilesLink !== undefined) {
    queueDocData.osfFilesLink = params.osfFilesLink;
  }
  if (params.storageProvider !== undefined) {
    queueDocData.storageProvider = params.storageProvider;
  }
  if (params.providerContainer !== undefined) {
    queueDocData.providerContainer = params.providerContainer;
  }
  if (params.providerErrorCode !== undefined) {
    queueDocData.providerErrorCode = params.providerErrorCode;
  }
  if (params.partial !== undefined) {
    queueDocData.partial = params.partial;
  }

  await docRef.set(queueDocData);

  return docId;
}
