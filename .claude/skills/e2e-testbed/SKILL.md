---
name: e2e-testbed
description: Run DataPipe's end-to-end testbed against a deployment and write a machine-checkable report. Use after a deploy to datapipe-test, when asked to run e2e, to smoke-test the deployment, or to verify that participant data still reaches a researcher's storage end to end. Needs the claude-in-chrome browser tools.
---

# Running the e2e testbed

The testbed is two participant-facing pages at
<https://jspsych.github.io/datapipe-testbed/> (source: `jspsych/datapipe-testbed`)
that send real data to a real DataPipe experiment. Every run publishes a
machine-readable result, so you assert on it instead of reading a log.
`scenarios.json` beside those pages says what to run, **in what order**, and
what to expect.

Parts of this runbook were confirmed by a live run against `datapipe-test` on
2026-09-19; those are marked OBSERVED. The rest is read off the source and is
still unverified.

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
  application code. OBSERVED 2026-09-19: none encountered, including the Google
  Picker, which is an in-page overlay. Still avoid the **"Choose Drive
  folder"** button on `/admin/new` and any **"Connect …"** button on
  `/admin/account` (a full-page OAuth navigation). Neither is needed below. If
  a native dialog ever does appear, the extension is stuck — say so and stop.
- **Always use a fresh experiment**, titled `e2e-YYYYMMDD-HHMM`. Record its ID.
  Do not reuse an old one: duplicate-filename scenarios depend on a clean
  collision cache.
- **Order matters more than coverage.** Read §4 before running anything. One
  scenario, run early, destroys two others.

## 2. Confirm the deploy is actually live

Do this before running anything, or a green report means nothing.

1. `gh run list --workflow "Deploy to Test" --branch test --limit 3` — the run
   for the commit under test must be `completed / success`. Note the SHA; it
   goes in the report.
2. Optional, and often unavailable (see §8 — both the MCP tools and the local
   CLI returned 401 on 2026-09-19): `functions_list_functions` on
   `datapipe-test` should show the 13 exports in `functions/src/index.ts` and
   **no** standalone `apisessionstart`, `apicondition` or `apibase64`. If those
   three are still there, the consolidation deploy has not landed. Without
   these tools you can only prove that a couple of removed routes 404 from the
   browser — say so rather than implying the inventory was checked.

## 3. Create the experiment

Full click path and literal strings: [dashboard.md](dashboard.md). In short:

1. `https://datapipe-test.web.app/admin` → **"Create an experiment"**.
2. Under **"Where should data be stored?"** choose **"Google Drive"**. If it
   shows **"Connect Google Drive"** instead of a title field, stop and ask the
   user to connect it — that flow leaves the DataPipe origin.
3. Title `e2e-YYYYMMDD-HHMM`. Leave the Drive folder unset (do not touch
   **"Choose Drive folder"**), so DataPipe creates `My Drive/DataPipe/<title>`.
4. **"Create experiment"** lands you on `/admin/<experimentID>`. Read the ID
   from `location.pathname` — it is also beside the label **"Experiment ID"**,
   and there is no copy button. Budget ~10 s for the create call.
5. In **"Data collection"**, switch **"Accept new data"** on and wait for the
   transient **"Saved"** badge.
6. **Two setup traps, each of which costs a run.** Details in
   [dashboard.md](dashboard.md); handle them now:
   - **Validation is ON by default with `trial_type` required.** The
     plain-JavaScript page emits no `trial_type`, so every vanilla scenario is
     refused with `INVALID_DATA` until you remove that chip or switch **"Check
     submissions before storing them"** off.
   - **"Generate Psych-DS metadata" locks permanently once data exists.**
     Decide before the first submission. With it on, raw files live under
     `data/raw/` and a body that is not parseable CSV/JSON is refused with
     `METADATA_ERROR`.
   Record whichever you chose in the write-up: the experiment is no longer in
   its default state, and that changes what later runs mean.
7. Open the folder link (**"Open folder"**) in a new tab and keep it — you will
   come back to it for every `expectStorage` check.

## 4. Load the manifest

Fetch `https://jspsych.github.io/datapipe-testbed/scenarios.json`.

**It may not be deployed yet** — the testbed change may still be an open PR.
Degrade in this order, and say in the report which one you used:

1. The published manifest.
2. `site/scenarios.json` in a local checkout of `jspsych/datapipe-testbed`.
3. The prose "What to check" list on the testbed home page. In this case the
   result contract will also be absent (see §5) and every scenario is
   `automation: agent` by default.

