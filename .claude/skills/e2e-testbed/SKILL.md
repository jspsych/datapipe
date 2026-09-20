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
what to expect. Lines marked OBSERVED were confirmed by live runs against
`datapipe-test` on 2026-09-19; the rest is read off the source.

Reference files here: [endpoints.md](endpoints.md) (status and error codes per
endpoint, plus copy-paste probes), [dashboard.md](dashboard.md) (click paths,
the literal UI strings, and what the browser tooling cannot do), and
[output-template.md](output-template.md) (the write-up you must produce).

## 1. Before you touch anything

- **Target is `https://datapipe-test.web.app` (project `datapipe-test`).**
  Never production (`https://pipe.jspsych.org`) unless the user asks for it in
  this conversation, in words. A run writes real data to real storage — and
  every string in [dashboard.md](dashboard.md) is the `test` build's.
  **Production runs the OLD UI and backend until `test` is promoted to `main`**,
  so a run pointed there sees the old copy and must say so.
- **The dashboard half needs a signed-in researcher.** You cannot sign in. If
  the user has told you to use their logged-in tab, use it; if not, **ask
  first** and do nothing dashboard-side until they answer. The participant half
  needs no login and you can start on it meanwhile.
- **Open testbed pages in NEW tabs** (`tabs_create_mcp`). Never navigate the
  user's dashboard tab away.
- **Native dialogs freeze the browser extension.** DataPipe's dashboard has
  none ([dashboard.md](dashboard.md) has the audit), but avoid **"Choose Drive
  folder"** and any **"Connect …"**, which leave the origin for OAuth. Neither
  is needed below. If a native dialog does appear, the extension is stuck —
  say so and stop.
- **Always use a fresh experiment**, titled `e2e-YYYYMMDD-HHMM`; record its ID.
  Duplicate-filename scenarios depend on a clean collision cache.
- **Order matters more than coverage.** Read §4 before running anything. One
  scenario, run early, destroys two others.

## 2. Confirm the deploy is actually live

Do this first, or a green report means nothing. `gh run list --workflow "Deploy
to Test" --branch test --limit 3` — the run for the commit under test must be
`completed / success`. Note the SHA for the report. Optionally, and often
unavailably (§8), `functions_list_functions` on `datapipe-test` should show the
13 exports in `functions/src/index.ts` and **no** standalone `apisessionstart`,
`apicondition` or `apibase64`. Without it you can only prove a couple of
removed routes 404 from the browser — say so rather than implying the inventory
was checked.

## 3. Create the experiment

Full click path and literal strings: [dashboard.md](dashboard.md). In short:
`/admin` → **"Create an experiment"** → **"Google Drive"** → title
`e2e-YYYYMMDD-HHMM` → **"Create experiment"**, which lands on
`/admin/<experimentID>`. Read the ID from `location.pathname`; there is no copy
button. Then switch **"Accept new data"** on and wait for the **"Saved"** badge,
and open **"Open folder"** in a tab you keep for every `expectStorage` check.

- **Leave the Drive folder unset** (do not touch "Choose Drive folder"), so
  DataPipe creates `My Drive/DataPipe/<title>`. If the form offers **"Connect
  Google Drive"** instead of a title field, stop and ask the user.
- **Leave validation alone.** A new experiment requires `trial_type` and both
  pages emit it; that is where to look if a scenario is refused `INVALID_DATA`.
- **"Generate Psych-DS metadata" locks permanently once data exists.** Decide
  before the first submission: with it on, raw files live under `data/raw/` and
  a body that is not parseable CSV/JSON is refused with `METADATA_ERROR`.
  Record which way you set it — the experiment is then not in its default state.

## 4. Load the manifest

Fetch `https://jspsych.github.io/datapipe-testbed/scenarios.json`. **It may not
be deployed yet** — the testbed change may still be an open PR. Degrade in this
order and say which you used: the published manifest; `site/scenarios.json` in
a local checkout of `jspsych/datapipe-testbed`; the prose "What to check" list
on the home page (in which case the result contract is absent too — see §5 —
and every scenario is `automation: agent`).

**Run them in `order`. This is not a preference.** Switching data collection
off makes the staging sweep **discard** anything still staged
(`scheduled-staging-sweep.ts`, "THE SECOND DOOR"), so running
`closed-experiment` before the recovery scenarios' partials are queued destroys
them — and the run then reports a recovery bug that does not exist. That
happened on 2026-09-19. Before any `mustRunLast` scenario, check its
`runAfterCondition`: for `closed-experiment`, `GET
/api/queuestatus?experimentID=<id>` must already list an entry for each id in
its `runAfter`. If it does not, wait, or use a second throwaway experiment.

