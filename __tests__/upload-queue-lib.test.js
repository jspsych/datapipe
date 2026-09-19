import { queueEntryKind, summarizeQueue, friendlyReason, timeRemaining } from "../lib/upload-queue";

// Real entry shapes, one per writer, as documented in lib/upload-queue.js's
// header comment. Each omits fields the writer omits (never invents a field
// no writer sets) so a predicate change that starts depending on an
// undocumented field fails here first.

describe("queueEntryKind — real writer shapes", () => {
  it("a recovered abandoned session (scheduled-staging-sweep.ts) is waiting", () => {
    const entry = {
      status: "pending",
      retryCount: 0,
      lastAttemptAt: null,
      failureReason: "Recovered from an abandoned session (50 trials)",
      partial: true,
    };
    expect(queueEntryKind(entry)).toBe("waiting");
  });

  it("a raw file kept after a metadata failure (scheduled-pending-recovery.ts) is waiting", () => {
    const entry = {
      status: "pending",
      retryCount: 0,
      lastAttemptAt: null,
      failureReason: "Kept after a metadata failure (raw data stored without Psych-DS files)",
    };
    expect(queueEntryKind(entry)).toBe("waiting");
  });

  it("the generic interrupted-upload recovery reason is waiting", () => {
    const entry = {
      status: "pending",
      retryCount: 0,
      lastAttemptAt: null,
      failureReason: "Recovered from interrupted upload (server restart or memory limit)",
    };
    expect(queueEntryKind(entry)).toBe("waiting");
  });

  it("a fresh compaction hold (api-data.ts) is waiting, even though it carries a providerErrorCode", () => {
    // api-data.ts sets providerErrorCode: "CONTENTION" on this branch purely
    // to land the entry on the 60-second fast retry tier -- not because a
    // provider write failed. See lib/upload-queue.js's header comment.
    const entry = {
      status: "pending",
      retryCount: 0,
      lastAttemptAt: null,
      failureReason: "Compaction in progress",
      providerErrorCode: "CONTENTION",
    };
    expect(queueEntryKind(entry)).toBe("waiting");
  });

  it("a cold collision-cache rehydration hold is waiting", () => {
    const entry = {
      status: "pending",
      retryCount: 0,
      lastAttemptAt: null,
      failureReason: "Collision cache rehydrating",
    };
    expect(queueEntryKind(entry)).toBe("waiting");
  });

  it("a provider failure queued by api-data.ts with no lastAttemptAt yet is retrying, not waiting", () => {
    // The queue-upload.ts default: fresh queue docs always start with
    // lastAttemptAt null and retryCount 0, whether or not they represent a
    // real provider failure. What tells this apart from a held entry is the
    // failureReason, not the never-attempted fields alone.
    const entry = {
      status: "pending",
      retryCount: 0,
      lastAttemptAt: null,
      failureReason: "Provider error 503: Service Unavailable",
      providerErrorCode: "UNAVAILABLE",
    };
    expect(queueEntryKind(entry)).toBe("retrying");
  });

  it("a held entry the retry worker bounced back without attempting it is still waiting", () => {
    // scheduled-upload-retry.ts's isCompactionInFlight branch: the claim
    // transaction stamped lastAttemptAt, then the entry went straight back to
    // "pending" with COMPACTION_HOLD_REASON and retryCount untouched. No
    // upload was attempted, so nothing has failed.
    const entry = {
      status: "pending",
      retryCount: 0,
      lastAttemptAt: { toDate: () => new Date("2026-09-19T11:00:00Z") },
      failureReason: "Compaction in progress",
      providerErrorCode: "CONTENTION",
    };
    expect(queueEntryKind(entry)).toBe("waiting");
  });

  it("a held entry is still waiting during its first attempt", () => {
    // The worker sets lastAttemptAt in the same write that flips the entry to
    // "processing", before it has tried anything.
    const entry = {
      status: "processing",
      retryCount: 0,
      lastAttemptAt: { toDate: () => new Date("2026-09-19T11:00:00Z") },
      failureReason: "Recovered from an abandoned session (50 trials)",
      providerErrorCode: null,
    };
    expect(queueEntryKind(entry)).toBe("waiting");
  });

  it("a held reason with a non-zero retryCount is retrying", () => {
    const entry = {
      status: "pending",
      retryCount: 1,
      lastAttemptAt: null,
      failureReason: "Compaction in progress",
    };
    expect(queueEntryKind(entry)).toBe("retrying");
  });

  it("status failed always wins, regardless of failureReason", () => {
    const entry = {
      status: "failed",
      retryCount: 5,
      lastAttemptAt: { toDate: () => new Date() },
      failureReason: "Kept after a metadata failure (raw data stored without Psych-DS files)",
    };
    expect(queueEntryKind(entry)).toBe("failed");
  });

  it("an ordinary retrying/processing entry is retrying", () => {
    expect(
      queueEntryKind({
        status: "processing",
        retryCount: 2,
        lastAttemptAt: { toDate: () => new Date() },
        failureReason: "Upload exception: fetch failed",
      })
    ).toBe("retrying");
  });
});

