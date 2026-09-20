# Driving the dashboard

Click paths and the literal strings to match on. All quoted text is copied from
the components, so `find` and `get_page_text` can match it exactly — including
the em dashes in the live-session states. Sources are named per section.

Lines marked **OBSERVED 2026-09-19** were confirmed by a live run against
`datapipe-test`. Everything else is read off the components.

## Routes

| Page | Route |
|---|---|
| Sign in | `/signin` |
| Experiment list | `/admin` |
| New experiment | `/admin/new` |
| One experiment | `/admin/<experimentID>` |
| Account, provider connections | `/admin/account` |

On `datapipe-test` these hang off `https://datapipe-test.web.app`.

`/admin` and `/admin/<id>` render a spinner while their Firestore listeners
resolve; `/admin/new` renders skeletons. Wait for those to clear before
clicking. Everything after that updates through `onSnapshot` — no refresh
needed, but a change can lag a few seconds behind the server.

## Native dialogs

There are none. A repo-wide grep for `window.confirm`, `alert(` and `prompt(`
finds nothing in `components/`, `pages/`, `lib/` or `functions/src/`. Every
confirmation is `components/ui/ConfirmDialog.js`, an in-page Chakra dialog you
can read and click normally:

| Action | Dialog title | Confirm button |
|---|---|---|
| Delete experiment (trash icon, `/admin`) | `Delete "<title>"?` | "Delete experiment" |
| Finalize (`FinalizeControl`) | "Finalize this experiment?" | "Confirm" |
| Disconnect provider (`/admin/account`) | `Disconnect <Provider>?` | "Disconnect" |

Two things still take the tab away from DataPipe and should be avoided:
**"Choose Drive folder"** on `/admin/new` (a Google-hosted picker) and
**"Connect Google Drive"** / **"Connect Zenodo"** on `/admin/account` (a
full-page OAuth navigation). Dataverse instead opens an inline form with
"Dataverse server URL", "API token" and a **"Save connection"** button.

## Creating an experiment — `pages/admin/new.js`

1. `/admin` → **"Create an experiment"** (page header, or the empty state).
2. Radio group **"Where should data be stored?"**, options in this order:
   **"Google Drive"**, **"Dataverse"**, **"Zenodo"**. OSF is not offered for new
   experiments and is blocked server-side as well.
3. If the provider is not connected the form shows "Connect a … account to
   create an experiment." and a **"Connect <Provider>"** button. Stop there and
   ask the user.
4. **"Title"** — use `e2e-YYYYMMDD-HHMM`. It is cached in `sessionStorage`
   under `datapipe:new-experiment-title` and restored after mount, so a field
   read immediately after navigation may be empty for a tick.
   Dataverse additionally requires "Collection alias", "Author name", "Contact
   email", "Description"; Zenodo requires "Author name", "Description".
5. **"Create experiment"** → redirects to `/admin/<experimentID>`.

**Read the experiment ID from `location.pathname`** after that redirect. It is
also beside the label **"Experiment ID"**
(`components/dashboard/ExperimentInfo.js`), and there is no copy button
anywhere in the app. OBSERVED 2026-09-19: the create call took 1.3 s; budget
~10 s.

## Switches — `components/dashboard/ExperimentActive.js`

All live in the **"Data collection"** section of `/admin/<id>`, autosave on
toggle, and show a transient "Saved" badge (`role="status"`) on success. No
confirmation.

**Click the visible switch track, not the hidden `<input type=checkbox>`.**
OBSERVED 2026-09-19: clicking the input by element reference did nothing, even
though it carries the accessible name. Wait for the "Saved" badge before moving
on.

| Switch | Used by |
|---|---|
| **"Accept new data"** | everything; `closed-experiment` turns it off |
| **"Accept base64 file uploads"** | the `base64-*` scenarios |
| **"Assign conditions in sequence"** | the `vanilla-condition*` scenarios |
| **"Check submissions before storing them"** | nothing — leave it on; see below |
| **"Generate Psych-DS metadata"** | setup — see below |
| **"Stop after a set number of sessions"** | session-cap checks |

Turning conditions on reveals a number field **"How many conditions?"**
(minimum 2), which autosaves with its own "Saved" flag. Triple-click, type, Tab.

