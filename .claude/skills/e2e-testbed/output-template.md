# The write-up a run must produce

Fill this template in and write it to `e2e-reports/<YYYY-MM-DD>-<shortsha>.md`.
Keep the headings; they are what makes two runs comparable.

---

# e2e run — <YYYY-MM-DD HH:MM TZ>

| | |
|---|---|
| Deployment | https://datapipe-test.web.app (project `datapipe-test`) |
| Commit | `<shortsha>` — `<subject line>` |
| Deploy run | `Deploy to Test` #<n>, <success/failure>, <time> |
| Experiment | `<experimentID>` — title `e2e-YYYYMMDD-HHMM` |
| Provider | Google Drive — `My Drive/DataPipe/e2e-YYYYMMDD-HHMM` |
| Manifest | published / local checkout / prose fallback |
| Result contract | `window.__testbed` present / absent (verdicts read off the log) |

## Scenarios

| # | Scenario | Automation | Verdict | Evidence |
|---|---|---|---|---|
| 1 | `clean-finish` | full | PASS | `final-save` 201; `testbed-clean-finish-….csv` in the folder; no in-progress row afterwards |
| … | | | | |

`PASS` / `FAIL` / `DEFERRED` / `SKIPPED`. Evidence means HTTP statuses and
error codes out of `__testbed.requests`, filenames actually seen in Drive, and
the dashboard strings matched. Never "looked fine".

For each `FAIL`, underneath the table:

### FAIL — `<scenario-id>`

- Expected: <the manifest's expectation, quoted>
- Observed: <the `__testbed` excerpt, the dashboard text, the folder contents>
- URL: <the full scenario URL, so it can be re-run>

## Deferred checks

| Scenario | Look for | In | Not before |
|---|---|---|---|
| `abandoned-tab` | `testbed-abandoned-tab-…-<8 hex>.partial.json` | `My Drive/DataPipe/e2e-…` | <HH:MM> (75 min after the tab closed) |

## Endpoint probes

| Probe | Expected | Got |
|---|---|---|
| `/api/base64` valid | 201 Success | |
| `/api/base64` invalid | 400 `INVALID_BASE64_DATA` | |
| `/api/base64` missing filename | 400 `MISSING_PARAMETER` | |
| `/api/condition` | 200 `condition: <n>` | |
| `/api/session` | 200 `sessionId`, `databaseURL` | |
| `/api/session` GET | 405 Method not allowed | |
| unknown experiment ×4 | 400 `EXPERIMENT_NOT_FOUND` | |

These deliberately produce error-panel entries on the experiment. Say so, or
the next reader will chase them.

## Server-side (optional)

- Function logs, <window>: <errors in `apidata` / `participantapi` /
  `dashboardapi` / `scheduledsweep` / `compactiontask`, or "none">
- `logs/<experimentID>`: saveData <n>, saveDataSucceeded <n>, saveDataQueued <n>
- `uploadQueue`: <what is still queued, and each entry's `nextRetryAt`>

## Anything surprising

Everything that did not match the manifest, whether or not it failed a
scenario: timings that were off, wording that has changed, a code that differed
from [endpoints.md](endpoints.md). If the manifest is wrong, say so — it is
meant to be corrected.

## Cleanup

- [ ] "Accept new data" switched off
- [ ] Any switch a scenario turned on switched back
- [ ] Tabs opened by this run closed
- [ ] Nothing deleted
