import { db } from "./app.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { StorageProviderId } from "./providers/types.js";

/**
 * logs/{experimentID} — the per-experiment activity record.
 *
 * Two audiences read this document, and they want different things from it:
 *
 *  - The researcher, through the experiment dashboard, wants to know whether
 *    submissions are being rejected and why.
 *  - The service operator wants to answer cross-experiment questions — which
 *    storage providers are failing, how often, and which experiments are still
 *    live — without scanning every experiment's data.
 *
 * WHAT CHANGED AND WHY
 *
 * 1. `owner` is now written on every log write. It was never written at all,
 *    while firestore.rules gates reads on `resource.data.owner ==
 *    request.auth.uid` — so the rule could never pass and NO researcher ever
 *    saw their own error log. The dashboard subscription failed silently and
 *    ErrorPanel simply never rendered. Log documents created before this
 *    change still have no owner; functions/scripts/backfill-log-owner.mjs
 *    exists to fix those once.
 *
 * 2. `storageProvider` is denormalized here. Counting experiments per provider
 *    is better done against the experiments collection (that is the source of
 *    truth, and a count() aggregation answers it directly). What experiments
 *    cannot answer is the per-provider FAILURE rate, which needs the provider
 *    name and the error tallies in the same document.
 *
 * 3. `errors` is capped at MAX_ERROR_ENTRIES. It grew by arrayUnion with no
 *    bound, inside a document with a 1 MB ceiling. An experiment that errors
 *    on every submission would eventually make every write to this document
 *    fail — taking the counters down with it. The cap costs one read per error
 *    (the transaction below); error paths are the exceptional case, and the
 *    counter paths still take no read at all.
 *
 * 4. `time` on an error entry is a real Timestamp, not a preformatted en-GB
 *    string. The string could not be sorted, filtered, or aged out. It is
 *    Timestamp.now() rather than serverTimestamp() because Firestore rejects
 *    sentinel values inside an array — so this is the function's clock, not
 *    the server's, and may differ by milliseconds.
 *
 * 5. The counter and the error entry are written in ONE operation. They used
 *    to be two separate non-atomic set() calls, which left the document with
 *    `logError > 0` and no `errors` field in between — a state the dashboard
 *    had to defend against (see components/dashboard/ErrorPanel.js).
 *
 * 6. `errorsByCode` tallies errors by their api-messages.ts code. Combined
 *    with `storageProvider` this is what makes "which provider is failing and
 *    how" a query rather than a scan, and it is a fixed-size map rather than
 *    an unbounded array.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * `firstRequestAt`. Recording it needs a read of this document on the hot
 * submission path just to discover whether the field is already set, and
 * Firestore has no set-if-absent sentinel. `createdAt` — seeded by
 * create-experiment.ts in a batch it was already committing, so it costs
 * nothing — answers the same question, and `lastRequestAt` covers recency.
 *
 * A per-request event trail. One document per submission would multiply
 * writes by the request rate. The counters plus the last MAX_ERROR_ENTRIES
 * rejections are what the dashboard and the health queries actually read.
 */

// One increment per API call that reached a real experiment. These count
// ATTEMPTS: `saveData` is incremented after the experiment document is
// confirmed to exist, so a request carrying a garbage experiment ID no longer
// inflates the count (or creates a log document that nobody can ever read).
export type LogCounter = "saveData" | "saveBase64Data" | "getCondition";

// One increment per request that reached a definite non-failure outcome.
// "Succeeded" means the file is in the researcher's storage now; "Queued"
// means DataPipe holds it and will retry (an HTTP 202).
//
// There is no ...Failed counter: failures are every remaining attempt, so
//   failed = saveData - saveDataSucceeded - saveDataQueued
// exactly, and a counter that has to be incremented at nineteen separate
// return points is a counter that will drift the first time a branch is added.
export type LogOutcome =
  | "saveDataSucceeded"
  | "saveDataQueued"
  | "saveBase64DataSucceeded"
  | "saveBase64DataQueued";

export type LogAction = LogCounter | LogOutcome | "logError";

// Identity for the log document, taken from the experiment the request
// resolved to. Every call site that has already read the experiment passes
// this; the ones that could not (the experiment does not exist) pass nothing,
// and the fields are simply omitted rather than written as undefined, which
// Firestore rejects.
export interface LogContext {
  owner?: string;
  storageProvider?: StorageProviderId | string;
}

// Chosen against the 1 MB document limit with room to spare: an error entry
// carrying a long provider message runs a few hundred bytes, so fifty of them
// is tens of kilobytes. The dashboard shows twenty.
export const MAX_ERROR_ENTRIES = 50;

// Bucket for an error entry with no api-messages.ts code of its own.
export const UNCODED_ERROR = "UNCODED";

function identityFields(context?: LogContext): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (context?.owner) fields.owner = context.owner;
  if (context?.storageProvider) fields.storageProvider = context.storageProvider;
  return fields;
}

// Firestore map keys cannot contain . / ~ * [ ]. Every code in
// api-messages.ts is already [A-Z_]+, so this only ever fires on an entry
// that invented its own code — but a rejected write here would take the
// counter down with it, and a log write must never be the thing that fails.
function safeCodeKey(code: string): string {
  const cleaned = code.replace(/[./~*[\]]/g, "_").slice(0, 100);
  return cleaned.length > 0 ? cleaned : UNCODED_ERROR;
}

function errorCodeOf(error?: object): string {
  const code = (error as { error?: unknown } | undefined)?.error;
  return typeof code === "string" && code.length > 0
    ? safeCodeKey(code)
    : UNCODED_ERROR;
}

export default async function writeLog(
  experimentID: string,
  action: LogAction,
  error?: object,
  context?: LogContext
): Promise<boolean> {
  try {
    const log_doc_ref = db.collection("logs").doc(experimentID);

    // Counters and outcomes: a single merge, no read.
    if (action !== "logError") {
      await log_doc_ref.set(
        {
          ...identityFields(context),
          [action]: FieldValue.increment(1),
          lastRequestAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return true;
    }

    // ISSUE #76. The transaction is what makes the cap possible: arrayUnion
    // can append but cannot trim, so the tail has to be computed from the
    // current value. It also collapses what used to be two non-atomic writes
    // into one.
    const entry = { ...error, time: Timestamp.now() };
    const code = errorCodeOf(error);

    await db.runTransaction(async (t) => {
      const snap = await t.get(log_doc_ref);
      const existing = snap.exists ? snap.get("errors") : undefined;
      const errors: unknown[] = Array.isArray(existing) ? existing : [];
      // Oldest entries fall off the front. slice(-N) on an array shorter than
      // N returns the whole array, so this is also correct while filling up.
      const trimmed = [...errors, entry].slice(-MAX_ERROR_ENTRIES);

      t.set(
        log_doc_ref,
        {
          ...identityFields(context),
          logError: FieldValue.increment(1),
          // Nested map, not an "errorsByCode.CODE" dotted key: set() with
          // merge treats a dot in a key as part of the field NAME, unlike
          // update(). The increment sentinel applies correctly inside a
          // nested map under merge.
          errorsByCode: { [code]: FieldValue.increment(1) },
          errors: trimmed,
          lastRequestAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return true;
  } catch (error) {
    console.error(`writeLog failed for experiment ${experimentID}, action ${action}:`, error instanceof Error ? error.message : error);
    return false;
  }
}
