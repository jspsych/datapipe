---
name: e2e-testbed
description: Run DataPipe's end-to-end testbed against a deployment and write a machine-checkable report. Use after a deploy to datapipe-test, when asked to run e2e, to smoke-test the deployment, or to verify that participant data still reaches a researcher's storage end to end. Needs the claude-in-chrome browser tools.
---

# Running the e2e testbed

The testbed is two participant-facing pages at
<https://jspsych.github.io/datapipe-testbed/> (source: `jspsych/datapipe-testbed`) that
send real data to a real DataPipe experiment. Every run publishes a machine-readable
result, so you assert on it instead of reading a log. `scenarios.json` beside those pages
says what to run, **in what order**, and what to expect. Lines marked OBSERVED were
confirmed by live runs against `datapipe-test`; the rest is read off source.

Reference files here: [endpoints.md](endpoints.md) (status/error codes per endpoint,
copy-paste probes), [dashboard.md](dashboard.md) (click paths, literal UI strings, and
what the browser tooling cannot do), and [output-template.md](output-template.md) (the
write-up you must produce).

## 1. Before you touch anything

- **Target is `https://datapipe-test.web.app` (project `datapipe-test`).**
  Never production (`https://pipe.jspsych.org`) unless the user asks for it in words. A
  run writes real data to real storage, and every string in [dashboard.md](dashboard.md)
  is the `test` build's. **Production runs the OLD UI and backend until `test` is promoted
  to `main`** — a run pointed there sees the old copy and must say so.
- **The dashboard half needs a signed-in researcher.** You cannot sign in.
  If told to use the user's logged-in tab, use it; otherwise **ask first** and do nothing
  dashboard-side until they answer. The participant half needs no login and can start
  meanwhile.
- **Open testbed pages in NEW tabs** (`tabs_create_mcp`). Never navigate the
  user's dashboard tab away.
- **Native dialogs freeze the browser extension.** DataPipe's dashboard has
  none ([dashboard.md](dashboard.md) has the audit), but avoid **"Choose Drive folder"**
  and any **"Connect …"**, which leave the origin for OAuth — neither is needed below. If
  one appears anyway, the extension is stuck: say so and stop.
- **Always use a fresh experiment**, titled `e2e-YYYYMMDD-HHMM`; record its
  ID. Duplicate-filename scenarios depend on a clean collision cache.
- **Order matters more than coverage.** Read §4 before running anything —
  one scenario, run early, destroys two others.
- **`computer` coordinates are screenshot pixels, not CSS pixels, and the
  scale differs per tab; `javascript_tool` has a ~45 s ceiling per call.** Scale a JS-read
  `getBoundingClientRect()` by `screenshotWidth / window.innerWidth` before clicking, and
  keep poll loops under ~40 s. Detail: [dashboard.md](dashboard.md)'s "What the browser
  tooling cannot do".

## 2. Confirm the deploy is actually live

Do this first, or a green report means nothing. `gh run list --workflow "Deploy to Test"
--branch test --limit 3` — the run for the commit under test must be `completed /
success`. Note the SHA. Optionally, and often unavailably (§8), `functions_list_functions`
on `datapipe-test` should show the 13 exports in `functions/src/index.ts` and **no**
standalone `apisessionstart`, `apicondition` or `apibase64`; without it you can only prove
a couple of removed routes 404 from the browser — say so.

**Do not start a run while a "Deploy to Test" is in progress, and wait ~1 min after it
completes.** OBSERVED 2026-09-20: a click landed in the last 10 s of a deploy and
`dashboardapi` took **17.9 s** to start, against a normal 3–5 s cold start (Cloud Run
startup logs, all functions).

## 3. Create the experiment

Full click path and literal strings: [dashboard.md](dashboard.md). In short: `/admin` →
**"Create an experiment"** → **"Google Drive"** → title `e2e-YYYYMMDD-HHMM` → **"Create
experiment"** → `/admin/<experimentID>`. Read the ID from `location.pathname` (no copy
button). Then switch **"Accept new data"** on, wait for the **"Saved"** badge, and open
**"Open folder"** in a tab you keep for every `expectStorage` check.

- **Leave the Drive folder unset** so DataPipe creates
  `My Drive/DataPipe/<title>`. If the form offers **"Connect Google Drive"** instead of a
  title field, stop and ask the user.
- **Leave validation alone** — a new experiment requires `trial_type` and
  both pages emit it; look there if a scenario is refused `INVALID_DATA`.
- **"Generate Psych-DS metadata" locks permanently once data exists.**
  Decide before the first submission and record which way you set it: with it on, raw
  files live under `data/raw/` and an unparseable body is refused `METADATA_ERROR`; either
  way the experiment is not default state.

## 4. Load the manifest

Fetch `https://jspsych.github.io/datapipe-testbed/scenarios.json`. **It may not be
deployed yet** — the change may still be an open PR. Degrade in this order and say which
you used: published manifest; `site/scenarios.json` in a local checkout of
`jspsych/datapipe-testbed`; the prose "What to check" list on the home page (result
contract absent too — see §5 — every scenario is `automation: agent`).

