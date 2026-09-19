import { relativeErrorTime, visibleErrors } from "../lib/error-panel";

// Fixed "now", per the spec: inject it as a parameter rather than mocking
// Date, so these tests describe boundaries in terms of the actual clock
// arithmetic instead of a frozen global.
const NOW = new Date("2026-09-19T12:00:00.000Z");

// The real Intl.RelativeTimeFormat, used to compute the EXPECTED string the
// same way relativeErrorTime does. Hardcoding literal strings like "1 day
// ago" would be brittle against numeric:"auto"'s colloquial forms
// ("yesterday", "last month", ...), which are a feature of the spec's
// required options, not a bug to work around.
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function secondsAgo(seconds) {
  return new Date(NOW.getTime() - seconds * 1000);
}

describe("relativeErrorTime — boundaries", () => {
  it("returns 'just now' for anything under a minute", () => {
    expect(relativeErrorTime(secondsAgo(0), NOW)).toBe("just now");
    expect(relativeErrorTime(secondsAgo(30), NOW)).toBe("just now");
    expect(relativeErrorTime(secondsAgo(59), NOW)).toBe("just now");
  });

  it("returns 'just now' for a future timestamp (clock skew)", () => {
    const future = new Date(NOW.getTime() + 5 * 60 * 1000);
    expect(relativeErrorTime(future, NOW)).toBe("just now");
  });

  it("reports minutes from 1 up to 59", () => {
    expect(relativeErrorTime(secondsAgo(60), NOW)).toBe(rtf.format(-1, "minute"));
    expect(relativeErrorTime(secondsAgo(60 * 59), NOW)).toBe(rtf.format(-59, "minute"));
    // Rounds down: 90 seconds is still only one full minute.
    expect(relativeErrorTime(secondsAgo(90), NOW)).toBe(rtf.format(-1, "minute"));
  });

  it("reports hours from 1 up to 23", () => {
    expect(relativeErrorTime(secondsAgo(60 * 60), NOW)).toBe(rtf.format(-1, "hour"));
    expect(relativeErrorTime(secondsAgo(60 * 60 * 23), NOW)).toBe(rtf.format(-23, "hour"));
  });

  it("reports days from 1 up to 29", () => {
    expect(relativeErrorTime(secondsAgo(60 * 60 * 24), NOW)).toBe(rtf.format(-1, "day"));
    expect(relativeErrorTime(secondsAgo(60 * 60 * 24 * 29), NOW)).toBe(rtf.format(-29, "day"));
  });

  it("reports months from day 30 through month 11", () => {
    expect(relativeErrorTime(secondsAgo(60 * 60 * 24 * 30), NOW)).toBe(rtf.format(-1, "month"));
    expect(relativeErrorTime(secondsAgo(60 * 60 * 24 * 30 * 11), NOW)).toBe(rtf.format(-11, "month"));
  });

  it("reports years from month 12 onward", () => {
    expect(relativeErrorTime(secondsAgo(60 * 60 * 24 * 30 * 12), NOW)).toBe(rtf.format(-1, "year"));
    expect(relativeErrorTime(secondsAgo(60 * 60 * 24 * 30 * 12 * 3), NOW)).toBe(rtf.format(-3, "year"));
  });
});

