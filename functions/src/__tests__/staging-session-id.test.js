/**
 * @jest-environment node
 *
 * isValidSessionId (staging.ts) -- the gate between a client-supplied
 * sessionId and the RTDB paths discardSession splices it into.
 *
 * The bug this guards against: the Firebase Admin SDK normalizes a path by
 * dropping empty segments before it reaches the wire, so a sessionId of "/"
 * resolves to "/staging" and "/openSessions" THEMSELVES -- deleting every
 * in-progress session for every experiment, unauthenticated, from a single
 * closed-experiment request. "//", "a/b", "../x", and non-strings are the
 * same class of value. isValidSessionId has to refuse all of them while still
 * accepting every id the server itself mints.
 */

const { isValidSessionId, generateSessionId } = require("../../lib/staging.js");

describe("isValidSessionId", () => {
  it("accepts ids in the format the server actually mints", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateSessionId();
      expect(isValidSessionId(id)).toBe(true);
    }
  });

  it.each([
    ["a bare slash -- normalizes to the root of staging/ and openSessions/", "/"],
    ["a double slash", "//"],
    ["an embedded slash", "a/b"],
    ["the empty string", ""],
    ["a parent-directory segment", "../x"],
    ["a leading parent-directory segment with no slash before it", "..x"],
    ["a too-short id", generateSessionId().slice(0, 23)],
    ["a too-long id", generateSessionId() + "x"],
    ["a disallowed character", generateSessionId().slice(0, 23) + "!"],
    ["a disallowed character (dot)", generateSessionId().slice(0, 23) + "."],
    ["whitespace", " ".repeat(24)],
  ])("rejects %s", (_label, value) => {
    expect(isValidSessionId(value)).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 123],
    ["a plain object", {}],
    ["an array", ["a"]],
    ["a boolean", true],
  ])("rejects %s (not a string)", (_label, value) => {
    expect(isValidSessionId(value)).toBe(false);
  });
});
