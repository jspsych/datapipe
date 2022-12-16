/**
 * @jest-environment node
 */

import validateCSV from "../functions/validate-csv";

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