Skip `"manual"` unless the user asks. Today that is only `brief-dropout`: the
browser extension cannot turn the network off, and the testbed offers no way to
fake it.

## 5. Run one scenario

For each scenario in the manifest:

1. Build the URL:
   `https://jspsych.github.io/datapipe-testbed/<jspsych|vanilla>/?experiment=<ID>&base=https://datapipe-test.web.app&run=<scenario-id>-<HHMM>&<scenario.params>`
   `run` must be unique — it goes into the filename and is how you find it.
2. Perform any `driverActions` that come **before** opening the URL (dashboard
   switches, mostly). Click the **visible switch track, not the hidden
   checkbox** — the input by element reference does nothing — and wait for the
   "Saved" badge. Then `tabs_create_mcp` the URL.
3. **Starting a run is the fiddliest step, and the one the contract now
   verifies for you.** Wait until `data-testbed-status` on `<html>` reads
   **`ready`** — loaded, settings valid, waiting for a keypress. Then, in
   separate tool calls: click the page body; send a single `f`; re-read the
   status. **`running` means the key landed; still `ready` means it did not** —
   click and send again. OBSERVED 2026-09-19: `space` never worked, a key sent
   in the same batched call as the click usually did not either, and 4 of 8
   runs needed a retry. `f` is also a valid trial response, so an extra
   keypress is harmless. A page that goes `ready` → `aborted` without a key
   (`vanilla-condition-off`) is not waiting for one; poll for a terminal status.
4. Perform the mid-run `driverActions`. To act **at a trial** — closing the tab
   half-way — poll `data-testbed-trials-completed` against
   `data-testbed-trials-planned` about every 5 s; never time it off the clock,
   which is how the 2026-09-19 run let a 60-trial page finish before it could
   abandon it. Tool calls cost a few seconds each, so expect to overshoot by
   20–30 s; the manifest sizes `trials` to absorb that. **Read the result and
   keep `filenames[0]` FIRST** — it is unrecoverable once the tab is gone, and
   it is how you recognise the partial an hour later. Note the wall-clock time
   of the close: the recovery clock starts at the socket drop, and an open tab
   counts as live.
5. Poll `data-testbed-status` every 2 s until it is `finished`, `failed` or
   `aborted`, or `timing.pageRun` has been exceeded by 60 s. Then read the JSON
   text of `#testbed-result`. **Read the DOM, not `window.__testbed`** — both
   carry the same object, but an extension evaluates JavaScript in an isolated
   world and may not see a page global, while DOM reads always work.
6. Compare against `expectPage`: the final `status`; `trialsCompleted` against
   `trialsPlanned` — a run whose submission was refused still ran every trial,
   and the counter is what tells "the save failed" from "the run failed" — and
   for each expected request label the HTTP `status` and, on failures, the
   `error` **code**. Never a `message` string ([endpoints.md](endpoints.md)). A
   scenario passes only if every listed expectation holds. `sessionId` is
   `null` on every jsPsych-page run by design; the plain-JavaScript page
   reports one.
7. Check `expectDashboard` (live Firestore listeners — no refresh needed, but
   changes can lag a few seconds). Assert on the literal strings in
   [dashboard.md](dashboard.md), never a paraphrase, and **match the
   live-session row by this run's `run` id — never assert on the session
   count**: merely loading the jsPsych page opens a session. Two panels have
   their own rules: the rejections panel is hidden whenever anything is queued,
   and the queue panel is mid-polish. [dashboard.md](dashboard.md) says what to
   assert on there and what not to.
8. Check `expectStorage` in the Drive folder tab, following the scenario's
   `countBy`: **count files matching this run's filename stem, never the folder
   total.** A `.psychds-ignore` accumulates once per upload on Drive (known
   issue). With metadata on, raw files are under `data/raw/` with a derived
   `subject-…_data.csv` beside each. Then close the scenario's tab.

**Read `schema` out of `#testbed-result` before relying on any of this** — the
published testbed may be older than this runbook, or the tab may be serving a
cached copy. Record which you got, in the report header:

- **`schema: 2`** — everything above.
- **`schema: 1`** — no `ready` (the status reads `running` from page load and
  so proves nothing about the keypress), no trial counter, no `source`, `ms`
  null everywhere. Verify a start by looking for the first stimulus on screen,
  and size any "act at trial N" step off `timingFacts.observedPageRates` —
  which is exactly what went wrong on 2026-09-19. Say so per scenario.