describe("summarizeQueue", () => {
  const failedEntry = { status: "failed" };
  const retryingEntry = {
    status: "pending",
    retryCount: 1,
    lastAttemptAt: { toDate: () => new Date() },
  };
  const waitingEntry = {
    status: "pending",
    retryCount: 0,
    lastAttemptAt: null,
    failureReason: "Compaction in progress",
  };

  it("tone is 'error' if anything failed, regardless of what else is present", () => {
    expect(summarizeQueue([failedEntry, retryingEntry, waitingEntry]).tone).toBe("error");
    expect(summarizeQueue([failedEntry]).tone).toBe("error");
  });

  it("tone is 'warning' if nothing failed but something is retrying", () => {
    expect(summarizeQueue([retryingEntry, waitingEntry]).tone).toBe("warning");
    expect(summarizeQueue([retryingEntry]).tone).toBe("warning");
  });

  it("tone is 'neutral' if everything present is only waiting", () => {
    expect(summarizeQueue([waitingEntry]).tone).toBe("neutral");
  });

  it("counts each kind correctly", () => {
    const result = summarizeQueue([failedEntry, failedEntry, retryingEntry, waitingEntry, waitingEntry]);
    expect(result).toEqual({ failed: 2, retrying: 1, waiting: 2, tone: "error" });
  });

  it("handles an empty queue", () => {
    expect(summarizeQueue([])).toEqual({ failed: 0, retrying: 0, waiting: 0, tone: "neutral" });
  });
});

describe("friendlyReason — new/changed rows", () => {
  it("interpolates the abandoned-session notes ($1) into the sentence", () => {
    const entry = {
      status: "pending",
      failureReason: "Recovered from an abandoned session (50 trials, 2 missing, 1 unreadable)",
    };
    expect(friendlyReason(entry)).toBe(
      "Recovered from a session that did not finish (50 trials, 2 missing, 1 unreadable). It will be stored as a partial file."
    );
  });

  it("explains a metadata-kept file without the old 'interrupted' wording", () => {
    const entry = {
      status: "pending",
      failureReason: "Kept after a metadata failure (raw data stored without Psych-DS files)",
    };
    expect(friendlyReason(entry)).toBe(
      "DataPipe could not generate Psych-DS metadata for this submission, so it is storing the raw file without it."
    );
    expect(friendlyReason(entry)).not.toMatch(/server restart or memory limit/i);
  });

  it("gives the generic interrupted-upload reason its new, non-alarming text", () => {
    const entry = {
      status: "pending",
      failureReason: "Recovered from interrupted upload (server restart or memory limit)",
    };
    expect(friendlyReason(entry)).toBe(
      "DataPipe kept a copy of this submission because it could not finish processing it when it arrived, and is storing it now."
    );
  });

  it("explains a compaction hold", () => {
    const entry = { status: "pending", failureReason: "Compaction in progress" };
    expect(friendlyReason(entry)).toBe(
      "Held while DataPipe combines this experiment's stored files into an archive. It will be stored as soon as that finishes."
    );
  });

  it("keeps the unchanged 'Collision cache rehydrating' copy", () => {
    const entry = { status: "pending", failureReason: "Collision cache rehydrating" };
    expect(friendlyReason(entry)).toBe(
      "DataPipe was still checking this experiment's existing filenames when this submission arrived."
    );
  });

  it("'Kept after a metadata failure' is matched before the generic interrupted-upload row even if a future string overlapped", () => {
    // Not a real collision today (the two literal strings share no
    // substring), but pins the required ordering so a future edit to either
    // string cannot silently reverse it.
    const metadataReason = "Kept after a metadata failure (raw data stored without Psych-DS files)";
    expect(friendlyReason({ status: "pending", failureReason: metadataReason })).not.toMatch(
      /could not finish processing it when it arrived/i
    );
  });
});

