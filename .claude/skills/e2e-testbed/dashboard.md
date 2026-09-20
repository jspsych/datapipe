# Driving the dashboard

Click paths and the literal strings to match on. All quoted text is copied from
the components, so `find` and `get_page_text` can match it exactly — including
the em dashes in the live-session states. Sources are named per section.

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
anywhere in the app. The create call typically takes about 1.3 s; budget ~10 s.

## Switches — `components/dashboard/ExperimentActive.js`

All live in the **"Data collection"** section of `/admin/<id>`, autosave on
toggle, and show a transient "Saved" badge (`role="status"`) on success. No
confirmation.

**Click the visible switch track, not the hidden `<input type=checkbox>`.**
Clicking the input by element reference does nothing, even though it carries
the accessible name. Wait for the "Saved" badge before moving on.

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
submission or not at all.

## Live sessions — `components/dashboard/LiveSessionsPanel.js`

The panel is **only rendered while at least one session is open**, so its
absence is the assertion for "the session closed", not a bug. Heading:
**"Sessions in progress"**. Columns: "Status", "Running for", "Started".

**The header chip is not a proxy for the panel.** `pages/admin/[experiment_id].js`
shows the **"N sessions in progress"** chip whenever `inProgressCount > 0` OR
(`logs.startSession > 0 && data.active && !data.finalized`) — so a collecting,
streaming experiment shows **"0 sessions in progress"** with no session open
at all, once any session has ever started. Never treat this chip as the
assertion for "no live sessions"; use the panel's presence (or the row
matching the scenario's `run` id) instead.

Exact status strings, in the sequence a dropped connection moves through them:

- **`In progress`** — connected.
- **`Connection lost — may resume`** — disconnected, inside the 10-minute grace.
- **`Stopped — being recovered`** — disconnected past the grace; the sweep will
  take it. The row disappears once the partial is queued.

