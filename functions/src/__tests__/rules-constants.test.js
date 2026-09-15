/**
 * @jest-environment node
 *
 * database.rules.json cannot import functions/src/staging-assembly.ts -- RTDB
 * rules are not TypeScript -- so its `$seq` regex and per-trial `.length` cap
 * are HAND-COPIES of MAX_TRIALS_PER_SESSION and MAX_TRIAL_BYTES. A hand-copy
 * can drift from the constant it was copied from without either file's own
 * tests noticing: database-rules.test.js only ever checks the rules' actual
 * behaviour against literals it writes itself, and staging-assembly.test.js
 * never reads database.rules.json at all.
 *
 * This suite is the thing that would catch that drift: it parses
 * database.rules.json as data and asserts its literals equal the constants
 * directly, so changing one without the other fails here rather than at
 * runtime, when the endpoint tells a client one cap and the rules enforce a
 * different one.
 */

const fs = require("fs");
const path = require("path");
const {
  MAX_TRIAL_BYTES,
  MAX_TRIALS_PER_SESSION,
} = require("../../lib/staging-assembly.js");

const RULES_PATH = path.join(__dirname, "..", "..", "..", "database.rules.json");

/**
 * database.rules.json is JSON with `//` line comments, which RTDB's rules
 * loader accepts but JSON.parse does not. Strips them the same way a real
 * JSONC-aware loader would: character by character, tracking whether the
 * cursor is inside a double-quoted string (respecting `\"` so a quote inside
 * a regex literal like `/^[0-9]{1,3}$/` -- itself inside a JSON string --
 * cannot be mistaken for the string's closing quote), so that `//` inside a
 * string (there is none in this file today, but a rule expression could
 * legally contain one) is never treated as a comment.
 */
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        // Copy the escaped character verbatim without re-examining it --
        // otherwise `\"` would end the string one character early.
        i++;
        if (i < text.length) out += text[i];
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

function loadRules() {
  const raw = fs.readFileSync(RULES_PATH, "utf8");
  return JSON.parse(stripJsonComments(raw));
}

describe("database.rules.json agrees with functions/src/staging-assembly.ts", () => {
  let rules;
  let trialRule;

  beforeAll(() => {
    rules = loadRules();
    trialRule = rules.rules.staging.$sessionId.trials.$seq[".validate"];
  });

  it("caps the per-trial length at exactly MAX_TRIAL_BYTES", () => {
    const match = trialRule.match(/newData\.val\(\)\.length\s*<=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBe(MAX_TRIAL_BYTES);
  });

  it("bounds the $seq key to exactly the digit width MAX_TRIALS_PER_SESSION implies", () => {
    // The number of digits the rule's regex allows is what actually bounds
    // trial count (10 ** digits, since $seq is unpadded), not a literal copy
    // of MAX_TRIALS_PER_SESSION itself -- so this derives the expected width
    // from the constant instead of hand-copying "3".
    const match = trialRule.match(/\$seq\.matches\(\/\^\[0-9\]\{1,(\d+)\}\$\/\)/);
    expect(match).not.toBeNull();
    const digits = Number(match[1]);
    expect(10 ** digits).toBe(MAX_TRIALS_PER_SESSION);
  });

  it("requires the disconnect/reconnect slot cap comment's own bound (sanity: rules file still parses as one object)", () => {
    // Not a constants check -- just confirms stripJsonComments above did not
    // silently produce a truncated or malformed object that the two tests
    // above would pass against vacuously (e.g. `rules.rules` being undefined
    // would make the `.length` and `$seq` lookups above throw, not silently
    // pass, but this pins the shape explicitly all the same).
    expect(rules.rules.staging.$sessionId.trials.$seq).toHaveProperty([".validate"]);
  });
});
