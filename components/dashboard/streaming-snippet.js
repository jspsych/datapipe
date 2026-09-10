// The "Save as you go" sample shown in CodeHints (and, through it, on the
// sending-data docs page).
//
// Kept apart from CodeHints for one reason: so __tests__/streaming-snippet.test.js
// can RUN it. A researcher copies this into a real page and expects it to work,
// and the first version did not -- it read `jsPsych.randomization` before
// `const jsPsych = initJsPsych(...)` had run (a ReferenceError on the first
// line), and it used `await` at the top level of what is an ordinary
// `<script>` tag (a SyntaxError before anything runs at all). Both are
// invisible to a reader and to a lint of this file, and obvious the moment
// the code is executed, so the test executes it.
//
// The shape has to be this one. The session must exist before the first
// trial runs, starting it is asynchronous, and `on_data_update` has to be given
// to initJsPsych up front -- so jsPsych is created first, the session is started
// inside an async function, and only then does the timeline run.
//
// Flush-left on purpose: CodeBlock strips the first line's indentation from
// every line, and there is none here to strip.
export function streamingSnippet(expId) {
  return `let session;

const jsPsych = initJsPsych({
  on_data_update: (data) => session.record(data)
});

const subject_id = jsPsych.randomization.randomID(10);
const filename = \`\${subject_id}.csv\`;

const timeline = [];
// ...add your trials to the timeline...

async function runExperiment() {
  session = await jsPsychPipe.startSession("${expId}", { filename });

  timeline.push({
    type: jsPsychPipe,
    action: "save",
    experiment_id: "${expId}",
    filename: filename,
    data_string: ()=>jsPsych.data.get().csv(),
    session: session
  });

  jsPsych.run(timeline);
}

runExperiment();`;
}
