/**
 * @jest-environment node
 */

import validateCSV from "../functions/lib/validate-csv.js";

describe("validateCSV", () => {
  it("should return true when all required fields are present", () => {
    const csv = `foo,bar\nbaz,qux`;
    const requiredFields = ['foo'];
    expect(validateCSV(csv, requiredFields)).toBe(true);
  });

  it("should return true when all required fields are present (multiple fields)", () => {
    const csv = `foo,bar\nbaz,qux`;
    const requiredFields = ['foo', 'bar'];
    expect(validateCSV(csv, requiredFields)).toBe(true);
  });

  it("should return false when a required field is missing", () => {
    const csv = `foo,bar\nbaz,qux`;
    const requiredFields = ['foo', 'baz'];
    expect(validateCSV(csv, requiredFields)).toBe(false);
  });

});

// Regression coverage for GitHub issue #95. See validate-json.test.js for
// the full explanation: legacy experiment docs can carry requiredFields as
// `[""]` rather than `[]`, and `requiredFields.every(...)` demanded a column
// literally named "" -- which no CSV header row has -- so validation always
// failed. validateCSV now normalizes the incoming list before checking it.
describe("empty/blank entries in requiredFields (#95)", () => {
  const csv = `foo,bar\nbaz,qux`;

  it("treats [\"\"] the same as no required fields", () => {
    expect(validateCSV(csv, [""])).toBe(true);
  });

  it("treats [] the same as no required fields", () => {
    expect(validateCSV(csv, [])).toBe(true);
  });

  it("treats undefined the same as no required fields", () => {
    expect(validateCSV(csv, undefined)).toBe(true);
  });

  it("ignores whitespace-only entries", () => {
    expect(validateCSV(csv, ["   ", "\t", ""])).toBe(true);
  });

  it("still enforces a genuine field alongside empty/whitespace entries", () => {
    expect(validateCSV(csv, ["", "  ", "foo"])).toBe(true);
    expect(validateCSV(csv, ["", "  ", "missing"])).toBe(false);
  });

  it("still rejects malformed CSV even when requiredFields is empty-only", () => {
    const ragged = "foo,bar\nbaz,qux,extra";
    expect(validateCSV(ragged, [""])).toBe(false);
  });
});