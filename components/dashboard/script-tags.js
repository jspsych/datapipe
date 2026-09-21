// The <script> tags every code sample tells a researcher to paste.
//
// Pinned to exact versions on purpose. An unpinned unpkg URL resolves to
// whatever was published most recently, so a release could change a study
// that is already collecting data, mid-study and without anyone touching it.
// A pinned URL keeps a running study on the code it was piloted with.
//
// Bump these when a new version is published. DATAPIPE_CLIENT_VERSION must
// match packages/client/package.json, and __tests__/script-tags.test.js fails
// until it does. The extension lives in the jsPsych repo, so its version has
// no check here.
export const EXTENSION_PIPE_VERSION = "0.2.0";
export const DATAPIPE_CLIENT_VERSION = "0.1.0";

export const EXTENSION_PIPE_SCRIPT = `<script src="https://unpkg.com/@jspsych/extension-pipe@${EXTENSION_PIPE_VERSION}"></script>`;
export const DATAPIPE_CLIENT_SCRIPT = `<script src="https://unpkg.com/datapipe-client@${DATAPIPE_CLIENT_VERSION}"></script>`;