On failure the switch snaps back and shows a sentence beginning "Could not
change data collection…". If the experiment is finalized the switch is disabled
with "Locked because this experiment has been finalized…".

### Validation: leave it alone

`create-experiment.ts` sets `useValidation ?? true` and
`requiredFields ?? ["trial_type"]`, so a new experiment refuses any submission
without a `trial_type` column. Both testbed pages satisfy it — jsPsych writes
the field from each plugin's `info.name`, and the plain-JavaScript page emits
`trial_type: "letter-keyboard-response"` — so **no setup is needed**. Recorded
here only because it is where to look if a scenario is unexpectedly refused
with `INVALID_DATA`. The `validation-failure` scenario omits the column on
purpose, via `?failvalidation=1`; every other scenario needs the defaults
intact.

### The one setup trap

**"Generate Psych-DS metadata" locks permanently once data exists** — "Locked
because this experiment has collected data". Set it before the first
submission or not at all. OBSERVED 2026-09-19.

## Live sessions — `components/dashboard/LiveSessionsPanel.js`

The panel is **only rendered while at least one session is open**, so its
absence is the assertion for "the session closed", not a bug. Heading:
**"Sessions in progress"**. Columns: "Status", "Running for", "Started".

Exact status strings:

- **`In progress`** — connected.
- **`Connection lost — may resume`** — disconnected, inside the 10-minute grace.
- **`Stopped — being recovered`** — disconnected past the grace; the sweep will
  take it.

All three OBSERVED 2026-09-19, in that sequence, with the row disappearing once
the partial was queued.

**Never assert on the NUMBER of sessions in progress.** Loading the jsPsych page
opens a session before any trial runs, so a page opened and navigated away from
leaves a row behind until the sweep clears it. OBSERVED 2026-09-19: two such
rows. Match the row belonging to this run instead.

"Running for" renders as `under a minute`, `<n> min`, `<h> h <m> min` or
`<h> h`. Above 25 rows a footer reads "<n> more sessions are in progress and
not shown."

## Queue — `components/dashboard/QueuePanel.js`

Rendered only when something is queued. Every entry is one of three KINDS,
classified by `lib/upload-queue.js`'s `queueEntryKind` (same classifier the
header chip uses, so the two can never disagree):

- **`failed`** — `status === "failed"`. Every retry was used up.
- **`waiting`** — held on purpose and never attempted: `lastAttemptAt` is
  still null, `retryCount` is still 0, and `failureReason` is one of the
  known held/kept/recovered reasons (a recovered partial session, a raw file
  kept after a metadata failure, a hold for compaction or a cold collision
  cache). Row status **"Waiting to be stored"** (`processing` →
  **"Storing now"**), sub-line **"First attempt in `<n>`"**.
- **`retrying`** — everything else pending/processing, i.e. DataPipe has
  already tried a provider write at least once. Row status **"Retrying"**
  (`processing` → **"Retrying now"**), sub-line **"Next retry in `<n>`"**.