**Run them in `order`. This is not a preference.** Switching data collection off makes the
staging sweep **discard** anything still staged (`scheduled-staging-sweep.ts`, "THE SECOND
DOOR"), so running `closed-experiment` before the recovery scenarios' partials are queued
destroys them and reports a recovery bug that does not exist (happened 2026-09-19). Before
any `mustRunLast` scenario, check its `runAfterCondition`: for `closed-experiment`, `GET
/api/queuestatus?experimentID=<id>` must already list an entry for each id in its
`runAfter`. If not, wait, or use a second throwaway experiment.

Skip `"manual"` unless asked — today only `brief-dropout`: the browser extension cannot
turn the network off, and the testbed has no fake for it.

## 5. Run one scenario

For each scenario in the manifest:

1. Build the URL:
   `https://jspsych.github.io/datapipe-testbed/<jspsych|vanilla>/?experiment=<ID>&base=https://datapipe-test.web.app&run=<scenario-id>-<HHMM>&<scenario.params>`
   `run` must be unique — it goes into the filename and is how you find it.
2. Perform any pre-URL `driverActions` (dashboard switches, mostly). Click
   the **visible switch track, not the hidden checkbox** — the input by element reference
   does nothing — and wait for the "Saved" badge. Then `tabs_create_mcp` the URL.
3. **Starting a run is the fiddliest step, and the one the contract now
   verifies for you.** Wait until `data-testbed-status` on `<html>` reads **`ready`**.
   **Do not click the page body first** — a tab opened with `tabs_create_mcp` + `navigate`
   is not the tab Chrome is displaying (`document.visibilityState === "hidden"` even
   though `document.hasFocus()` misleadingly reads `true`), and a keypress only reaches
   the displayed tab; `type` is ignored too. OBSERVED 2026-09-20: take a `computer`
   **screenshot** of the tab first — that brings it to the front — then, in a separate
   call, send a single `f`; re-read the status. **`running` means the key landed; still
   `ready` means it did not** — screenshot and send again. `f` is also a valid trial
   response, so an extra keypress is harmless. A page that goes `ready` → `aborted`
   without a key (`vanilla-condition-off`) is not waiting for one; poll for a terminal
   status.
4. Perform mid-run `driverActions`. To act **at a trial** — closing the tab
   half-way — poll `data-testbed-trials-completed` against `data-testbed-trials-planned`
   about every 5 s; never time it off the clock (a 2026-09-19 run let a 60-trial page
   finish before it could abandon it). Tool calls cost seconds each, so expect to
   overshoot by 20–30 s; the manifest sizes `trials` to absorb it. **Read the result and
   keep `filenames[0]` FIRST** — unrecoverable once the tab is gone, and how you recognise
   the partial an hour later. Note the wall-clock close time: the recovery clock starts at
   the socket drop; an open tab is live.
5. Poll `data-testbed-status` every 2 s until `finished`, `failed` or
   `aborted`, or `timing.pageRun` exceeded by 60 s. Then read the JSON text of
   `#testbed-result`. **Read the DOM, not `window.__testbed`** — same object, but an
   extension evaluates JS in an isolated world and may not see a page global, while DOM
   reads always work.
6. Compare against `expectPage`: final `status`; `trialsCompleted` against
   `trialsPlanned` (a refused submission still ran every trial — the counter is what tells
   "the save failed" from "the run failed"); and for each expected request label the HTTP
   `status` and, on failures, the `error` **code**, never a `message` string
   ([endpoints.md](endpoints.md)). A scenario passes only if every listed expectation
   holds. `sessionId` is `null` on every jsPsych-page run by design; the vanilla page
   reports one.
7. Check `expectDashboard` (live Firestore listeners — no refresh needed,
   but changes can lag a few seconds). Assert on the literal strings in
   [dashboard.md](dashboard.md), never a paraphrase, and **match the live-session row by
   this run's `run` id — never assert on the session count or the header's "N sessions in
   progress" chip**, which shows even at zero for a collecting, streaming experiment
   (merely loading the jsPsych page opens a session too). The rejections panel is hidden
   whenever anything is queued; [dashboard.md](dashboard.md) has both panels' concrete,
   now-observed expectations.
8. Check `expectStorage` in the Drive folder tab, per the scenario's
   `countBy`: **count files by this run's filename stem, never the folder total.** A
   `.psychds-ignore` accumulates once per upload on Drive (known issue). With metadata on,
   raw files sit under `data/raw/` with a derived `subject-…_data.csv` beside each. Then
   close the scenario's tab.

**Learn the schema before relying on any of this.** Read `data-testbed-schema` off
`<html>` first — a one-line DOM check, no JSON parse needed; fall back to the JSON's
`schema` field if absent, then to schema-1 behaviour if neither is present. Record which
you got, in the report header:

- **`schema: 2`** — everything above.
- **`schema: 1`** — no `ready` (status reads `running` from page load, so proves nothing
  about the keypress), no trial counter, no `source`, `ms` null everywhere. Verify a start
  by the first stimulus on screen, size any "act at trial N" step off
  `timingFacts.observedPageRates`. Say so.
- **Absent** (neither attribute nor `#testbed-result`) — the deployed
  testbed predates the contract. Judge each run from
  `document.getElementById('log').textContent` and say so per scenario.

`get_page_text` is intermittently refused — on `jspsych.github.io`, and OBSERVED
2026-09-20 on the dashboard right after a hard reload. `document.body.innerText` always
worked, on both.

## 6. Direct endpoint probes

Run these from the JavaScript context of an open testbed tab — CORS is open on `/api/*`,
so a `fetch` from there behaves like a participant's, needs no page, takes seconds.
Payloads and the full list: [endpoints.md](endpoints.md). Each probe writes a
rejections-panel entry on the real experiment: expected — note it, and that a
`METADATA_ERROR` probe also reappears in the queue later, briefly (§9).

## 7. The queue, without the dashboard

`GET /api/queuestatus?experimentID=<id>` gives the raw `retryCount` / `lastAttemptAt` /
`failureReason`, and is how you check `closed-experiment`'s `runAfterCondition`. **Re-read
the ID token from IndexedDB on every poll** — a cached one expires after about an hour
(OBSERVED 22:55Z, 2026-09-19). Call and token location: [endpoints.md](endpoints.md).

## 8. Server-side verification — optional

If the Firebase MCP tools are authenticated, for the run's window: `functions_get_logs`
for `apidata`, `participantapi`, `dashboardapi`, `scheduledsweep`, `compactiontask` (any
`severity>=ERROR`); `logs/<experimentID>`'s
`saveData`/`saveDataSucceeded`/`saveDataQueued` counters against what you submitted;
`uploadQueue` filtered to the experiment.

**Not a gate, and frequently unavailable** — both the MCP tools and the local `firebase`
CLI returned 401 on 2026-09-19; do not log in. Record the section as **not observed**
rather than blank: blank reads as "clean", and §2's function inventory goes unverified
with it.

## 9. Deferred checks

Scenarios with `deferredCheck: true` cannot finish inside a run. The staging sweep only
**queues** a recovered session, and a queue entry with no provider error code waits an
hour for its first attempt — so a `.partial.json` lands in storage roughly **65–75
minutes** after the dropout, not 15. Until then the queue panel lists it **"Waiting to be
stored"**, `retryCount: 0`, `lastAttemptAt: null` — not a failed upload. OBSERVED
2026-09-20: queued exactly **10 min 25 s** after the tab closed, `nextRetryAt` =
`createdAt` + 60 min exactly. **Trials still staged but not yet flushed when the tab dies
are lost** — a page counter reading 64 at close recovered as a 60-trial partial — so when
polling `trialsCompleted` to act "at trial N", expect the partial to hold a few fewer
trials than N.

A `METADATA_ERROR` probe is the tightest window: its kept copy is queued at the next
`:00`/`:15`/`:30`/`:45` slot once older than 15 minutes, with `nextRetryAt` = `createdAt`
+ **1 minute** — not +60 like a recovered partial — so visible in the queue only **about 5
minutes**. OBSERVED 2026-09-20: queued 25 min 24 s after the probe (the `:30` slot).

Record, per deferred scenario: the filename stem, the folder, the wall-clock time to
check. Mark it `DEFERRED`, never `PASS`. **Before reporting a finding, read "Known issues
a run will trip over" in `docs/e2e-testing.md`** (the manifest's `knownIssues` says the
same) — several things there look like bugs and are not.