**Run them in `order`. This is not a preference.** Switching data collection
off makes the staging sweep **discard** anything still staged
(`scheduled-staging-sweep.ts`, "THE SECOND DOOR"), so running
`closed-experiment` before the recovery scenarios' partials are queued
destroys them — and the run then reports a recovery bug that does not exist.
That happened on 2026-09-19.

Before running any scenario with `mustRunLast`, check its `runAfterCondition`:
for `closed-experiment` that means `GET /api/queuestatus?experimentID=<id>`
must already list a queue entry for each id in its `runAfter`. If it does not,
wait, or run that scenario on a second throwaway experiment.

Skip `"manual"` unless the user asks. Today that is only `brief-dropout`: the
browser extension cannot turn the network off, and the testbed deliberately
offers no way to fake it.

## 5. Run one scenario

For each scenario in the manifest:

1. Build the URL:
   `https://jspsych.github.io/datapipe-testbed/<jspsych|vanilla>/?experiment=<ID>&base=https://datapipe-test.web.app&run=<scenario-id>-<HHMM>&<scenario.params>`
   The `run` value must be unique per run — it goes into the filename and is
   how you find the file later.
2. Perform any `driverActions` that come **before** opening the URL (dashboard
   switches, mostly). Click the **visible switch track, not the hidden
   checkbox** — clicking the input by element reference does nothing — and wait
   for the transient "Saved" badge before continuing.
3. `tabs_create_mcp` the URL.
4. **Starting a run is the fiddliest step.** Both pages wait for a real
   keypress. In three separate tool calls: click the page body; send a single
   `f`; then assert the first trial actually appeared and retry if it did not.
   OBSERVED 2026-09-19: `space` never worked, and a key sent in the same
   batched call as the click usually did not either — 4 of 8 runs needed a
   retry. `f` is also a valid trial response, so an extra keypress is harmless.
5. Perform the mid-run `driverActions` (close the tab at ~50%). **Read the
   result and keep `filenames[0]` FIRST** — it is unrecoverable once the tab is
   gone, and it is how you recognise the partial an hour later. Note the
   wall-clock time of the close: the recovery clock starts at the socket drop,
   and an open tab counts as live.
6. Poll `document.documentElement.dataset.testbedStatus` every 2 s until it is
   `finished`, `failed` or `aborted`, or `timing.pageRun` has been exceeded by
   60 s. Then read the JSON text of `#testbed-result`.
   **Read the DOM, not `window.__testbed`.** The two carry the same object, but
   an extension evaluating JavaScript does so in an isolated world and may not
   see a page global. (Unverified — the 2026-09-19 run hit this against a
   testbed build that predated the contract entirely — but DOM reads always
   work, so there is no reason to depend on the global.)
7. Compare against `expectPage`: the final `status`, and for each expected
   request label the HTTP `status` and, on failures, the `error` **code**.
   Never assert on a `message` string — see [endpoints.md](endpoints.md). A
   scenario passes only if every listed expectation holds.
8. Check `expectDashboard` on the experiment page (live Firestore listeners —
   no refresh needed, but changes can lag a few seconds). Assert on the literal
   strings in [dashboard.md](dashboard.md), not on paraphrases, and **match the
   live-session row by this run's `run` id — never assert on the session
   count**: merely loading the jsPsych page opens a session, so pages that ran
   no trials leave rows behind.
9. Check `expectStorage` in the Drive folder tab, following the scenario's
   `countBy`: **count files matching this run's filename stem, never the folder
   total.** A `.psychds-ignore` accumulates once per upload on Drive (known
   issue). If metadata is on, raw files are under `data/raw/` with a derived
   `subject-…_data.csv` beside each.
10. Close the scenario's tab before the next one.

**If the result contract is absent** (no `data-testbed-status` on `<html>` and
no `#testbed-result`), the deployed testbed predates it. Fall back to reading
the on-screen log (`document.getElementById('log').textContent`, or
`get_page_text`), judge the run from it, and say in the write-up — per
scenario — that the contract was unavailable and the verdict came from the
prose log. `get_page_text` on `jspsych.github.io` was intermittently refused by
the extension's per-domain permission check on 2026-09-19; zooming a screenshot
on the log region always worked.

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

**Use no-trailing-slash URLs when checking that a route is gone.**
`/api/foo/` 308-redirects to `/api/foo`, and `fetch` reports the CORS-less 404
as "Failed to fetch" rather than a status. OBSERVED 2026-09-19.

