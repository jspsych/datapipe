---
name: e2e-testbed
description: Run DataPipe's end-to-end testbed against a deployment and write a machine-checkable report. Use after a deploy to datapipe-test, when asked to run e2e, to smoke-test the deployment, or to verify that participant data still reaches a researcher's storage end to end. Needs the claude-in-chrome browser tools.
---

# Running the e2e testbed

The testbed is two participant-facing pages at
<https://jspsych.github.io/datapipe-testbed/> (source: `jspsych/datapipe-testbed`)
that send real data to a real DataPipe experiment. Every run publishes
`window.__testbed`, so you assert on a result instead of reading a log.
`scenarios.json` beside those pages says what to run and what to expect.

Reference files in this directory:

- [endpoints.md](endpoints.md) — status codes and bodies for every participant
  endpoint, taken from the handlers, plus copy-paste direct probes.
- [dashboard.md](dashboard.md) — click paths and the literal UI strings to
  assert on.
- [output-template.md](output-template.md) — the write-up you must produce.

## 1. Before you touch anything

- **Target is `https://datapipe-test.web.app` (project `datapipe-test`).**
  Never production (`https://pipe.jspsych.org`) unless the user asks for it in
  this conversation, in words. A run writes real data to real storage.
- **The dashboard half needs a signed-in researcher.** You cannot sign in. If
  the user has told you to use their logged-in tab, use it. If they have not,
  **ask first** and do nothing dashboard-side until they answer. The
  participant half needs no login and you can start on it meanwhile.
- **Open testbed pages in NEW tabs** (`tabs_create_mcp`). Never navigate the
  user's dashboard tab away.
- **Native dialogs freeze the browser extension.** DataPipe's dashboard has
  none: every confirmation is an in-page Chakra dialog (`ConfirmDialog`), and a
  repo-wide grep for `window.confirm` / `alert` / `prompt` finds nothing in
  application code. Two things are still worth avoiding: the **"Choose Drive
  folder"** button on `/admin/new`, which opens a Google-hosted picker, and any
  **"Connect …"** button on `/admin/account`, which navigates the whole tab to
  an OAuth consent screen. Neither is needed below. If a native dialog ever
  does appear, the extension is stuck — tell the user and stop.
- **Always use a fresh experiment**, titled `e2e-YYYYMMDD-HHMM`. Record its ID
  in the report. Do not reuse an old one: duplicate-filename scenarios depend
  on a clean collision cache.

## 2. Confirm the deploy is actually live

Do this before running anything, or a green report means nothing.

1. `gh run list --workflow "Deploy to Test" --branch test --limit 3` — the run
   for the commit under test must be `completed / success`. Note the SHA; it
   goes in the report.
2. Optional, if the Firebase MCP tools are available:
   `functions_list_functions` on `datapipe-test` should show `apidata`,
   `participantapi`, `dashboardapi`, `scheduledsweep`, `compactiontask`,
   `apiqueuestatus`, `finalizetask`, `onstagingdisconnect`,
   `onexperimentgrew`, `onuploadqueuechanged`, `onmailcreated`,
   `onuserdeleted`, `scheduledtokenrefresh`. Standalone `apisessionstart`,
   `apicondition` and `apibase64` should be **gone**; if they are still there,
   the consolidation deploy has not landed.

## 3. Create the experiment

Full click path and literal strings: [dashboard.md](dashboard.md). In short:

1. `https://datapipe-test.web.app/admin` → **"Create an experiment"**.
2. Under **"Where should data be stored?"** choose **"Google Drive"**. If it
   shows **"Connect Google Drive"** instead of a title field, stop and ask the
   user to connect it — that flow leaves the DataPipe origin.
3. Title `e2e-YYYYMMDD-HHMM`. Leave the Drive folder unset, so DataPipe creates
   `My Drive/DataPipe/<title>`.
4. **"Create experiment"** lands you on `/admin/<experimentID>`. The ID is in
   the URL and beside the label **"Experiment ID"**. There is no copy button.
5. In **"Data collection"**, switch **"Accept new data"** on and wait for the
   "Saved" flag. Leave the other switches off for now; individual scenarios say
   when to flip them.
6. Open the folder link (**"Open folder"**) in a new tab and keep it — you will
   come back to it for every `expectStorage` check.

## 4. Load the manifest

Fetch `https://jspsych.github.io/datapipe-testbed/scenarios.json`.

**It may not be deployed yet** — the testbed change may still be an open PR.
Degrade in this order, and say in the report which one you used:

1. The published manifest.
2. `site/scenarios.json` in a local checkout of `jspsych/datapipe-testbed`.
3. The prose "What to check" list on the testbed home page. In this case
   `window.__testbed` will also be absent (see §5) and every scenario is
   `automation: agent` by default.

Run the `automation: "full"` scenarios first, then the `"agent"` ones. Skip
`"manual"` unless the user asks.

## 5. Run one scenario

For each scenario in the manifest:

