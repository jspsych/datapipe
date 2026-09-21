---
"datapipe-client": minor
---

Accept `experiment_id`, the name the jsPsych extension and plugin use for the experiment ID, so the same option is spelled the same way everywhere.

`experimentID` still works and there are no plans to remove it. Give one or the other. If both are given and differ, `saveData`, `saveBase64Data` and `getCondition` throw, and a session starts inert with a console warning. Nothing changes on the wire.