// -----------------------------------------------------------------------
// timeRemaining -- the "Kept for another" column and the download-failure
// message's "DataPipe still has this file for another {stored}" clause.
// Pure and takes `now` as a parameter (see lib/upload-queue.js's header
// comment on this function) so every case below is exact, not a race
// against Date.now().
// -----------------------------------------------------------------------

describe("timeRemaining", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.parse("2026-09-19T12:00:00Z");

  it("falls back to createdAt + 7 days when retainUntil is absent", () => {
    const entry = { createdAt: new Date(NOW - DAY) }; // 1 day old, no retainUntil
    // 7 days minus the 1 day already elapsed = 6 days left.
    expect(timeRemaining(entry, NOW)).toBe("6d 0h");
  });

  it("uses retainUntil when present, even though it disagrees with createdAt + 7 days", () => {
    const entry = {
      // createdAt alone would say ~6d, but an undelivered failure
      // notification (functions/src/upload-retention.ts's
      // extendRetentionForExperiment) has pushed the real expiry out to 10
      // days from now -- retainUntil is what actually gates deletion
      // (upload-retention.ts's retentionDecision), so it must win.
      createdAt: new Date(NOW - DAY),
      retainUntil: { toMillis: () => NOW + 10 * DAY },
    };
    expect(timeRemaining(entry, NOW)).toBe("10d 0h");
  });

  it("accepts a Firestore Timestamp-shaped retainUntil (toMillis) or a plain Date", () => {
    const withTimestamp = timeRemaining(
      { retainUntil: { toMillis: () => NOW + 2 * DAY } },
      NOW
    );
    const withDate = timeRemaining({ retainUntil: new Date(NOW + 2 * DAY) }, NOW);
    expect(withTimestamp).toBe("2d 0h");
    expect(withDate).toBe("2d 0h");
  });

  it("returns 'expiring soon' once the deadline (from either field) has passed", () => {
    expect(timeRemaining({ createdAt: new Date(NOW - 8 * DAY) }, NOW)).toBe(
      "expiring soon"
    );
    expect(
      timeRemaining(
        { createdAt: new Date(NOW), retainUntil: { toMillis: () => NOW - 1000 } },
        NOW
      )
    ).toBe("expiring soon");
  });

  it("returns null when there is no createdAt and no retainUntil to compute from", () => {
    expect(timeRemaining({}, NOW)).toBeNull();
  });

  it("reports whole hours under a day, and days+hours at or above a day", () => {
    expect(timeRemaining({ createdAt: new Date(NOW) }, NOW)).toBe("7d 0h");
    expect(
      timeRemaining({ retainUntil: { toMillis: () => NOW + 5 * 60 * 60 * 1000 } }, NOW)
    ).toBe("5h");
  });
});
