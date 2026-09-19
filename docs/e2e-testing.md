# End-to-end testing

Unit and emulator tests cover the handlers. What they cannot cover is the thing
DataPipe actually promises: a participant's browser sends data and it turns up
in a researcher's Drive folder, through Hosting rewrites, real Cloud Functions,
real OAuth credentials and a real provider API. That is what the testbed is
for, and until now it was a person opening two pages and squinting at a log.

## The pieces

**The testbed** — <https://jspsych.github.io/datapipe-testbed/>, source
[`jspsych/datapipe-testbed`](https://github.com/jspsych/datapipe-testbed). Two
participant-facing pages, one jsPsych + `@jspsych/extension-pipe`, one plain
JavaScript + `datapipe-client`, both configured entirely by URL parameters and
both logging every request on screen. They send real data to a real experiment,
so point them at **datapipe-test**, never production.

**The result contract** — every run publishes `window.__testbed`: the status,
how many trials have finished out of how many were planned, each request the
page made with its HTTP status, the session id, the assigned condition, the
filenames it claimed, and notes about the paths it cannot see (the extension's
and the client's own requests). The same object is mirrored onto `<html>` as
`data-testbed-status`, `data-testbed-trials-completed` and
`data-testbed-trials-planned`, and into a collapsed `<pre id="testbed-result">`
— and **that DOM mirror is the primary interface**, because a browser
extension evaluates JavaScript in an isolated world and may not see a page
global at all. The testbed README describes the shape.

Schema 2 (2026-09-19) added the two things the first agent-driven run needed
and did not have. A run is **`ready`** — loaded, valid, waiting for the
participant's first keypress — before it is `running`, so a driver can tell
"the page is up" from "the start key landed"; schema 1 published `running` from
page load and a driver read it as trials advancing, wrongly, twice. And
`trialsCompleted` / `trialsPlanned` make "act at trial N" a poll rather than a
guess: the abandoned-tab scenario used to be timed off the clock, and the page
finished before it could be abandoned. A driver should read `schema` and fall
back if it is still 1.

**The scenario manifest** — `site/scenarios.json` in that repo is the single
source of truth for what to check: the URL parameters, the steps a driver has
to take beyond opening the page, and what the page, the dashboard and the
provider folder should each show. The testbed home page renders its "What to
check" list from it. Edit the manifest, not the page.

**The runbook** — `.claude/skills/e2e-testbed/` in this repo. A skill that
turns a Claude session with browser tools into the driver: create the
experiment, run each scenario, assert on `__testbed`, check the dashboard and
the Drive folder, probe the endpoints directly, and write a report to
`e2e-reports/` (gitignored — a run's output is a per-run artifact about a test
deployment, not documentation, and this repo is public). The reference files
beside it hold the endpoint expectation table, taken from the handlers, and the
dashboard click paths with the literal UI strings.

## Running it by hand

Create an experiment on <https://datapipe-test.web.app>, switch data collection
on, open the testbed home page, enter the experiment ID, and work down the
list. Each scenario says what the dashboard and the storage folder should look
like and when.

One timing is worth knowing before it surprises you: an abandoned session is
recovered by the five-minute sweep, but the sweep only **queues** it. A queue
entry with no provider error code waits an hour for its first upload attempt,
so a `.partial.json` reaches storage roughly 65–75 minutes after the dropout.
In the meantime the dashboard's queue panel shows it as **"Waiting to be
stored"** — DataPipe has recovered the data but has not tried to upload it
yet, which is what actually happened; it is no longer described as a failed
or retrying upload. That is expected.

And one ordering rule: **switch data collection off last.** While an experiment
is not `active`, the staging sweep *discards* every session still staged for it
(`scheduled-staging-sweep.ts`, "THE SECOND DOOR") rather than recovering it. A
run on 2026-09-19 closed the experiment for the closed-experiment check while
an earlier session was still waiting out its grace period, and spent the rest
of the session investigating a recovery bug that does not exist.

## Known issues a run will trip over

These are real, expected, and not worth reporting again. The manifest carries
the same list as `knownIssues` so a driver does not flag them.

- **A `METADATA_ERROR` refusal comes back as a queue entry.** `api-data.ts`
  deliberately keeps the pending copy — "scheduled-pending-recovery salvages it
  later instead of losing it outright" — because `METADATA_ERROR` means
  metadata generation failed, not that the participant's data was refused, and
  the policy is never to destroy raw data over that. The pending object is now
  labeled (`persist-pending.ts`'s `markPendingKept`), so within the next
  pending-recovery slot the entry appears with `failureReason: "Kept after a
  metadata failure (raw data stored without Psych-DS files)"`, and the
  dashboard shows it as kind `waiting` ("Waiting to be stored") rather than a
  retry or a failure — accurate, since DataPipe has never attempted a provider
  write for it. Note also that the retry worker re-checks `finalized` but not
  `active` — that gap is unchanged by this.
- **One `.psychds-ignore` per upload on Google Drive**, rather than one per
  experiment. `metadata-derived-upload.ts` dedupes on the provider's
  `NAME_CONFLICT`, and Drive permits duplicate names, so the dedupe never
  fires. Harmless but untidy, and it means file counts must be taken by
  filename pattern rather than folder total.
- **Assert on `error`, never on `message`.** `metadata-block.ts` returns
  `{...MESSAGES.METADATA_ERROR, message: errorMessage}`, replacing the message
  with the specific failure text — so the wire message is not the string in
  `api-messages.ts`. By design, and the reword in #261 proves the point: the
  same probe answered `"Invalid metadata generated"` in the morning and `"No
  columns were found in the submitted data, so Psych-DS metadata could not be
  generated. …"` in the evening, both 400 `METADATA_ERROR`. **Production still
  answers the old string** until `test` is promoted to `main`, so a run pointed
  at production sees the old copy — throughout the dashboard, not only here.
- **Loading a page starts a session**, so a page opened and abandoned before
  the first keypress still leaves a live-session row behind. Never assert on
  the number of sessions in progress.
- **The rejections panel is hidden while anything is queued.** It is not
  missing; the parent renders one panel or the other. Since a recovered
  partial waits an hour for its first storage attempt, checking a rejection
  after a recovery scenario means waiting roughly 1 h 5 min for the queue to
  drain. Check rejections *before* the recovery scenarios, or read the
  refusal's status code from the page's own result instead.
- **`sessionId` is null on every jsPsych-page run.**
  `@jspsych/extension-pipe` 0.2.0 exposes no public way to read the session it
  opened — the testbed says so in `notes` rather than reaching into the
  extension's private field. The plain-JavaScript page, which calls
  `datapipe-client` directly, does report one.

And one product default worth knowing, though it is not an issue for the
testbed any more: **a new experiment ships with validation on and `trial_type`
required** (`create-experiment.ts`). Both testbed pages now emit that field, so
no setup is needed — but it is where to look if a run is unexpectedly refused
with `INVALID_DATA`. Note that a validation refusal, unlike a metadata one,
happens *before* `persistPending`, so nothing is kept and nothing reappears in
the queue later.

## Recommended follow-up: a headless job

The scenarios marked `automation: "full"` in the manifest need nothing but a
browser: open a URL, wait, read `window.__testbed`. Those could run without a
person after every **Deploy to Test**.

A Playwright job would look like this: read `scenarios.json`, filter to
`automation === "full"`, sort by `order`, create nothing (reuse one long-lived
e2e experiment whose ID is a repository variable), open each scenario URL with
`run` set to the commit SHA, wait for `data-testbed-status` to read `ready`,
send the start keypress, confirm it reads `running`, poll to a terminal status,
read `window.__testbed`, and assert the `expectPage` block including
`trialsCompleted === trialsPlanned`. Eight of the fifteen scenarios are marked `full` today:
seven completely (`clean-finish`, `baseline-no-streaming`, `ended-early`,
`vanilla-streaming`, `vanilla-uncompressed`, `duplicate-rejection`,
`validation-failure`), and `failed-final-submission` for its page-level half
only -- its recovery check is deferred, and the `base64-*` pair
joins them if the shared experiment leaves base64 uploads switched on.

Playwright runs in the page's own world, so `window.__testbed` is directly
readable there — the DOM mirror exists for browser extensions, which evaluate
JavaScript in an isolated world.

**What it would verify.** That the Hosting rewrites resolve to the right
consolidated functions; that `/api/data`, `/api/base64`, `/api/session` and
`/api/condition` answer with the documented status codes; that gzipped and
plain bodies both get through; that duplicate filenames are refused; that a
timeline aborted mid-run still submits; that the extension and the client work
against the deployed contract rather than a mock. That is most of the surface
that actually breaks on a deploy.

**What it could not verify, and this is the larger half.**

- **Nothing in Google Drive.** Confirming a file landed needs Drive
  credentials for the experiment's owner. A CI job holding a researcher's
  refresh token is a meaningful secret to keep, and it is not the same
  credential as anything DataPipe deploys with.
- **Nothing on the dashboard.** The live-sessions panel, the queue panel and
  the rejections panel are all behind a signed-in researcher. That needs a
  dedicated Firebase Auth test account and its password in a secret, plus a
  sign-in step that survives whatever the sign-in page does next.
- **Anything needing a dashboard switch** — the closed-experiment, condition
  and base64 scenarios all begin by flipping a switch. Without a login the job
  would have to drive those flags another way, which means an admin path that
  does not exist and should not be invented for a test.
- **Tab close and network toggling** — `abandoned-tab` and `brief-dropout`.
  Playwright can do both (`page.close()`, `context.setOffline(true)`), but the
  assertion that matters is the recovered partial in storage 75 minutes later,
  which no per-deploy job should wait for. `brief-dropout` is the interesting
  one: a browser extension cannot go offline at all, so a headless job is the
  *only* way that scenario ever runs unattended. It is marked `manual` in the
  manifest for exactly that reason.
- **The deferred checks** generally. They belong in a separate scheduled job,
  or in the human runbook.

**What the maintainer would have to set up**, in the order the value arrives:

1. A long-lived e2e experiment on `datapipe-test` with data collection,
   conditions and base64 uploads all on, validation left at its default, and
   its ID in a repository variable. That alone unlocks the participant half.
   Decide about Psych-DS metadata at creation — the setting locks once the
   experiment has data.
2. A Playwright workflow triggered on `workflow_run` after **Deploy to Test**
   succeeds, reading `scenarios.json` from the published testbed so the two
   repos stay in step without a submodule.
3. Only if the dashboard half proves worth it: a dedicated test researcher
   account, its credentials in Actions secrets, and a decision about whether a
   CI job may hold a Drive refresh token. Weigh that against a human running
   the skill after a risky deploy, which costs nothing and checks more.

Storage growth is worth a thought before step 1: every run writes real files to
a real Drive folder, and a per-deploy job writes several. Either sweep the e2e
folder on a schedule or accept the accumulation deliberately.

**Do not add Playwright or a workflow on the strength of this document.** It is
a recommendation, and steps 1 and 2 should be a separate change with the
maintainer's sign-off.
