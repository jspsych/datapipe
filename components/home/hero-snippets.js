// Landing-page code specimen data (rendered by components/home/CodeSpecimen.js).
//
// Every span carries a ROLE, never a color. The four roles below map onto the
// mode-invariant `code.*` semantic tokens in lib/theme.js (DESIGN.md §1), which
// turns ~46 hand-placed palette literals into four names. The device renders
// IDENTICALLY in light and dark mode and that invariance is deliberate: what is
// being shown is the code you are about to paste, so its identity should not be
// a function of the reader's OS theme. Do not "convert" it.
//
// Ratios below are computed against `code.bg` = Chakra `gray.950` = #111111
// (NOT zinc's #09090b), which is what this page actually renders:
export const CODE_ROLE = {
  comment: "code.comment", // gray.400 -- 7.37:1 on code.bg
  fg: "code.fg", // gray.300 -- 12.78:1 on code.bg
  string: "code.string", // brandOrange.300 -- 10.91:1. String literals ONLY.
  fn: "code.fn", // brandGreen.300 -- 9.38:1. Function / plugin names.
};

// `string` is reserved for quoted literals. Bare identifiers (save_data,
// filename, dataAsString) are `fg`: a variable is not a string, and colouring
// them alike taught the reader something false about the language.
export const snippets = [
  {
    id: "jspsych",
    label: "jsPsych",
    lines: [
      { role: "comment", text: "// Save data with the jsPsych pipe plugin\n" },
      { role: "fg", text: "const " },
      { role: "fg", text: "save_data" },
      { role: "fg", text: " = {\n" },
      { role: "fg", text: "  type: " },
      { role: "fn", text: "jsPsychPipe" },
      { role: "fg", text: ",\n" },
      { role: "fg", text: "  action: " },
      { role: "string", text: '"save"' },
      { role: "fg", text: ",\n" },
      { role: "fg", text: "  experiment_id: " },
      { role: "string", text: '"your_id"' },
      { role: "fg", text: ",\n" },
      { role: "fg", text: "  filename: " },
      { role: "fg", text: "filename" },
      { role: "fg", text: ",\n" },
      { role: "fg", text: "  data_string: " },
      { role: "fg", text: "() =>\n" },
      { role: "fg", text: "    jsPsych.data.get()." },
      { role: "fn", text: "csv" },
      { role: "fg", text: "()\n" },
      { role: "fg", text: "};" },
    ],
  },
  {
    id: "javascript",
    label: "JavaScript",
    lines: [
      { role: "comment", text: "// Send data with a fetch request\n" },
      { role: "fn", text: "fetch" },
      { role: "fg", text: "(url, {\n" },
      { role: "fg", text: "  method: " },
      { role: "string", text: '"POST"' },
      { role: "fg", text: ",\n" },
      { role: "fg", text: "  headers: {\n" },
      { role: "fg", text: "    " },
      { role: "string", text: '"Content-Type"' },
      { role: "fg", text: ": " },
      { role: "string", text: '"application/json"' },
      { role: "fg", text: "\n  },\n" },
      { role: "fg", text: "  body: JSON." },
      { role: "fn", text: "stringify" },
      { role: "fg", text: "({\n" },
      { role: "fg", text: "    experimentID: " },
      { role: "string", text: '"your_id"' },
      { role: "fg", text: ",\n" },
      { role: "fg", text: "    filename: " },
      { role: "string", text: '"subject01.csv"' },
      { role: "fg", text: ",\n" },
      { role: "fg", text: "    data: " },
      { role: "fg", text: "dataAsString" },
      { role: "fg", text: "\n  })\n});" },
    ],
  },
];

// What the Copy button puts on the clipboard: the same spans, concatenated, so
// the copied text can never drift from the rendered text.
export function snippetText(snippet) {
  return snippet.lines.map((line) => line.text).join("");
}
