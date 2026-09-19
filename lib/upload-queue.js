/**
 * Pure logic shared by `components/dashboard/QueuePanel.js` and the header
 * chip in `pages/admin/[experiment_id].js`. Both need the same answer to
 * "what kind of thing is this queue entry" -- moved here (rather than kept
 * inside QueuePanel, where it used to live as a two-state status map) so the
 * chip and the panel body can never disagree about which entries are actual
 * trouble and which are just waiting their turn. Same seam
 * `lib/error-panel.js` cut for ErrorPanel/the same page, for the same reason.
 *
 * THE THREE KINDS, AND WHY TWO USED TO LOOK LIKE ONE
 *
 * A queue entry (`uploadQueue/{id}`, written by queue-upload.ts,
 * scheduled-pending-recovery.ts and scheduled-staging-sweep.ts) is one of:
 *
 *  - "failed" -- every retry was used up (or one of the handful of terminal
 *    paths that skip retries entirely: owner/experiment gone, an unreadable
 *    payload, a finalized experiment). Genuinely urgent: the Cloud Storage
 *    payload is deleted 7-14 days after `createdAt`.
 *  - "retrying" -- DataPipe already tried a provider write and it did not
 *    land, or is currently being written (`status === "processing"`). Will
 *    keep trying on its own; nothing is lost yet.
 *  - "waiting" -- held on purpose and NEVER ATTEMPTED: a partial recovered
 *    from an abandoned streaming session, a raw file kept after a metadata
 *    failure, a submission diverted while a compaction pass or a collision-
 *    cache rehydration was in progress. The panel used to fold this into
 *    "retrying" and tell the researcher a file "did not upload" -- false for
 *    an entry DataPipe has never tried to upload, and actively alarming for
 *    the metadata-kept case, which used to say "interrupted by a server
 *    restart or memory limit".
 *
 * WHAT "NEVER FAILED" MEANS IN THE REAL FIELD SHAPES
 *
 * Every writer above sets `lastAttemptAt: null` and `retryCount: 0` on a
 * freshly queued entry (queue-upload.ts's queueDocData,
 * scheduled-pending-recovery.ts's promoteToQueue) -- always present, never
 * simply absent. The tempting line is `lastAttemptAt == null`, and it is the
 * wrong one: the retry worker (scheduled-upload-retry.ts's processQueueItem)
 * sets `lastAttemptAt` atomically with flipping `status` to "processing" the
 * moment it claims a doc -- BEFORE it has attempted a provider write -- so the
 * field means "the worker has looked at this", not "an upload was tried". An
 * entry the compaction gate bounces straight back to "pending" without
 * touching the provider (the `isCompactionInFlight` branch) carries a real
 * `lastAttemptAt` and has still never failed.
 *
 * `retryCount` is the honest signal. Only handleRetryFailure increments it,
 * only after a real attempt failed, and it replaces `failureReason` in the
 * same write. So a held reason with `retryCount === 0` is "waiting", whatever
 * `lastAttemptAt` and `status` say -- see queueEntryKind.
 *
 * providerErrorCode is DELIBERATELY NOT PART OF THIS PREDICATE, though the
 * task that produced this file assumed it would be ("an entry queued after a
 * real provider failure has a providerErrorCode, so it is correctly
 * retrying"). That is true for every taxonomy code except one:
 * `isCompactionInFlight` branches in both api-data.ts and
 * scheduled-upload-retry.ts queue/reschedule a HELD entry with
 * `providerErrorCode: "CONTENTION"` on purpose, purely to land it on the
 * 60-second fast retry tier (queue-upload.ts's FAST_RETRY_CODES) in case the
 * explicit release is ever missed -- not because a provider write failed. A
 * predicate that excluded any entry with a providerErrorCode would misfile a
 * fresh compaction hold as "retrying" (contradicting its own "Compaction in
 * progress" HELD reason). The `failureReason` pattern match below already
 * does the real discriminating work -- no failure reason DataPipe writes for
 * an actual provider error matches one of the HELD patterns -- so
 * providerErrorCode is redundant for entries that are otherwise
 * unattempted, and actively wrong for this one case. See the PR this file
 * shipped in for the full note.
 */