## 10. Report

Write [output-template.md](output-template.md), filled in, to
`e2e-reports/<YYYY-MM-DD>-<shortsha>.md` — gitignored, a run's output being a per-run
artifact about a test deployment, not documentation, in a public repo. Paste anything
worth keeping into the PR or an issue.

Every scenario gets `PASS`, `FAIL`, `DEFERRED` or `SKIPPED` **with evidence** — statuses
and error codes from `requests`, `trialsCompleted`, filenames seen in Drive, dashboard
strings matched. "Looked fine" is not evidence. Say explicitly what was **not observed**,
including anything §8 could not reach, and end with everything that surprised you — the
manifest is meant to be corrected.

## 11. Cleanup

- Switch **"Accept new data"** off, and any switch a scenario turned on.
  **This is only safe once §4's `runAfterCondition` is satisfied for every recovery
  scenario you ran** — every entry it queues must already be visible in `GET
  /api/queuestatus` — because the sweep discards staged sessions of an experiment that is
  not collecting (§4). Note every setup change, such as the Psych-DS metadata toggle, so
  the next reader knows the experiment is not in its default state.
- **Do not delete the experiment or any stored file**, not even after the
  deferred checks clear: the folder must stay intact for another hour, and the maintainer
  decides when an e2e experiment goes.
- Close the tabs you opened; leave the user's own alone. If the tooling
  refuses to close one — it dissolves its tab group once the others are gone — say which
  tab is still open rather than leaving it unmentioned.