describe("relativeErrorTime — input shapes", () => {
  it("accepts a Firestore-Timestamp-like object with .toDate()", () => {
    const timestamp = { toDate: () => secondsAgo(60) };
    expect(relativeErrorTime(timestamp, NOW)).toBe(rtf.format(-1, "minute"));
  });

  it("accepts a plain {seconds, nanoseconds} object", () => {
    const plain = { seconds: Math.floor(secondsAgo(60 * 60).getTime() / 1000), nanoseconds: 0 };
    expect(relativeErrorTime(plain, NOW)).toBe(rtf.format(-1, "hour"));
  });

  it("accepts a Date instance directly", () => {
    expect(relativeErrorTime(secondsAgo(60 * 60 * 24), NOW)).toBe(rtf.format(-1, "day"));
  });

  it("returns null for the legacy preformatted string shape -- a relative time is impossible for it", () => {
    expect(relativeErrorTime("19/09/2026, 13:00:18 GMT-4", NOW)).toBeNull();
  });

  it("returns null for null, undefined, and malformed values", () => {
    expect(relativeErrorTime(null, NOW)).toBeNull();
    expect(relativeErrorTime(undefined, NOW)).toBeNull();
    expect(relativeErrorTime({}, NOW)).toBeNull();
    expect(relativeErrorTime({ seconds: "not-a-number" }, NOW)).toBeNull();
  });
});

describe("visibleErrors — count", () => {
  it("is logError minus logErrorCleared", () => {
    expect(visibleErrors({ logError: 9, logErrorCleared: 5 }).count).toBe(4);
  });

  it("defaults logErrorCleared to 0 when the list has never been cleared", () => {
    expect(visibleErrors({ logError: 9 }).count).toBe(9);
  });

  it("is 0 when logError is absent", () => {
    expect(visibleErrors({}).count).toBe(0);
    expect(visibleErrors().count).toBe(0);
  });

  it("is clamped to 0 rather than going negative", () => {
    expect(visibleErrors({ logError: 2, logErrorCleared: 5 }).count).toBe(0);
  });
});

describe("visibleErrors — rows, no clear has ever happened", () => {
  it("shows every entry, including legacy string-time ones (treated as current)", () => {
    const errors = [
      { error: "A", time: { seconds: 1, nanoseconds: 0 } },
      { error: "B", time: "19/09/2026, 13:00:18 GMT-4" },
    ];
    const { rows } = visibleErrors({ errors, logError: 2 });
    expect(rows).toEqual(errors);
  });

  it("tolerates a missing/malformed errors array", () => {
    expect(visibleErrors({ logError: 3, errors: undefined }).rows).toEqual([]);
    expect(visibleErrors({ logError: 3, errors: null }).rows).toEqual([]);
    expect(visibleErrors({ logError: 3, errors: [null, undefined, { error: "A", time: { seconds: 1 } }] }).rows)
      .toEqual([{ error: "A", time: { seconds: 1 } }]);
  });
});

describe("visibleErrors — rows, after a clear", () => {
  const clearedAt = { seconds: 1000, nanoseconds: 0 };

  it("hides real-timestamp rows at or before the clear, keeps rows strictly after it", () => {
    const before = { error: "BEFORE", time: { seconds: 500, nanoseconds: 0 } };
    const atClear = { error: "AT", time: { seconds: 1000, nanoseconds: 0 } };
    const after = { error: "AFTER", time: { seconds: 1500, nanoseconds: 0 } };
    const { rows } = visibleErrors({
      errors: [before, atClear, after],
      logError: 3,
      logErrorCleared: 2,
      errorsClearedAt: clearedAt,
    });
    expect(rows).toEqual([after]);
  });

  it("hides every legacy string-time row, even ones appended after the clear", () => {
    const stringRow = { error: "LEGACY", time: "19/09/2026, 13:00:18 GMT-4" };
    const { rows } = visibleErrors({
      errors: [stringRow],
      logError: 1,
      logErrorCleared: 0,
      errorsClearedAt: clearedAt,
    });
    expect(rows).toEqual([]);
  });

  it("count > 0 with an empty rows array is representable (e.g. the 50-cap rotated every pre-clear row out)", () => {
    const { count, rows } = visibleErrors({
      errors: [{ error: "OLD", time: { seconds: 1, nanoseconds: 0 } }],
      logError: 5,
      logErrorCleared: 2,
      errorsClearedAt: clearedAt,
    });
    expect(count).toBe(3);
    expect(rows).toEqual([]);
  });
});