1. Build the URL:
   `https://jspsych.github.io/datapipe-testbed/<jspsych|vanilla>/?experiment=<ID>&base=https://datapipe-test.web.app&run=<scenario-id>-<HHMM>&<scenario.params>`
   The `run` value must be unique per run — it goes into the filename and is
   how you find the file later.
2. Perform any `driverActions` that come **before** opening the URL (dashboard
   switches, mostly). Confirm each switch's "Saved" flag before continuing.
3. `tabs_create_mcp` the URL.
4. The **vanilla page waits for a keypress** before the trials start. Send one
   with the JavaScript tool:
   `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))`.
   The jsPsych page starts on any key too, but with `auto=1` it is driven by
   `jsPsych`'s own keyboard listener — send the same event if it sits on the
   instruction screen.
5. Perform the mid-run `driverActions` (close the tab at ~50%, go offline for
   30 s). For a tab close, **read `window.__testbed` and keep
   `filenames[0]` first** — it is unrecoverable once the tab is gone.
6. Poll `document.documentElement.dataset.testbedStatus` every 2 s until it is
   `finished`, `failed` or `aborted`, or `timing.pageRun` has been exceeded by
   60 s. Then read the whole of `window.__testbed` with the JavaScript tool.
7. Compare against `expectPage`: the final `status`, and for each expected
   request label the HTTP `status` and, on failures, the `error` code. A
   scenario passes only if every listed expectation holds.
8. Check `expectDashboard` on the experiment page (live Firestore listeners —
   no refresh needed, but changes can lag a few seconds). Assert on the literal
   strings in [dashboard.md](dashboard.md), not on paraphrases.
9. Check `expectStorage` in the Drive folder tab. Look for the exact names in
   `__testbed.filenames`, and count the files. If metadata is on, raw files are
   under `data/raw/`.
10. Close the scenario's tab before the next one.

**If `window.__testbed` is `undefined`**, the deployed testbed predates the
result contract. Fall back to reading the on-screen log
(`document.getElementById('log').textContent`, or `get_page_text`), judge the
run from it, and say in the report — per scenario — that the result contract
was unavailable and the verdict came from the prose log.

## 6. Direct endpoint probes

Run these from the JavaScript context of an open testbed tab (CORS is open on
`/api/*`, and a `fetch` from that origin behaves exactly like a participant's).
They need no page and take seconds. Payloads and expected bodies:
[endpoints.md](endpoints.md).

Cover at least: `/api/base64` with a valid and an invalid payload,
`/api/condition`, `/api/session`, a request missing a required parameter, and
every one of those against an experiment ID that does not exist.

Each probe against the real experiment writes a log entry that shows up in the
dashboard's error panel. That is expected; note it so a later reader does not
read the probes as failures.

## 7. Server-side verification — optional

If the Firebase MCP tools are available, for the run's time window:

- `functions_get_logs` for `apidata`, `participantapi`, `dashboardapi`,
  `scheduledsweep`, `compactiontask` — any `severity>=ERROR` entry is worth
  reporting even if every scenario passed.
- `firestore_get_document` on `logs/<experimentID>` — the counters
  (`saveData`, `saveDataSucceeded`, `saveDataQueued`) should add up to the
  submissions you made.
- `firestore_query_collection` on `uploadQueue` filtered to the experiment —
  what is still queued, and each entry's `nextRetryAt`.

Skip this silently if the tools are not there; it is not a gate.

## 8. Deferred checks

Scenarios with `deferredCheck: true` cannot finish inside a run. The staging
sweep only **queues** a recovered session, and a queue entry with no provider
error code waits an hour for its first attempt — so a `.partial.json` lands in
storage roughly **65–75 minutes** after the dropout, not 15. Until then the
dashboard describes it as an upload that did not go through. That is known
behaviour, not a bug.

Record in the report, per deferred scenario: the exact filename stem to look
for, the folder, and the wall-clock time to check. Mark the scenario
`DEFERRED`, never `PASS`.

## 9. Report

Write [output-template.md](output-template.md), filled in, to
`e2e-reports/<YYYY-MM-DD>-<shortsha>.md`. `e2e-reports/` is gitignored: a
report is a per-run artifact about a test deployment, not documentation, and
this repo is public. Paste anything worth keeping into the PR or an issue.

Every scenario gets `PASS`, `FAIL`, `DEFERRED` or `SKIPPED` **with evidence** —
the HTTP statuses and error codes from `__testbed.requests`, the filenames you
actually saw in Drive, the dashboard strings you matched. "Looked fine" is not
evidence. End with everything that surprised you, including anything the
manifest expected that the deployment did not do.

## 10. Cleanup

- Switch **"Accept new data"** off on the e2e experiment, and any switch a
  scenario turned on ("Assign conditions in sequence", "Accept base64 file
  uploads").
- **Do not delete the experiment or any stored file** unless the user asks.
  Deferred checks need the folder intact for another hour.
- Close the tabs you opened. Leave the user's own tabs alone.
