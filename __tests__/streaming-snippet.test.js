/**
 * @jest-environment node
 *
 * The "Save as you go" code sample, EXECUTED.
 *
 * Researchers paste this into a real experiment page. The first version read
 * `jsPsych.randomization` before `const jsPsych = initJsPsych(...)` had run
 * (ReferenceError) and used `await` at the top level of an ordinary <script>
 * (SyntaxError). Neither is visible to a reader or a linter of the component
 * that renders it, so this suite runs the snippet as a classic script against
 * stand-ins for jsPsych and the plugin -- which is exactly how a browser would
 * run it.
 */

import vm from "vm";
import { streamingSnippet } from "../components/dashboard/streaming-snippet";

/** Stand-ins for the two globals the snippet relies on, recording calls. */
function sandbox() {
  const calls = { startSession: [], run: [], record: [] };
  const session = { record: (data) => calls.record.push(data) };
  const context = {
    initJsPsych: (options = {}) => ({
      randomization: { randomID: () => "p42" },
      data: { get: () => ({ csv: () => "rt\n500\n" }) },
      run: (timeline) => {
        calls.run.push(timeline);
        // What jsPsych does after every trial. If the session were not yet
        // assigned, this is where a participant's first trial would throw.
        options.on_data_update?.({ trial_index: 0, rt: 500 });
      },
    }),
    jsPsychPipe: {
      startSession: async (...args) => {
        calls.startSession.push(args);
        return session;
      },
    },
  };
  return { context, calls, session };
}

/** Run code as a browser runs a plain <script>, then let its promises settle. */
async function execute(code) {
  const env = sandbox();
  vm.runInNewContext(code, env.context);
  await new Promise((resolve) => setImmediate(resolve));
  return env;
}

describe("the streaming code sample", () => {
  const code = streamingSnippet("EXP123");

  it("parses as an ordinary <script>, with no top-level await", () => {
    expect(() => new vm.Script(code)).not.toThrow();
  });

  it("starts the session before any trial runs, and hands every trial to it", async () => {
    const { calls, session, context } = await execute(code);

    expect(calls.startSession).toEqual([["EXP123", { filename: "p42.csv" }]]);
    expect(calls.run).toHaveLength(1);
    expect(calls.record).toEqual([{ trial_index: 0, rt: 500 }]);

    const saveTrial = calls.run[0][calls.run[0].length - 1];
    expect(saveTrial).toMatchObject({
      type: context.jsPsychPipe,
      action: "save",
      experiment_id: "EXP123",
      filename: "p42.csv",
    });
    // The session object itself, so the save trial can close it and tell
    // DataPipe which staged copy to discard.
    expect(saveTrial.session).toBe(session);
    expect(saveTrial.data_string()).toBe("rt\n500\n");
  });

  // Guards on the guard: the two shapes the first version shipped with must
  // fail here, or this suite would not have caught them.
  it("would have caught top-level await", () => {
    // Matched by message, not constructor: vm raises its own realm's
    // SyntaxError, which is not `instanceof` this one.
    expect(() => new vm.Script('const s = await jsPsychPipe.startSession("X");')).toThrow(
      /await is only valid/
    );
  });

  it("would have caught jsPsych being used before it exists", async () => {
    const before = `const id = jsPsych.randomization.randomID(10);
const jsPsych = initJsPsych({});`;
    await expect(execute(before)).rejects.toThrow(/before initialization/);
  });
});
