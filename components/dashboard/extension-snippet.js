// The jsPsych "Save data" sample shown in CodeHints (and, through it, on the
// sending-data docs page).
//
// Kept apart from CodeHints for one reason: so __tests__/extension-snippet.test.js
// can RUN it. A researcher copies this into a real page and expects it to work,
// and an earlier version of this sample did not -- it read
// `jsPsych.randomization` before `const jsPsych = initJsPsych(...)` had run (a
// ReferenceError on the first line), and it used `await` at the top level of
// what is an ordinary `<script>` tag (a SyntaxError before anything runs at
// all). Both are invisible to a reader and to a lint of this file, and obvious
// the moment the code is executed, so the test executes it.
//
// THE `filename` FUNCTION IS NOT A STYLE CHOICE. `subject_id` is declared after
// this object literal, because it needs the jsPsych instance that
// `initJsPsych()` returns. A plain string would read it in the temporal dead
// zone and throw; a function is not called until the experiment starts, by
// which time the declaration has run. The test covers this, because a reader
// copying the sample is likely to "simplify" it back into a string.
//
// `baseURL` is set only on builds that are not production (lib/base-url.js),
// where the extension's built-in default would send the data to the wrong
// deployment.
//
// Flush-left on purpose: CodeBlock strips the first line's indentation from
// every line, and there is none here to strip.
export function extensionSnippet(expId, baseURL = null) {
  const baseURLParam = baseURL ? `,\n        base_url: "${baseURL}"` : "";
  return `const jsPsych = initJsPsych({
  extensions: [
    {
      type: jsPsychExtensionPipe,
      params: {
        experiment_id: "${expId}",
        filename: () => \`\${subject_id}.csv\`${baseURLParam}
      }
    }
  ]
});

const subject_id = jsPsych.randomization.randomID(10);

const timeline = [];
// ...add your trials to the timeline...

jsPsych.run(timeline);`;
}