// Reasons written on a queue entry that DataPipe held on purpose and has
// never attempted -- the "waiting" half of the three-kind split. Order does
// not matter for correctness (each pattern is checked independently, not as
// a priority list), but is kept aligned with REASON_COPY below for
// readability.
const HELD_REASON_PATTERNS = [
  /^Recovered from an abandoned session \(/,
  /Kept after a metadata failure/,
  /(interrupted upload|memory limit)/,
  /Compaction in progress/,
  /Collision cache rehydrating/,
];

function isHeldReason(failureReason) {
  if (!failureReason) return false;
  return HELD_REASON_PATTERNS.some((pattern) => pattern.test(failureReason));
}

/**
 * queueEntryKind
 *
 * @param {object} entry - A `uploadQueue/{id}` document (plus `id`).
 * @returns {"failed"|"retrying"|"waiting"}
 */
export function queueEntryKind(entry) {
  if (entry?.status === "failed") return "failed";

  // "Has never FAILED", not "has never been looked at" -- so this keys on
  // retryCount alone and deliberately ignores lastAttemptAt. The retry worker
  // stamps lastAttemptAt in the same transaction that flips an entry to
  // "processing", before it has tried anything, and its compaction-hold branch
  // then bounces the entry straight back to "pending" without attempting an
  // upload at all. Both leave a held entry with lastAttemptAt set and nothing
  // having failed; reading that as "retrying" would put it under a headline
  // about uploads that "did not go through on the first try". A real failed
  // attempt goes through handleRetryFailure, which always increments
  // retryCount AND replaces failureReason -- either one moves the entry out of
  // "waiting".
  const neverFailed = (entry?.retryCount ?? 0) === 0;

  if (neverFailed && isHeldReason(entry?.failureReason)) return "waiting";

  return "retrying";
}

/**
 * summarizeQueue
 *
 * @param {Array<object>} entries
 * @returns {{failed: number, retrying: number, waiting: number, tone: "error"|"warning"|"neutral"}}
 */
export function summarizeQueue(entries) {
  let failed = 0;
  let retrying = 0;
  let waiting = 0;

  for (const entry of entries ?? []) {
    const kind = queueEntryKind(entry);
    if (kind === "failed") failed++;
    else if (kind === "retrying") retrying++;
    else waiting++;
  }

  const tone = failed > 0 ? "error" : retrying > 0 ? "warning" : "neutral";

  return { failed, retrying, waiting, tone };
}

// ---------------------------------------------------------------------------
// Reason column copy -- moved here verbatim from QueuePanel.js (plus the new
// rows below) so it sits next to the classification it now has to stay
// consistent with. See each row's original comment in git blame for why it
// exists; only the additions below get fresh commentary.
// ---------------------------------------------------------------------------

// Copy keyed off the provider-agnostic error taxonomy that adapters map their
// own failures into (functions/src/providers/types.ts's ProviderErrorCode).
// This is the preferred classification: guessing from an HTTP status (below)
// was an OSF-era assumption that does not survive other providers -- Dataverse
// returns 400 for BOTH write contention and quota-exceeded, so a status-based
// map either mislabels them or shows the researcher a raw string like
// "Provider error 400: Failed to add file to dataset."
const PROVIDER_ERROR_COPY = {
  // Contention is routine and self-resolving: some providers (Dataverse)
  // accept only one write per container at a time, so simultaneous
  // submissions collide.
  CONTENTION:
    "Your storage provider was busy with another upload from this experiment. This is normal when several participants finish at once.",
  RATE_LIMITED: "Your storage provider rate-limited the request.",
  AUTH_EXPIRED:
    "Authentication error. Your storage provider connection may need to be refreshed.",
  QUOTA_EXCEEDED:
    "Your storage provider is out of space, or this file is larger than it allows.",
  NAME_CONFLICT:
    "A file with this name already exists in your storage provider.",
  UNAVAILABLE: "Your storage provider was temporarily unavailable.",
};

// Overrides for the cases where one taxonomy code covers genuinely different
// provider behavior and the generic wording above would send the researcher
// looking in the wrong place. Keyed [code][storageProvider]; anything absent
// falls back to the generic copy, which stays the default rather than the
// exception. `storageProvider` is undefined on legacy OSF queue docs, which
// simply misses here and falls back.
const PROVIDER_SPECIFIC_COPY = {
  QUOTA_EXCEEDED: {
    // Zenodo maps BOTH of its hard caps to QUOTA_EXCEEDED: the 50 GB
    // per-file/per-record size limits, and the 100-files-per-record cap. The
    // generic "out of space, or this file is larger than it allows" is
    // actively wrong for the second one -- the record has room and the file
    // is fine, it just cannot hold another entry.
    zenodo:
      "This Zenodo record has reached one of its limits: 100 files, or 50 GB. DataPipe does not yet combine sessions into archives, so further submissions will keep failing. Download these files and add them to the record yourself.",
  },
};

// Copy for failures that carry NO taxonomy code, matched against the prose in
// failureReason. Two populations land here: queue docs written before
// providerErrorCode existed, and -- the larger group -- every failure or hold
// that never reached the provider at all, since only a provider WriteResult
// produces a code.
//
// ORDER MATTERS where patterns could otherwise overlap. The interpolated
// `detail` on a cache or cached-data failure can itself contain "fetch
// failed", so that specific prefix is tested before the generic network match
// at the end, or a rehydration failure would be reported as a connection
// problem. "Kept after a metadata failure" is checked before the generic
// interrupted-upload/memory-limit row for the same discipline, even though
// the two literal strings do not currently collide -- a future edit to either
// string is one fewer thing to get wrong in the wrong order.
//
// A row's value is either a plain string, or a function of the regex match
// (for $1-style interpolation, e.g. the abandoned-session notes).
const REASON_COPY = [
  [
    /Token resolution (failed|exception)/,
    "DataPipe could not authenticate with your storage provider. Reconnect it from your account page, then upload this file manually.",
  ],
  [
    /Collision cache rehydration failed/,
    "DataPipe could not read the existing files in your storage provider, so it could not safely check whether this filename was already used.",
  ],
  [
    /Collision cache rehydrating/,
    "DataPipe was still checking this experiment's existing filenames when this submission arrived.",
  ],
  [
    /(Owner user not found|Experiment not found)/,
    "The experiment or account this upload belonged to no longer exists. Download the file now if you still need it.",
  ],
  [
    // The saved copy is what the download button serves, so if it cannot be
    // read the researcher must not be told to just download it.
    /Failed to read cached data/,
    "DataPipe could not read its own saved copy of this submission, so it cannot be uploaded or downloaded. Please report this.",
  ],
  [
    // scheduled-staging-sweep.ts's exact prefix. $1 is the parenthesized
    // notes -- "50 trials", or "50 trials, 2 missing, 1 unreadable".
    /^Recovered from an abandoned session \((.+)\)/,
    (match) =>
      `Recovered from a session that did not finish (${match[1]}). It will be stored as a partial file.`,
  ],
  [
    // scheduled-pending-recovery.ts's METADATA_KEPT_FAILURE_REASON.
    /Kept after a metadata failure/,
    "DataPipe could not generate Psych-DS metadata for this submission, so it is storing the raw file without it.",
  ],
  [
    // scheduled-pending-recovery.ts's generic (non-metadata) recovery
    // reason -- an OOM crash or a server restart, not a refusal DataPipe
    // understands. New text: the old wording ("Upload was interrupted by a
    // server restart or memory limit") read as an active failure on an entry
    // that has never been attempted.
    /(interrupted upload|memory limit)/,
    "DataPipe kept a copy of this submission because it could not finish processing it when it arrived, and is storing it now.",
  ],
  [
    // compaction-gate.ts's COMPACTION_HOLD_REASON.
    /Compaction in progress/,
    "Held while DataPipe combines this experiment's stored files into an archive. It will be stored as soon as that finishes.",
  ],
  [/(Upload exception|fetch failed)/, "Could not connect to your storage provider."],
];

function reasonCopy(reason) {
  if (!reason) return null;
  for (const [pattern, copy] of REASON_COPY) {
    const match = pattern.exec(reason);
    if (match) return typeof copy === "function" ? copy(match) : copy;
  }
  // Older queue docs say "OSF error <status>"; current writes say
  // "Provider error <status>". Both must keep mapping.
  const status = reason.match(/(?:OSF|Provider) error (\d{3})/)?.[1];
  if (status === "503" || status === "502") {
    return "Your storage provider was temporarily unavailable.";
  }
  if (status === "429") {
    return "Your storage provider rate-limited the request.";
  }
  if (status === "401" || status === "403") {
    return "Authentication error. Your storage provider connection may need to be refreshed.";
  }
  return reason;
}

// Reassurance that is only true while retries are still running. Appended to
// the copy above for pending/processing entries and withheld once an entry
// has exhausted its retries -- a failed row used to sit under a "Failed"
// badge still telling the researcher the upload "is being retried
// automatically", which reads as "no action needed" at the exact moment
// manual recovery is the only thing that will save the file.
const STILL_RETRYING_SUFFIX = {
  CONTENTION: " It is being retried automatically.",
};

export function friendlyReason(entry) {
  const code = entry?.providerErrorCode;
  const copy =
    PROVIDER_SPECIFIC_COPY[code]?.[entry?.storageProvider] ?? PROVIDER_ERROR_COPY[code];
  if (copy) {
    const stillRetrying = entry?.status === "pending" || entry?.status === "processing";
    return stillRetrying ? `${copy}${STILL_RETRYING_SUFFIX[code] ?? ""}` : copy;
  }
  return reasonCopy(entry?.failureReason);
}

export { reasonCopy };

// ---------------------------------------------------------------------------
// "Kept for another" column -- how much longer DataPipe holds its own copy
// before the sweep deletes it. Moved here (from QueuePanel.js, which used to
// compute createdAt + a hardcoded 7 days and nothing else) once it became
// clear that number can be wrong: functions/src/upload-retention.ts writes a
// real `retainUntil` on a queue doc once an upload-failure notification for
// its experiment goes undelivered (extendRetentionForExperiment), and that
// field is what the sweep (upload-retention.ts's retentionDecision) actually
// checks -- not a flat 7-day rule. `retainUntil` only exists on a document
// once that extension has happened; most entries never get one and fall back
// to the plain 7-day promise the accordion's own copy states ("seven days, or
// up to fourteen if we couldn't deliver a failure notification").
// pages/admin/[experiment_id].js's queueEntries listener spreads the whole
// document (`...d.data()`), so `retainUntil` reaches the client whenever the
// server has written it -- there is no separate wiring needed here.
const RETENTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // matches upload-retention.ts's RETENTION_GRACE_MS

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate.getTime();
}

/**
 * timeRemaining
 *
 * How much longer DataPipe holds its copy of `entry`, as the string the
 * "Kept for another" column and the download-failure message both show.
 *
 * @param {object} entry - A `uploadQueue/{id}` document. Reads `retainUntil`
 *   (authoritative once present) and `createdAt` (the fallback base for the
 *   plain 7-day window).
 * @param {number} now - Caller-supplied clock, e.g. `Date.now()`, so this
 *   stays a pure function callers can test without faking global time.
 * @returns {string|null} `null` if there is no usable timestamp at all.
 */
export function timeRemaining(entry, now) {
  const retainUntilMs = toMillis(entry?.retainUntil);
  const createdMs = toMillis(entry?.createdAt);
  const expiresAtMs = retainUntilMs ?? (createdMs !== null ? createdMs + RETENTION_GRACE_MS : null);
  if (expiresAtMs === null) return null;

  const msLeft = expiresAtMs - now;
  if (msLeft <= 0) return "expiring soon";
  const hoursLeft = Math.floor(msLeft / (60 * 60 * 1000));
  if (hoursLeft >= 24) {
    const days = Math.floor(hoursLeft / 24);
    return `${days}d ${hoursLeft % 24}h`;
  }
  return `${hoursLeft}h`;
}
