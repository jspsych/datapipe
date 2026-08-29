// Whether a researcher's unuploaded data may be destroyed yet.
//
// Its own module, and a pure function, for two reasons. It decides the least
// reversible thing in this codebase -- deleting research data the researcher
// has not got back -- so it should be assertable as a table rather than
// provoked through a scheduler. And scheduled-upload-retry.ts, where the
// deletion actually happens, imports the whole provider stack; a test that
// wanted only this predicate would have to load all of it.
//
// ---------------------------------------------------------------------------
// WHY THE PLAIN AGE TEST WAS NOT ENOUGH
// ---------------------------------------------------------------------------
//
// The cleanup sweep used to delete on `createdAt <= now - 7d` alone -- no check
// on status, and no check on whether anyone had been told. Two ways that loses
// data nobody meant to lose:
//
//   1. A STORAGE PROVIDER OUTAGE. The entry is still `pending` with retries
//      left, so it would have uploaded fine on day eight. Deleting it on day
//      seven throws away data that was never actually lost.
//
//   2. A NOTIFICATION THAT NEVER ARRIVED. The seven days are counted from
//      SUBMISSION, so part of the window is already spent before anything goes
//      wrong -- and if the notification died (a Resend quota outage, say) the
//      researcher's window closes without them ever learning there was one.
//
// `retainUntil` is written by scheduled-mail-retry.ts while an upload-failure
// notification for the experiment is still undelivered and still deliverable.
//
// NOTE WHAT DOES NOT WRITE IT. An experiment whose owner has no contact email
// never produces a mail document at all -- upload-failure-notify.ts records
// `suppressedReason: "no-contact-email"` and returns before enqueuing -- so it
// is never extended and keeps the plain seven days. That is the right answer
// when there is nobody to tell, and it falls out of the design rather than
// being special-cased.

// The ceiling on everything below. An entry is deleted once it reaches this
// age no matter what else is still true about it.
//
// The extensions exist so a researcher gets a fair chance to act on data that
// has not uploaded. This exists so that chance cannot become permanent storage
// of research payloads DataPipe was never able to deliver: an experiment whose
// provider is dead and whose owner never reads their mail would otherwise
// accumulate forever, silently, at DataPipe's cost. Fourteen days is the plain
// seven a researcher was always promised, plus another seven to absorb an
// outage or a missed notification.
export const ABSOLUTE_MAX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function millisOrZero(value: unknown): number {
  if (!value || typeof (value as { toMillis?: unknown }).toMillis !== "function") {
    return 0;
  }
  return (value as { toMillis: () => number }).toMillis();
}

/**
 * Is this aged-out queue entry safe to delete?
 *
 * Only ever asked about entries the sweep has already found by age, so
 * "delete" here means "the seven days are up AND none of the reasons to keep it
 * apply".
 */
export function retentionDecision(
  data: FirebaseFirestore.DocumentData,
  nowMs: number
): "delete" | "retain" {
  const createdAt = millisOrZero(data.createdAt);

  // The ceiling wins over every reason to keep it. Checked FIRST, and checked
  // even when createdAt is missing or unreadable -- an entry must not become
  // immortal by lacking a field.
  if (createdAt === 0 || nowMs - createdAt >= ABSOLUTE_MAX_RETENTION_MS) {
    return "delete";
  }

  // Still live work. The upload itself may yet succeed, which makes this data
  // not merely un-notified but not actually lost. "Pending" alone is not
  // enough: an entry that has spent its whole retry budget is not live work,
  // it is a corpse with a hopeful status.
  const retryCount = typeof data.retryCount === "number" ? data.retryCount : 0;
  const maxRetries = typeof data.maxRetries === "number" ? data.maxRetries : 0;
  if (data.status === "pending" && retryCount < maxRetries) {
    return "retain";
  }

  // The researcher has not been told yet, and still might be.
  if (millisOrZero(data.retainUntil) > nowMs) {
    return "retain";
  }

  return "delete";
}
