/**
 * @jest-environment node
 *
 * isValidDocumentId (experiment-id.ts) -- the gate between a client-supplied
 * id and db.collection(...).doc(id). Named for what it actually checks (any
 * Firestore document id), not just the experiments collection: api-queue-
 * status.ts runs its `download` queue-entry id through the same check, and
 * write-log.ts its logs/{experimentID} id. It was renamed from
 * isValidExperimentId to isValidDocumentId to reflect that; the logic itself
 * is unchanged.
 *
 * The bug this guards against: Firestore does not treat an invalid document
 * id as a lookup miss, it THROWS synchronously out of doc()/get() for a
 * handful of specific shapes -- most commonly a participant site that never
 * filled in a template placeholder, e.g. "__DATAPIPE_STUDY1_ID__", which
 * matches Firestore's own reserved __...__ pattern. That throw was escaping
 * every public endpoint that looked an experiment up by id as an unhandled
 * 500, instead of the ordinary 400 EXPERIMENT_NOT_FOUND a nonexistent id
 * already gets.
 *
 * Unlike isValidSessionId (staging.ts), this is deliberately NOT pinned to
 * the nanoid alphabet create-experiment.ts mints new ids from -- older
 * experiment ids may use other formats, so this only has to reject what
 * Firestore itself would reject.
 */

const { isValidDocumentId } = require("../../lib/experiment-id.js");

describe("isValidDocumentId", () => {
  it.each([
    ["a 12-char nanoid-style id, as create-experiment.ts mints", "aB3xY9kLm2Qz"],
    ["an id with mixed alphanumeric, hyphen and underscore characters", "abc-DEF_123"],
  ])("accepts %s", (_label, value) => {
    expect(isValidDocumentId(value)).toBe(true);
  });

  it.each([
    ["the empty string", ""],
    ["a reserved __...__ id (the unfilled-template-placeholder case)", "__DATAPIPE_STUDY1_ID__"],
    ["a reserved __...__ id with nothing in between", "____"],
    ["an id containing a forward slash", "abc/def"],
    ["a leading slash", "/abc"],
    ["exactly a single period", "."],
    ["exactly a double period", ".."],
    ["longer than 1500 bytes in UTF-8", "a".repeat(1501)],
    // A multi-byte character pushes this over 1500 BYTES despite being under
    // 1500 JS string characters -- proves the check is byte-length, not
    // string-length.
    ["over 1500 bytes via multi-byte characters, under 1500 JS characters", "é".repeat(751)],
  ])("rejects %s", (_label, value) => {
    expect(isValidDocumentId(value)).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 123],
    ["a plain object", {}],
    ["an array", ["a"]],
    ["a boolean", true],
  ])("rejects %s (not a string)", (_label, value) => {
    expect(isValidDocumentId(value)).toBe(false);
  });

  it("accepts an id exactly at the 1500-byte boundary", () => {
    expect(isValidDocumentId("a".repeat(1500))).toBe(true);
  });

  it("accepts a period or double period as part of a longer id, not standing alone", () => {
    expect(isValidDocumentId("a.b")).toBe(true);
    expect(isValidDocumentId("a..b")).toBe(true);
  });
});
