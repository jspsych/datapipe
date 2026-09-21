/**
 * @jest-environment node
 *
 * The jsPsych "Save data" code sample, EXECUTED.
 *
 * Researchers paste this into a real experiment page. An earlier version of
 * this sample read `jsPsych.randomization` before `const jsPsych =
 * initJsPsych(...)` had run (ReferenceError) and used `await` at the top level
 * of an ordinary <script> (SyntaxError). Neither is visible to a reader or a
 * linter of the component that renders it, so this suite runs the snippet as a
 * classic script against stand-ins for jsPsych and the extension -- which is
 * exactly how a browser would run it.
 */

import vm from "vm";
import { extensionSnippet } from "../components/dashboard/extension-snippet";

/**
 * Stand-ins for the two globals the snippet relies on.
 *
 * `initJsPsych` models the part of jsPsych's lifecycle that matters here: an
 * extension is registered up front but not initialized until `run()`, and its
 * params are handed over verbatim at that point -- jsPsych does not evaluate
 * functions in extension params the way it does for trial parameters, so the
 * extension resolving `filename` itself is load-bearing.
 */
function sandbox() {
  const calls = { initialize: [], run: [] };
  const context = {
    initJsPsych: (options = {}) => ({
      randomization: { randomID: () => "p42" },
      data: { get: () => ({ csv: () => "rt\n500\n" }) },
      run: (timeline) => {
        for (const { params } of options.extensions ?? []) {
          calls.initialize.push({
            ...params,
            // What the extension does with it. If `subject_id` were still in
            // its temporal dead zone, this call is where it would throw.
            filename: typeof params.filename === "function" ? params.filename() : params.filename,
          });
        }
        calls.run.push(timeline);
      },
    }),
    jsPsychExtensionPipe: { name: "pipe" },
  };
  return { context, calls };
}

/** Run code as a browser runs a plain <script>, then let its promises settle. */
async function execute(code) {
  const env = sandbox();
  vm.runInNewContext(code, env.context);
  await new Promise((resolve) => setImmediate(resolve));
  return env;
}

describe("the jsPsych code sample", () => {
  const code = extensionSnippet("EXP123");

  it("parses as an ordinary <script>, with no top-level await", () => {
    expect(() => new vm.Script(code)).not.toThrow();
  });

  it("registers the extension with the experiment id and a usable filename", async () => {
    const { calls } = await execute(code);

    // The filename resolves to the participant id, not "undefined.csv":
    // proof that the function form is evaluated after `subject_id` exists.
    expect(calls.initialize).toEqual([{ experiment_id: "EXP123", filename: "p42.csv" }]);
    expect(calls.run).toHaveLength(1);
  });

  it("appends no save trial: the extension owns the submission", async () => {
    const { calls } = await execute(code);
    expect(calls.run[0]).toHaveLength(0);
  });

  // Guards on the guard. Each of these is a shape a reader might "simplify"
  // the sample into, or one an earlier version actually shipped; if they did
  // not fail here, this suite would not be catching anything.
  it("would have caught a plain-string filename reading subject_id too early", async () => {
    // The trap the function form exists to avoid: `subject_id` is declared
    // after the params object, so a template string is evaluated in its
    // temporal dead zone.
    const simplified = `const jsPsych = initJsPsych({
  extensions: [
    { type: jsPsychExtensionPipe, params: { experiment_id: "X", filename: \`\${subject_id}.csv\` } }
  ]
});
const subject_id = jsPsych.randomization.randomID(10);
jsPsych.run([]);`;
    await expect(execute(simplified)).rejects.toThrow(/before initialization/);
  });

  it("would have caught top-level await", () => {
    // Matched by message, not constructor: vm raises its own realm's
    // SyntaxError, which is not `instanceof` this one.
    expect(() => new vm.Script('const s = await startSession("X");')).toThrow(
      /await is only valid/
    );
  });

  it("would have caught jsPsych being used before it exists", async () => {
    const before = `const id = jsPsych.randomization.randomID(10);
const jsPsych = initJsPsych({});`;
    await expect(execute(before)).rejects.toThrow(/before initialization/);
  });
});
