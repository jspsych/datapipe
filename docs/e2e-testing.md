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

**The result contract** — every run publishes `window.__testbed`: the final
status, each request the page made with its HTTP status, the session id, the
assigned condition, the filenames it claimed, and notes about the paths it
cannot see (the extension's and the client's own requests). The same thing is
mirrored onto `document.documentElement.dataset.testbedStatus` and into a
collapsed `<pre id="testbed-result">` for drivers that cannot evaluate
JavaScript. The testbed README describes the shape.

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
In the meantime the dashboard's queue panel describes it as an upload that did
not go through. That is expected.

## Recommended follow-up: a headless job

The scenarios marked `automation: "full"` in the manifest need nothing but a
browser: open a URL, wait, read `window.__testbed`. Those could run without a
person after every **Deploy to Test**.

A Playwright job would look like this: read `scenarios.json`, filter to
`automation === "full"`, create nothing (reuse one long-lived e2e experiment
whose ID is a repository variable), open each scenario URL with `run` set to
the commit SHA, poll `document.documentElement.dataset.testbedStatus`, read
`window.__testbed`, and assert the `expectPage` block. Roughly eight of the
fourteen scenarios qualify today, including the base64 and duplicate-rejection
paths.

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
  the error panel are all behind a signed-in researcher. That needs a dedicated
  Firebase Auth test account and its password in a secret, plus a sign-in step
  that survives whatever the sign-in page does next.
- **Anything needing a dashboard switch** — the closed-experiment, condition
  and base64 scenarios all begin by flipping a switch. Without a login the job
  would have to drive those flags another way, which means an admin path that
  does not exist and should not be invented for a test.
- **Tab close and network toggling** — `abandoned-tab` and `brief-dropout`.
  Playwright can do both (`page.close()`, `context.setOffline(true)`), but the
  assertion that matters is the recovered partial in storage 75 minutes later,
  which no per-deploy job should wait for.
- **The deferred checks** generally. They belong in a separate scheduled job,
  or in the human runbook.

**What the maintainer would have to set up**, in the order the value arrives:

1. A long-lived e2e experiment on `datapipe-test` with data collection,
   conditions and base64 uploads all on, and its ID in a repository variable.
   That alone unlocks the participant half.
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