**Never assert on the NUMBER of sessions in progress.** Loading the jsPsych page
opens a session before any trial runs, so a page opened and navigated away from
leaves a row behind until the sweep clears it. Match the row belonging to the
scenario's `run` id instead.

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
`aria-label="Download <filename>"` (the row's **full stored path**, not the
basename shown in the cell — by design, per the component's own comment), and
an accordion trigger **"What is happening to these files?"** whose body is
hidden until clicked.

The headline text depends on which kinds are present — see
`components/dashboard/QueuePanel.js`'s `summaryText` for the exact four cases
(all failed / failed + others / retrying, maybe some waiting / all waiting).
An all-waiting queue never says "did not upload" or anything implying a
failure; a `METADATA_ERROR` recovery entry does not say "server restart or
memory limit" — see endpoints.md.

**Assert on these strings, for an all-`waiting` queue in dark mode:**

- Plain neutral `SectionPanel`, no coloured edge, no fill: `background`
  byte-identical to the page background in dark mode, all four borders 1px
  neutral. `svg.lucide-clock` — never `svg.lucide-minus` — appears in the
  header chip, the panel headline, and each waiting row's status.
- Headline **"One file is waiting to be stored."** / **"N files are waiting
  to be stored."**; header chip **"N upload(s) waiting to be stored"**.
- Body: *"DataPipe is storing these automatically; nothing has failed. You
  can download them now if you need them sooner."*
- Columns, in order: **Filename** / **Status** / **Reason** / **Kept for
  another** (+ a visually-hidden "Download" header). The Filename cell shows
  the **basename**; the full `data/raw/…` path is only in the cell's `title`.
- Status is one line (`white-space: nowrap`); its sub-line sits indented
  under the status **label**, not the icon (`ms={6}` = icon width + gap), and
  reads **"First attempt in `<n>`"** for a `waiting` row (`"First attempt
  within 5 minutes"` once `nextRetryAt` is in the past) or **"Next retry in
  `<n>`"** for `retrying`. Forms seen: `in 1h`, `in 59m`, `in 1m`.
- **"Download all as ZIP"** sits right-aligned, directly above the table,
  flush with the table's right edge.
- A row's per-row download is `GET
  /api/queuestatus?experimentID=<id>&download=<id>` → 200.
- "Kept for another" reads `<n>d <n>h` (no `retainUntil` on the entry falls
  back to `createdAt + 7d`), one line.
- The rejections panel and its header chip are both absent while this panel
  shows anything.

The `Retrying` and `Failed` row states have not been exercised against a live
deployment — both need the Drive connection broken — so their icons and the
orange/red panel treatments remain unverified.

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
recovery scenario queues a partial — and that partial's first storage attempt
is an hour after it was queued, so the panel stays away for roughly **1 h 5
min**.

A quiet `SectionPanel` with a **3px `status.error` left border** — an accent,
not a fill. Do not look for `role="alert"`. The headline icon is
`svg.lucide-circle-x`, stroke `status.error`; there is no red fill and no red
body text anywhere in the panel. In dark mode the panel's `background-color`
is byte-identical to the page background, so the 1px border is the only other
thing separating them.

| | Literal string |
|---|---|
| Headline | `<N> submissions to this experiment were rejected.` (`One submission …` at 1) |
| Body | `DataPipe refused these submissions.` + `The most recent was <relative time>.` (absolute time is in the `title` of the relative-time span) |
| Accordion | `Show what was rejected`, or `Show the 20 most recent of <total>` once `count > MAX_ROWS` |
| Columns | `What happened` / `Time` |
| Row | `message`, then `detail`, then `Code: <CODE>` |
| Button | `Clear this list` (small, outline, neutral — not red) |

**`MAX_ROWS = 20`, not 50** (`components/dashboard/ErrorPanel.js`) — that is
the frontend row/accordion cap. The backend's `MAX_ERROR_ENTRIES = 50`
(`functions/src/write-log.ts`) is the separate cap on how many entries
`logs/{id}.errors` stores at all; do not conflate the two numbers.

**`METADATA_ERROR` rows carry an extra line**, because that refusal is the one
that does not lose the data: *"The raw data was kept. DataPipe stores it in
your storage provider without Psych-DS metadata, usually within about half an
hour."* The panel's row `detail` matches the API response's `message` field
verbatim — see [endpoints.md](endpoints.md) for the wire text.

**Counts are since the last clear**, not lifetime: `lib/error-panel.js`'s
`visibleErrors` returns `logError - logErrorCleared`, and rows older than
`errorsClearedAt` are filtered out. So a "0 rejections" panel means "nothing
since the last clear", and an earlier clear makes the count disagree with the
number of probes you fired. **"Clear this list"** posts to `/api/clearerrors`
with the account's ID token and moves the watermark; the lifetime counters are
untouched.

`POST /api/clearerrors` returns **200**. The panel and the header chip
**disappear together, without a reload** — the parent's Firestore listener
unmounts both once the watermark lands. **The round trip is slow: budget more
than 10 s, up to ~16 s** (a cold `dashboardapi` most likely) — at ~5 s a
driver would reasonably, and wrongly, conclude the button did nothing; nothing
flashes or errors while waiting, the button just shows its loading state. A
fresh rejection after a clear shows a headline count of **exactly one**, with
only the new row in the accordion — the watermark, not the lifetime count,
drives the number.

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

**Count files by the scenario's filename stem, never by folder total.** A
`.psychds-ignore` accumulates **one per successful upload** rather than one per
experiment: `metadata-derived-upload.ts` dedupes on the provider's
`NAME_CONFLICT`, and Drive permits duplicate names, so the dedupe never fires —
N uploads leave N copies. A pre-existing DataPipe bug — report it as a known
issue, not a finding.

## What the browser tooling cannot do

- **`resize_window` can report success and change nothing.** At target widths
  like 420 px, 440 px or 1280 px, `window.innerWidth` can stay pinned at its
  starting value while only `outerWidth` moves: this happens when the Chrome
  window is in macOS fullscreen, where the renderer viewport does not follow
  the window bounds. **After calling it, verify `window.innerWidth` actually
  changed. If it did not, report that and move on — do not retry the call.**
  A responsive check needs a human to take the Chrome window out of
  fullscreen first; the narrow (~420 px) and wide (~1280 px) layouts remain
  unchecked until then.
- **`computer` clicks are in the screenshot frame, not CSS pixels, and the
  scale differs per tab.** `getBoundingClientRect()` always returns CSS
  pixels, while the screenshot frame can be a different size (e.g. on a
  high-DPI display). A click built from an unscaled JS rect silently misses —
  a download-button click can produce no network request at all — so scale by
  `screenshotWidth / window.innerWidth` before clicking, and scroll the
  target into view first.
- **`javascript_tool` has a hard ~45 s CDP ceiling** ("Runtime.evaluate timed
  out after 45000ms"). Keep an in-page poll loop under ~40 s per call rather
  than writing one long loop that dies. The extension also returns
  `[BLOCKED: Cookie/query string data]` for expressions that enumerate
  `localStorage` keys or dump all of an element's attributes (e.g.
  `[...html.attributes].map(...)`) — read one named value per call instead.
- **A tab created with `tabs_create_mcp` + `navigate` is not the tab Chrome
  is displaying** (`document.visibilityState === "hidden"`, while
  `document.hasFocus()` misleadingly reads `true`), so a keypress sent to it
  does nothing and `type` is ignored too. Taking a `computer` screenshot of
  the tab is what brings it to the front; see SKILL.md §5 step 3.
- **Accordions animate.** Screenshotting an expanding accordion mid-animation
  can catch it clipped to a thin sliver. Screenshot after it settles, or
  measure the element (`data-state="open"`, a real `height`) instead. Not a
  clipping bug.
- **Background tabs are throttled.** A 20 s `setInterval` poller in a
  backgrounded dashboard tab can fire as infrequently as once a minute. It
  still catches every transition, but do not size a tight window off a
  background poll.
- **`get_page_text` is unreliable in two places.** It is intermittently
  refused on `jspsych.github.io`, and can return "No text content found" on
  the dashboard immediately after a hard reload (working again once the page
  settles). `document.body.innerText` works reliably on both.
- **Firebase ID tokens expire after about an hour.** A poller holding a
  captured token will start getting `401
  {"error":"Invalid authentication token"}` once it does. Re-read the token
  from IndexedDB on every poll — see [endpoints.md](endpoints.md).
- **Dark is the only mode.** The dashboard is dark-only; there is nothing to
  check in light mode. See "Colour mode" below.

## Colour mode

**DataPipe is dark-only. Do not check light mode, and do not report anything
seen in it.** `pages/_app.js` wraps the app in next-themes' `ThemeProvider` with
`attribute="class"`, `defaultTheme="dark"` and **`forcedTheme="dark"`**; its own
comment says why: "Dark is DataPipe's only mode (DESIGN.md §2). forcedTheme, not
just defaultTheme: visitors who picked Light/System while the toggle existed
still have that choice in localStorage, and it must not resurrect a retired
mode." There is no in-app toggle and the page does NOT follow the OS setting.

That comment also explains a stray key sometimes found in browser storage:
`localStorage["datapipe-color-mode"]` is a leftover from when a toggle
existed — nothing in the current source reads or writes it — so never treat
it as a control.

Overwriting `document.documentElement.className` with `"light"` does repaint
the page, but what it shows is the retired mode: unsupported, unmaintained,
and not evidence of anything. The only reason to know the mechanism is to
recognise the state if a run ever finds the page light — that would be a bug
in the forcing, and worth reporting.

Dark-mode token value (`--chakra-colors-status-error`): `#F17761` — the red
left edge on the rejections panel and its `lucide-circle-x` icon.

## Other traps

- `components/dashboard/CodeHints.js` hides its snippets behind a language menu
  (**"jsPsych v8"** / **"JavaScript"**) and tabs (**"Save data"**, **"Save as
  you go"**, **"Save file"**, **"Conditions"**). Only the active tab is in the
  DOM.
- Renaming an experiment (`Title.js`) is icon-only: `aria-label="Rename
  experiment"`, then `aria-label="Save new name"` or `"Cancel renaming"`.
- The experiment list links to `/admin/<id>` from the title text, not a button.

## Typical timings

Use these to size waits, not as assertions.

| | |
|---|---|
| jsPsych page, `auto=1` | 1.1–1.7 s per trial |
| Vanilla page, `auto=1` | 400 ms per trial |
| `POST /api/data` that writes to Drive | 2–4.5 s (occasionally up to ~5 s on a vanilla-page save) |
| `POST /api/createexperiment` | about 1.3 s |
| Warm `dashboardapi` calls | 190–370 ms |
| Refusals that never reach a provider | 270–480 ms |
| `dashboardapi` cold start, clean deploy | ~745 ms |
| `dashboardapi` cold start, click landed in the last moments of a deploy | up to about 18 s — wait ~1 min after "Deploy to Test" completes |
| Abandoned tab → queue entry | about ten to fifteen minutes |
| Queue entry (recovered partial) → first Drive attempt | `createdAt` + 60 min exactly |
| `METADATA_ERROR` refusal → its kept copy queued | at the next `:00`/`:15`/`:30`/`:45` slot, roughly 15–30 min after the probe |
| That metadata-kept entry → its own first attempt | `createdAt` + **1 min** (not +60 like a recovered partial), so visible in the queue only ~5 min |
| `POST /api/clearerrors` round trip | > 10 s, up to ~16 s — a slow round trip, not a broken button |

`participantapi`'s genuinely-first call is made inside the page by the
extension and is not visible, so its cold start remains unmeasured.