- **Absent** (neither attribute nor `#testbed-result`) — the deployed testbed
  predates the contract. Judge each run from the on-screen log
  (`document.getElementById('log').textContent`) and say so per scenario.
  `get_page_text` on `jspsych.github.io` is intermittently refused by the
  extension's permission check; `document.body.innerText` always worked.

## 6. Direct endpoint probes

Run these from the JavaScript context of an open testbed tab — CORS is open on
`/api/*`, so a `fetch` from there behaves like a participant's, needs no page
and takes seconds. Payloads and the full list: [endpoints.md](endpoints.md).
Each probe writes a rejections-panel entry on the real experiment: expected,
so note it, and note that a `METADATA_ERROR` probe also reappears in the queue
later, briefly (§9).

## 7. The queue, without the dashboard

`GET /api/queuestatus?experimentID=<id>` with the account's Firebase ID token
gives the raw `retryCount` / `lastAttemptAt` / `failureReason`, and is how you
check `closed-experiment`'s `runAfterCondition`. **Re-read the token from
IndexedDB on every poll** — Firebase ID tokens expire after about an hour and a
cached one starts answering `401 Invalid authentication token` mid-session
(OBSERVED 22:55Z, 2026-09-19). The call and where to read the token:
[endpoints.md](endpoints.md).

## 8. Server-side verification — optional

If the Firebase MCP tools are authenticated, for the run's window:
`functions_get_logs` for `apidata`, `participantapi`, `dashboardapi`,
`scheduledsweep` and `compactiontask` (any `severity>=ERROR` is worth reporting
even if every scenario passed); `logs/<experimentID>`, whose `saveData` /
`saveDataSucceeded` / `saveDataQueued` counters should add up to the
submissions you made; and `uploadQueue` filtered to the experiment.

**Not a gate, and frequently unavailable** — on 2026-09-19 both the MCP tools
and the local `firebase` CLI returned 401. Do not attempt to log in. Record the
section as **not observed** rather than leaving it blank: blank reads as
"clean", and §2's function inventory goes unverified with it.

## 9. Deferred checks

Scenarios with `deferredCheck: true` cannot finish inside a run. The staging
sweep only **queues** a recovered session, and a queue entry with no provider
error code waits an hour for its first attempt — so a `.partial.json` lands in
storage roughly **65–75 minutes** after the dropout, not 15. Until then the
queue panel lists it as **"Waiting to be stored"**, `retryCount: 0`,
`lastAttemptAt: null`; it is no longer called a failed upload. Measured
2026-09-19: queued 10–12 min after the tab closed, `nextRetryAt` exactly +60.

A `METADATA_ERROR` probe is the tightest window in the run: queued at the next
`:00`/`:15`/`:30`/`:45` slot once its pending copy is older than 15 minutes,
then stored on the next 5-minute tick — so visible in the queue for **about 5
minutes**, ~30 minutes after the probe (22:33:47Z → ~23:00:30Z → ~23:05Z).

Record, per deferred scenario: the filename stem, the folder, and the
wall-clock time to check. Mark it `DEFERRED`, never `PASS`. **Before reporting
anything as a finding, read "Known issues a run will trip over" in
`docs/e2e-testing.md`** (the manifest's `knownIssues` says the same). Several
things there look like bugs and are not.

## 10. Report

Write [output-template.md](output-template.md), filled in, to
`e2e-reports/<YYYY-MM-DD>-<shortsha>.md` — gitignored, because a run's output
is a per-run artifact about a test deployment, not documentation, in a public
repo. Paste anything worth keeping into the PR or an issue.

Every scenario gets `PASS`, `FAIL`, `DEFERRED` or `SKIPPED` **with evidence** —
statuses and error codes from `requests`, `trialsCompleted`, filenames you saw
in Drive, dashboard strings you matched. "Looked fine" is not evidence. Say
explicitly what was **not observed**, including anything §8 could not reach,
and end with everything that surprised you — the manifest is meant to be
corrected.

## 11. Cleanup

- Switch **"Accept new data"** off, and any switch a scenario turned on. Note
  every setup change, such as the Psych-DS metadata toggle, so the next reader
  knows the experiment is not in its default state.
- **Do not delete the experiment or any stored file**, not even after the
  deferred checks clear: the folder has to stay intact for another hour, and
  the maintainer decides when an e2e experiment goes.
- Close the tabs you opened; leave the user's own alone. If the tooling refuses
  to close one — it dissolves its tab group once the others are gone — say
  which tab is still open rather than leaving it unmentioned.
