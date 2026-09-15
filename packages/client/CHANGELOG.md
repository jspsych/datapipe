# datapipe-client

## 0.1.0

### Minor Changes

- d970b31: First release.

  Send data to DataPipe from any browser experiment, with or without jsPsych. `saveData`, `saveBase64Data` and `getCondition` cover one-shot submission; `createSession` stages each trial as it is produced, so a participant who closes the tab partway through does not take all of their data with them — DataPipe recovers what was staged as a `.partial.json` file.

  Incremental upload was previously only reachable through the jsPsych plugin, so an experiment written without jsPsych could not use it at all.