The panel's own visual weight follows the same three-way split
(`summarizeQueue(entries).tone`): a filled `error` alert only when something
has genuinely `failed`; a quiet bordered panel (orange left edge) when
something is `retrying` but nothing has failed; a plain bordered panel with no
colour at all when everything present is only `waiting`. Do not expect the
filled alert (`find`'s `role="alert"`) on an all-waiting or all-retrying
queue — only a permanent failure gets it.

There is **no retry button** — retries are server-side. The only controls are
**"Download all as ZIP"**, a per-row icon button with
`aria-label="Download <filename>"`, and an accordion trigger **"What is
happening to these files?"** (was "Why did these uploads fail?") whose body is
hidden until clicked.

The headline text depends on which kinds are present — see
`components/dashboard/QueuePanel.js`'s `summaryText` for the exact four cases
(all failed / failed + others / retrying, maybe some waiting / all waiting).
An all-waiting queue never says "did not upload" or anything implying a
failure; a `METADATA_ERROR` recovery entry no longer says "server restart or
memory limit" — see endpoints.md.

**THE PANEL IS MID-POLISH.** A follow-up PR to `QueuePanel.js` is in flight,
changing the `Stored for` column heading, the row sub-line ("soon"), how a
filename is written (basename rather than the `data/raw/…` path), and the
waiting icon. **Assert on the three kinds and on the panel's weight. Do not
assert on column headings, sub-line wording or filename rendering** — and if
they do not match, report "the panel is mid-polish", not a failure.

OBSERVED 2026-09-19, new build, a queue of one and then two waiting entries:
headline `One file is waiting to be stored.` / `2 files are waiting to be
stored.`; body `DataPipe is storing these automatically; nothing has failed.
You can download them now if you need them sooner.`; the panel measured with no
fill and a uniform 1px neutral border, no coloured edge; header chip
`— 1 upload waiting to be stored`, neutral, correctly pluralised. The
`Retrying` and `Failed` rows were **not** produced — both need the Drive
connection broken — so their icons and the orange/red panel treatments remain
unverified.

When the queue drains, a notice reads **"All queued uploads completed
successfully."** and **auto-hides after 8 seconds** — do not build an assertion
that depends on catching it.

**`GET /api/queuestatus?experimentID=<id>` is still useful** for the raw
`retryCount`/`lastAttemptAt`/`failureReason` fields, but is no longer the
*only* way to tell "queued, never attempted" from "attempted and failed" — the
dashboard panel itself now makes that distinction (waiting vs. retrying). See
[endpoints.md](endpoints.md) for the call and where to read the ID token.

## Rejections — `components/dashboard/ErrorPanel.js`

**Rendered only while the upload queue is empty.** The parent hides it whenever
anything is queued, so any assertion about a rejection has to be made before a
recovery scenario queues a partial. A recovered partial no longer sits on an
hour-long first attempt (`queueUpload`'s `attemptImmediately`, set by the
staging sweep) — it is due, and picked up, within the same sweep invocation
that queued it — so the panel should only stay away for the ~10–15 minutes
between the dropout and that recovery, not the "1 h 5 min" the old build's bug
produced. The 2026-09-19 observation (queue held the recovered partial
continuously from 22:40Z, panel never seen) was that bug, not the intended
behavior; re-verify against a build carrying the fix before treating a
long-held panel as expected again.

A quiet `SectionPanel` with a **3px `status.error` left border** — an accent,
not a fill. Do not look for `role="alert"`.

| | Literal string |
|---|---|
| Headline | `<N> submissions to this experiment were rejected.` (`One submission …` at 1) |
| Body | `DataPipe refused these submissions.` + `The most recent was <relative time>.` |
| Accordion | `Show what was rejected`, or `Show the 50 most recent of <total>` |
| Columns | `What happened` / `Time` |
| Row | `message`, then `detail`, then `Code: <CODE>` |
| Button | `Clear this list` (small, outline, neutral — not red) |

**`METADATA_ERROR` rows carry an extra line**, because that refusal is the one
that does not lose the data: *"The raw data was kept. DataPipe stores it in
your storage provider without Psych-DS metadata, usually within about half an
hour."* datapipe #261 also reworded the METADATA_ERROR `detail` itself — see
[endpoints.md](endpoints.md) — but **the new wording has never been seen in
this panel**, only on the wire.

**Counts are since the last clear**, not lifetime: `lib/error-panel.js`'s
`visibleErrors` returns `logError - logErrorCleared`, and rows older than
`errorsClearedAt` are filtered out. So a "0 rejections" panel means "nothing
since the last clear", and an earlier clear makes the count disagree with the
number of probes you fired. **"Clear this list"** posts to `/api/clearerrors`
with the account's ID token and moves the watermark; the lifetime counters are
untouched. It has never been exercised by a run — if you get the chance, record
the response status and whether the panel and the header chip disappear without
a reload.

## Finalize — `components/dashboard/FinalizeControl.js`

Only rendered for providers that support finalizing, which today is **Zenodo
only** — it does not appear on a Google Drive experiment. Button **"Finalize
experiment"** in the **"Danger zone"** section, then the confirm dialog above.
While a pass runs, the control is replaced by "Finalizing this experiment…".
Once done it becomes **"This experiment has been finalized."** and the button
is gone for good. Finalizing is permanent — never do it on an experiment the
user still needs.

## Finding the files — `providers/gdrive.ts`, `create-experiment.ts`

DataPipe names the Drive folder **exactly the experiment title**, with no
prefix and no ID appended. With no parent picked at creation it sits at
`My Drive/DataPipe/<title>`.

`ExperimentInfo.js` shows the label **"Google Drive Folder"** with a link whose
text is **"Open folder"**, opening
`https://drive.google.com/drive/folders/<folderId>` in a new tab. (Dataverse:
"Dataverse Dataset" / "Open dataset". Zenodo: "Zenodo Deposition" / "Open
deposition".)

With Psych-DS metadata on, raw submissions go to `<title>/data/raw/` and the
folder also holds derived CSVs (`subject-…_data.csv`, one per upload) plus
`dataset_description.json`. With it off, everything is at the folder root.
Base64 uploads always go to the root — `/api/base64` applies no Psych-DS layout
and runs no metadata block.

**Count files by this run's filename stem, never by folder total.** A
`.psychds-ignore` accumulates **one per successful upload** rather than one per
experiment: `metadata-derived-upload.ts` dedupes on the provider's
`NAME_CONFLICT`, and Drive permits duplicate names, so the dedupe never fires.
OBSERVED 2026-09-19: 5 copies after 5 uploads. A pre-existing DataPipe bug —
report it as a known issue, not a finding.

## What the browser tooling cannot do

All OBSERVED 2026-09-19.

- **`resize_window` reported success and changed nothing.** At 420 px and
  440 px, `window.innerWidth` stayed pinned at 1710 (= `screen.width`) while
  only `outerWidth` moved: the Chrome window was in macOS fullscreen, so the
  renderer viewport does not follow the window bounds. **A responsive check
  needs a Chrome window that is not fullscreen** — ask the user to leave
  fullscreen rather than reporting a layout you did not see. Neither the
  ~420 px nor the ~1280 px layout has ever been checked.
- **Accordions animate.** The first screenshot of an expanded explainer caught
  it mid-flight, clipped to a ~4 px sliver. Screenshot after it settles, or
  measure the element (`data-state="open"`, a real `height`) instead. Not a
  clipping bug.
- **Background tabs are throttled.** A 20 s `setInterval` poller in a
  backgrounded dashboard tab fired about once a minute. It still caught every
  transition, but do not size a tight window off a background poll.
- **The experiment pages follow the OS colour scheme and have no theme
  toggle** — no `data-theme`, nothing in the accessibility tree. Whatever the
  machine is set to is what you will screenshot; say which you saw. Light mode
  has never been observed.
- **Firebase ID tokens expire after about an hour.** A poller holding a
  captured token started getting `401 {"error":"Invalid authentication token"}`
  at 22:55Z. Re-read the token from IndexedDB on every poll — see
  [endpoints.md](endpoints.md).

## Other traps

- `components/dashboard/CodeHints.js` hides its snippets behind a language menu
  (**"jsPsych v8"** / **"JavaScript"**) and tabs (**"Save data"**, **"Save as
  you go"**, **"Save file"**, **"Conditions"**). Only the active tab is in the
  DOM.
- Renaming an experiment (`Title.js`) is icon-only: `aria-label="Rename
  experiment"`, then `aria-label="Save new name"` or `"Cancel renaming"`.
- The experiment list links to `/admin/<id>` from the title text, not a button.

## Timings measured on 2026-09-19

Use these to size waits, not as assertions.

| | |
|---|---|
| jsPsych page, `auto=1` | 1.1–1.7 s per trial |
| Vanilla page, `auto=1` | 400 ms per trial |
| `POST /api/data` that writes to Drive | 2–4.5 s |
| `POST /api/createexperiment` | 1.3 s |
| Warm `dashboardapi` calls | 190–370 ms |
| Refusals that never reach a provider | 270–480 ms |
| Abandoned tab → queue entry | 10–12 min |
| Queue entry → first Drive attempt | +60 min |
| METADATA_ERROR refusal → queue entry | ~27 min (the next `:00`/`:15`/`:30`/`:45` slot) |
| That entry → stored | ~5 min, so it is visible in the queue only briefly |

No dramatic cold start was seen after a deploy: the first `dashboardapi` call
was 745 ms. `participantapi`'s genuinely-first call is made inside the page by
the extension and is not visible, so its cold start remains unmeasured.
