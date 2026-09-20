# End-to-end testing

Unit and emulator tests in this repo cover the handlers. What they cannot cover
is the thing DataPipe actually promises: a participant's browser sends data and
it turns up in a researcher's storage, through Hosting rewrites, real Cloud
Functions, real OAuth credentials and a real provider API.

Everything for checking that lives in a separate repository,
[`jspsych/datapipe-testbed`](https://github.com/jspsych/datapipe-testbed):

- the two participant-facing test pages, published at
  <https://jspsych.github.io/datapipe-testbed/>;
- the scenario manifest that says what to run, in what order, and what to expect;
- the driver runbook (a Claude Code skill, `/e2e-testbed`, run from a checkout of
  that repo) and its overview, `docs/e2e-testing.md`;
- the reports of past runs, in `runs/`.

Nothing about end-to-end runs is kept here — no runbook, no reports. When a
change to the dashboard or the API alters what a run should see (a UI string, a
status code, a timing), update the manifest and the runbook in that repo
alongside it.
