// datapipe-client -- a framework-neutral client for sending data from
// browser-based experiments to DataPipe (https://pipe.jspsych.org), a tool
// for routing research data to the OSF and other storage providers.
//
// Two ways to use it:
//
//  - One-shot submission: `saveData`, `saveBase64Data`, `getCondition`.
//  - Incremental (streaming) upload, so a participant who closes the tab
//    partway through does not lose everything: `startSession` /
//    `createSession`, whose returned `DataPipeSession.record()` is wired to
//    each trial as it completes.

export { saveData, saveBase64Data, getCondition, setBaseURL, getBaseURL } from "./api.js";
export { DataPipeSession, createSession, startSession } from "./session.js";
export type { SessionOptions, SaveResult, SessionConfig } from "./types.js";
