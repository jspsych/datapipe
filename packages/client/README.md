# datapipe-client

A framework-neutral browser client for [DataPipe](https://pipe.jspsych.org), which routes data from online experiments to a storage provider such as the OSF, Google Drive, or Dataverse.

No jsPsych required. If you *are* using jsPsych, you probably want [`@jspsych/extension-pipe`](https://www.jspsych.org/latest/extensions/pipe) instead, which wraps this library and needs no DataPipe code at all.

## Install

```
npm install datapipe-client
```

Or in a plain HTML page, which exposes a `DataPipe` global:

```html
<script src="https://unpkg.com/datapipe-client@0.1.0/dist/datapipe-client.browser.global.js"></script>
```

Keep the version in the URL. Without one, unpkg serves the newest release, which could change a study that is already collecting data.

## Sending data at the end

```js
import { saveData } from "datapipe-client";

const result = await saveData({
  experimentID: "YOUR_EXPERIMENT_ID",
  filename: "subject-01.csv",
  data: "rt,response\n204,1\n389,0",
});

if (!result.ok) {
  console.error(`DataPipe refused the data (HTTP ${result.status})`, result.body);
}
```

`saveData` never throws. It reports the outcome on `result.ok`, so a failed upload cannot take the page down with it.

## Sending data as the experiment runs

Staging each trial as it is produced means a participant who closes the tab at trial 199 of 200 does not take all 199 with them. DataPipe recovers what was staged as a `.partial.json` file.

```js
import { createSession, saveData } from "datapipe-client";

const session = createSession({
  experimentID: "YOUR_EXPERIMENT_ID",
  filename: "subject-01.csv",
});

// ...after each trial:
session.record(trialData);

// ...at the end:
await session.flush();
const result = await saveData({
  experimentID: "YOUR_EXPERIMENT_ID",
  filename: "subject-01.csv",
  data: allTrialsAsCSV,
  sessionId: session.sessionId,
});
await session.close({ submitted: result.ok });
```

Three things are worth knowing:

- **`createSession()` returns immediately.** The request that starts the session is still in flight, and trials recorded before it lands are buffered and staged once it does. Use `await startSession(...)` instead if you would rather wait and check `session.enabled`.
- **Flush before reading `sessionId`.** `flush()` waits for the session to start, so until you have awaited it, `sessionId` may still be empty. Submitting without it leaves DataPipe unable to match your file to the staged copy, which it would then recover a second time.
- **Tell `close()` what happened.** `{ submitted: true }` cancels the abandonment marker, so a completed session is never also reported as abandoned. `{ submitted: false }` marks it now, so the staged trials are recovered on DataPipe's normal sweep rather than waiting out the 24-hour expiry.

Nothing about staging will break your experiment. If the session cannot be started, every method on it becomes a no-op and the data is still submitted at the end.

## Condition assignment

```js
import { getCondition } from "datapipe-client";

let condition;
try {
  condition = await getCondition({ experimentID: "YOUR_EXPERIMENT_ID" });
} catch (error) {
  document.body.innerHTML = "<p>The experiment could not be started.</p>";
  throw error;
}
```

`getCondition` is the one function here that **throws**. Everything to do with staging fails quietly on purpose, because the data is submitted again at the end. A condition is not like that: it usually decides which timeline a participant runs, so a quiet fallback would send them through the wrong experiment, and the researcher would find out from the data weeks later. Decide what the participant sees.

## Saving media and binary files

```js
import { saveBase64Data } from "datapipe-client";

await saveBase64Data({
  experimentID: "YOUR_EXPERIMENT_ID",
  filename: "subject-01-recording.webm",
  data: base64EncodedString,
});
```

## Testing against another deployment

```js
import { setBaseURL } from "datapipe-client";
setBaseURL("https://datapipe-test.web.app");
```

## API

| Export | Returns | Throws? |
| --- | --- | --- |
| `createSession(options)` | `DataPipeSession`, immediately | no |
| `startSession(options)` | `Promise<DataPipeSession>`, once started | no |
| `saveData(options)` | `Promise<SaveResult>` | no |
| `saveBase64Data(options)` | `Promise<SaveResult>` | no |
| `getCondition(options)` | `Promise<number>` | **yes** |
| `setBaseURL(url)` / `getBaseURL()` | — | no |

`DataPipeSession` has `enabled`, `sessionId`, `record(data)`, `flush()`, and `close({ submitted })`.

`SaveResult` is `{ ok: boolean, status: number, body: any }`. A `status` of `0` means the request never reached DataPipe.

## License

MIT
