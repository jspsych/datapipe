/**
 * Pure logic shared by `components/dashboard/ErrorPanel.js` and
 * `pages/admin/[experiment_id].js`. Both need the same two answers --
 * "how many rejections since the researcher last cleared the list" and
 * "roughly when was the most recent one" -- and having two copies is how the
 * page's header chip and the panel body end up disagreeing about whether
 * there is anything to show. Kept in `lib/` (rather than inside the
 * component) specifically so the page can import it too.
 */

/**
 * relativeErrorTime
 *
 * "N minutes/hours/days/months/years ago", for the ErrorPanel headline. Takes
 * `now` as a parameter rather than reading `Date.now()` itself, so a caller
 * (or a test) can pin it.
 *
 * Accepts the same three shapes `formatErrorTime` (ErrorPanel.js) already
 * handles for a real timestamp -- a Firestore Timestamp (`.toDate()`), a
 * plain `{seconds, nanoseconds}` (what a Timestamp becomes once it has been
 * serialized), or a `Date`. It deliberately does NOT accept the legacy
 * preformatted string shape: there is no date to measure a relative offset
 * against, so the caller must special-case that shape itself (ErrorPanel.js
 * renders "The most recent was on <string>." instead of calling this at
 * all).
 *
 * Rounds down (`Math.floor`) at every step, per the spec this implements: a
 * rejection 119 seconds ago reads "1 minute ago", not "2 minutes ago" --
 * consistent with every other "time ago" convention.
 *
 * A future timestamp -- clock skew between this machine and whatever wrote
 * `time` -- collapses to "just now" rather than a nonsensical "in 3 seconds"
 * on a panel that only ever describes the past.
 *
 * @param {*} time - A Timestamp-shaped value, a `{seconds}` object, or a
 *   Date. Returns null for anything else (including a string), so the
 *   caller's guard doubles as the "is this shape usable at all" check.
 * @param {Date} [now] - The instant to measure against. Defaults to the
 *   current time; tests should always pass this explicitly.
 * @returns {string|null} A relative phrase, or null if `time` could not be
 *   turned into a real date.
 */
export function relativeErrorTime(time, now = new Date()) {
  if (typeof time === "string" || !time) return null;

  let date = null;
  if (typeof time.toDate === "function") {
    date = time.toDate();
  } else if (typeof time.seconds === "number") {
    date = new Date(time.seconds * 1000);
  } else if (time instanceof Date) {
    date = time;
  }
  if (!date || Number.isNaN(date.getTime())) return null;

  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSeconds < 60) return "just now"; // covers clock skew (a negative diff) too

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return rtf.format(-diffMinutes, "minute");

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return rtf.format(-diffHours, "hour");

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return rtf.format(-diffDays, "day");

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return rtf.format(-diffMonths, "month");

  const diffYears = Math.floor(diffMonths / 12);
  return rtf.format(-diffYears, "year");
}

// A real Timestamp (or Timestamp-shaped object) in milliseconds, or null if
// `time` is not one -- shared by `visibleErrors` below. A legacy string is
// deliberately NOT a real timestamp here: it cannot be compared against
// `errorsClearedAt`, which is the whole reason it needs its own branch below
// rather than being coerced into a date.
function realTimeMillis(time) {
  if (!time || typeof time === "string") return null;
  if (typeof time.toDate === "function") {
    const date = time.toDate();
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  if (typeof time.seconds === "number") return time.seconds * 1000;
  if (time instanceof Date) {
    return Number.isNaN(time.getTime()) ? null : time.getTime();
  }
  return null;
}

/**
 * visibleErrors
 *
 * What ErrorPanel.js is allowed to show, given that `logs/{id}` keeps a
 * lifetime record (`logError`, `errors`, `errorsByCode`) that
 * `functions/src/clear-errors.ts` never touches, plus a watermark
 * (`errorsClearedAt` / `logErrorCleared`) it writes when the researcher
 * clicks "Clear this list".
 *
 *  - `count`: rejections SINCE the watermark, i.e. `logError` minus whatever
 *    `logError` was AT the watermark. Never negative -- `logErrorCleared` is
 *    only ever a value `logError` actually held, but a clamp costs nothing
 *    and protects against a future write-log.ts change that reorders the two
 *    fields.
 *  - `rows`: the entries of `errors` a researcher is allowed to see. Only
 *    entries with a REAL timestamp strictly after `errorsClearedAt` qualify.
 *    Entries carrying the legacy preformatted string `time` can't be
 *    compared to a watermark at all, so they take the safe reading in both
 *    directions: once a clear has happened they are treated as older than it
 *    (hidden, same as any other pre-clear rejection would be), and when no
 *    clear has EVER happened they are treated as current (shown, exactly
 *    the un-gated behavior this replaces).
 *
 * `count` and `rows.length` are allowed to disagree. `errors` is capped at
 * 50 by write-log.ts, and legacy string-time entries are invisible after a
 * clear -- either can leave `count > 0` with `rows` empty, which is why the
 * caller (ErrorPanel.js) renders the headline in that case but skips the
 * accordion rather than showing an empty table.
 *
 * @param {object} [logs] - The relevant slice of `logs/{id}`.
 * @param {Array<object>|undefined} [logs.errors]
 * @param {number|undefined} [logs.logError]
 * @param {number|undefined} [logs.logErrorCleared]
 * @param {*} [logs.errorsClearedAt] - Timestamp-shaped, or absent if no
 *   clear has ever happened.
 * @returns {{count: number, rows: Array<object>}}
 */
export function visibleErrors({ errors, logError, logErrorCleared, errorsClearedAt } = {}) {
  const total = typeof logError === "number" ? logError : 0;
  const cleared = typeof logErrorCleared === "number" ? logErrorCleared : 0;
  const count = Math.max(0, total - cleared);

  const all = Array.isArray(errors) ? errors.filter(Boolean) : [];
  const clearedAtMillis = realTimeMillis(errorsClearedAt);

  const rows =
    clearedAtMillis === null
      ? all
      : all.filter((entry) => {
          const entryMillis = realTimeMillis(entry?.time);
          return entryMillis !== null && entryMillis > clearedAtMillis;
        });

  return { count, rows };
}
