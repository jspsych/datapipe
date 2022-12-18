/**
 * @jest-environment node
 */

import validateJSON from "../functions/validate-json";

describe("validateJSON", () => {
  it("should return true when all required fields are present", () => {
    const json = `{"foo": "bar"}`;
    const requiredFields = ['foo'];
    expect(validateJSON(json, requiredFields)).toBe(true);
  });

  it("should return false when a required field is missing", () => {
    const json = `{"foo": "bar"}`;
    const requiredFields = ['foo', 'baz'];
    expect(validateJSON(json, requiredFields)).toBe(false);
  });

  it("should return true when all required fields are present in an array", () => {
    const json = `[{"foo": "bar"}, {"foo": "baz"}]`;
    const requiredFields = ['foo'];
    expect(validateJSON(json, requiredFields)).toBe(true);
  });

  it("should return true when all required fields are present in at least one array item", () => {
    const json = `[{"foo": "bar"}, {"baz": "qux"}]`;
    const requiredFields = ['foo'];
    expect(validateJSON(json, requiredFields)).toBe(true);
  });

  it("should return true when all required fields are present in all array items", () => {
    const json = `[{"trial_type": "bar", "baz":"qux"}, {"trial_type": "bar", "baz":"quz"}]`;
    const requiredFields = ['trial_type'];
    expect(validateJSON(json, requiredFields)).toBe(true);
  });

  it("should return true when all required fields are present in at least one array item, even if in different items", () => {
    const json = `[{"foo": "bar"}, {"baz": "qux"}]`;
    const requiredFields = ['foo', 'baz'];
    expect(validateJSON(json, requiredFields)).toBe(true);
  });
  
  it("should return false for invalid JSON string", () => {
    const json = `{"foo": "bar"`;
    const requiredFields = ['foo'];
    expect(validateJSON(json, requiredFields)).toBe(false);
  });
});