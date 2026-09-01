/**
 * @jest-environment node
 */

import validateJSON from "../functions/lib/validate-json.js";

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

  it("should work for real jsPsych data", () => {
    const json = `[{"rt":1161,"stimulus":"You are in condition 0","response":0,"trial_type":"html-button-response","trial_index":0,"time_elapsed":1163,"internal_node_id":"0.0-0.0","subject":"9om0mjpqjm"},{"rt":3676,"response":"button","png":null,"trial_type":"sketchpad","trial_index":1,"time_elapsed":4844,"internal_node_id":"0.0-1.0","subject":"9om0mjpqjm"}]`
    const requiredFields = ['trial_type'];
    expect(validateJSON(json, requiredFields)).toBe(true);
  });
});

// Regression coverage for GitHub issue #95. The dashboard used to store an
// empty "required fields" textbox as `[""]` -- an array containing one
// empty string -- in the experiment's Firestore doc
// (components/dashboard/ExperimentValidation.js filters those out on input
// now, but legacy docs still carry the old shape). `requiredFields.every(...)`
// then demanded a field literally named "", which no submission has, so
// validation always failed against these legacy docs. validateJSON now
// normalizes the incoming list before checking it.
describe("empty/blank entries in requiredFields (#95)", () => {
  const json = `{"foo": "bar"}`;

  it("treats [\"\"] the same as no required fields", () => {
    expect(validateJSON(json, [""])).toBe(true);
  });

  it("treats [] the same as no required fields", () => {
    expect(validateJSON(json, [])).toBe(true);
  });

  it("treats undefined the same as no required fields", () => {
    expect(validateJSON(json, undefined)).toBe(true);
  });

  it("ignores whitespace-only entries", () => {
    expect(validateJSON(json, ["   ", "\t", ""])).toBe(true);
  });

  it("still enforces a genuine field alongside empty/whitespace entries", () => {
    expect(validateJSON(json, ["", "  ", "foo"])).toBe(true);
    expect(validateJSON(json, ["", "  ", "missing"])).toBe(false);
  });

  it("still rejects invalid JSON even when requiredFields is empty-only", () => {
    expect(validateJSON(`{"foo": "bar"`, [""])).toBe(false);
  });
});