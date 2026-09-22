# datapipe-client

## 0.2.0

### Minor Changes

- 4479720: Accept `experiment_id`, the name the jsPsych extension and plugin use for the experiment ID, so the same option is spelled the same way everywhere.

  `experimentID` still works and there are no plans to remove it. Give one or the other. If both are given and differ, `saveData`, `saveBase64Data` and `getCondition` throw, and a session starts inert with a console warning. Nothing changes on the wire.

- 132affd: Pass the session to `saveData` with `session` instead of flushing and reading `sessionId` yourself. `saveData` waits for the session to start and sends its id.

  Adds `session.ready()`, which resolves once the session has started (or failed to). It waits only for startup, not for staged writes, so a final submission from a background tab is no longer held up by a throttled flush. `sessionId` still works.

## 0.1.0

### Minor Changes

- d970b31: First release.

  Send data to DataPipe from any browser experiment, with or without jsPsych. `saveData`, `saveBase64Data` and `getCondition` cover one-shot submission; `createSession` stages each trial as it is produced, so a participant who closes the tab partway through does not take all of their data with them — DataPipe recovers what was staged as a `.partial.json` file.

  Incremental upload was previously only reachable through the jsPsych plugin, so an experiment written without jsPsych could not use it at all.
