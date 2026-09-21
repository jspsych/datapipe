// The <script> tags every code sample tells a researcher to paste.
//
// Pinned to exact versions on purpose. An unpinned unpkg URL resolves to
// whatever was published most recently, so a release could change a study
// that is already collecting data, mid-study and without anyone touching it.
// A pinned URL keeps a running study on the code it was piloted with.
//
// The client's version is read from its package.json rather than written
// here, so the "Release datapipe-client" PR moves the pin by bumping the
// version, with no step to forget. It can't be synced by a script instead:
// changesets/action commits only files under packages/client, so an edit to
// this file made during that PR's version step would never be committed.
//
// The extension lives in the jsPsych repo, so bump its version by hand when a
// new one is published.
import clientPackage from "../../packages/client/package.json";

export const EXTENSION_PIPE_VERSION = "0.2.0";
export const DATAPIPE_CLIENT_VERSION = clientPackage.version;

export const EXTENSION_PIPE_SCRIPT = `<script src="https://unpkg.com/@jspsych/extension-pipe@${EXTENSION_PIPE_VERSION}"></script>`;
export const DATAPIPE_CLIENT_SCRIPT = `<script src="https://unpkg.com/datapipe-client@${DATAPIPE_CLIENT_VERSION}"></script>`;