## 7. The queue, without the dashboard

`GET /api/queuestatus?experimentID=<id>` with an `Authorization: Bearer
<Firebase ID token>` header returns the queue entries with `status`,
`retryCount`, `lastAttemptAt`, `nextRetryAt` and `failureReason`. This is
better evidence than the queue panel, and it is the only way to see
`lastAttemptAt: null` — which is what distinguishes "queued, never tried" from
"tried and failed". It is also how you check `closed-experiment`'s
`runAfterCondition`.

Read the ID token from the `datapipe-test.web.app` origin's IndexedDB:
`firebaseLocalStorageDb` → `firebaseLocalStorage` → first record →
`value.stsTokenManager.accessToken`. OBSERVED 2026-09-19.

## 8. Server-side verification — optional

If the Firebase MCP tools are authenticated, for the run's time window:

- `functions_get_logs` for `apidata`, `participantapi`, `dashboardapi`,
  `scheduledsweep`, `compactiontask` — any `severity>=ERROR` entry is worth
  reporting even if every scenario passed.
- `firestore_get_document` on `logs/<experimentID>` — the counters
  (`saveData`, `saveDataSucceeded`, `saveDataQueued`) should add up to the
  submissions you made.
- `firestore_query_collection` on `uploadQueue` filtered to the experiment —
  what is still queued, and each entry's `nextRetryAt`.

**This is not a gate, and it frequently is not available**: on 2026-09-19 both
the MCP tools and the local `firebase` CLI returned 401. Do not attempt to log
in. Record the whole section as **not observed** in the write-up rather than
leaving it blank — a blank section reads as "clean", and the function
inventory in §2 is part of what goes unverified when this fails.

## 9. Deferred checks

Scenarios with `deferredCheck: true` cannot finish inside a run. The staging
sweep only **queues** a recovered session, and a queue entry with no provider
error code waits an hour for its first attempt — so a `.partial.json` lands in
storage roughly **65–75 minutes** after the dropout, not 15. Until then the
dashboard describes it as an upload that did not go through, with
`retryCount: 0` and `lastAttemptAt: null`. That is known behaviour, not a bug.
Measured 2026-09-19: abandoned tab → queue entry in 12 minutes, `nextRetryAt`
exactly +60 minutes.

Record, per deferred scenario: the exact filename stem to look for, the folder,
and the wall-clock time to check. Mark the scenario `DEFERRED`, never `PASS`.

**Three things that look like bugs and are not.** Do not report them as
findings. The manifest's `knownIssues` and `docs/e2e-testing.md` have the
reasoning; in short:

- A `400 METADATA_ERROR` refusal keeps its pending copy on purpose and
  reappears within the next pending-recovery slot (`:00/:15/:30/:45`) as a
  queue entry reading *"Recovered from interrupted upload (server restart or
  memory limit)"*. The wording is misleading; the behaviour is deliberate.
- One `.psychds-ignore` per upload on Google Drive, not one per experiment.
- Live-session rows from pages that opened and never ran a trial.

## 10. Report

Write [output-template.md](output-template.md), filled in, to
`e2e-reports/<YYYY-MM-DD>-<shortsha>.md`. `e2e-reports/` is gitignored: a
report is a per-run artifact about a test deployment, not documentation, and
this repo is public. Paste anything worth keeping into the PR or an issue.

Every scenario gets `PASS`, `FAIL`, `DEFERRED` or `SKIPPED` **with evidence** —
the HTTP statuses and error codes from the result's `requests`, the filenames
you actually saw in Drive, the dashboard strings you matched. "Looked fine" is
not evidence. Say explicitly what was **not observed**, including anything §8
could not reach. End with everything that surprised you, including anything the
manifest expected that the deployment did not do — the manifest is meant to be
corrected.

## 11. Cleanup

- Switch **"Accept new data"** off on the e2e experiment, and any switch a
  scenario turned on ("Assign conditions in sequence", "Accept base64 file
  uploads"). Note any setup change you made — removing the `trial_type`
  required field, switching validation off — so the next reader knows the
  experiment is not in its default state.
- **Do not delete the experiment or any stored file**, and do not delete the
  experiment as cleanup even after the deferred checks clear. Deferred checks
  need the folder intact for another hour, and the maintainer decides when an
  e2e experiment goes.
- Close the tabs you opened. Leave the user's own tabs alone. If the tooling
  refuses to close one (it dissolves its tab group once the others are gone),
  say which tab is still open rather than leaving it unmentioned.
