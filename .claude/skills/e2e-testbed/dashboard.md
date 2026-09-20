# Driving the dashboard

Click paths and the literal strings to match on. All quoted text is copied from
the components, so `find` and `get_page_text` can match it exactly — including
the em dashes in the live-session states. Sources are named per section.

Lines marked **OBSERVED 2026-09-19** or **OBSERVED 2026-09-20** were
confirmed by a live run against `datapipe-test`; a bare date in prose (e.g.
"2026-09-20") marks the same. Everything else is read off the components.

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

**The header chip is not a proxy for the panel.** `pages/admin/[experiment_id].js`
shows the **"N sessions in progress"** chip whenever `inProgressCount > 0` OR
(`logs.startSession > 0 && data.active && !data.finalized`) — so a collecting,
streaming experiment shows **"0 sessions in progress"** with no session open
at all, once any session has ever started. OBSERVED 2026-09-20. Never treat
this chip as the assertion for "no live sessions"; use the panel's presence
(or the row matching this run's `run` id) instead.

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
`aria-label="Download <filename>"` (the row's **full stored path**, not the
basename shown in the cell — OBSERVED 2026-09-20, by design per the
component's own comment), and an accordion trigger **"What is happening to
these files?"** whose body is hidden until clicked.

The headline text depends on which kinds are present — see
`components/dashboard/QueuePanel.js`'s `summaryText` for the exact four cases
(all failed / failed + others / retrying, maybe some waiting / all waiting).
An all-waiting queue never says "did not upload" or anything implying a
failure; a `METADATA_ERROR` recovery entry no longer says "server restart or
memory limit" — see endpoints.md.

**The polish has landed — assert on these strings.** OBSERVED 2026-09-20, a
one- then two-entry all-`waiting` queue, dark mode, 1384 CSS px viewport:

- Plain neutral `SectionPanel`, no coloured edge, no fill: `background`
  byte-identical to the page background in dark mode, all four borders 1px
  neutral. `svg.lucide-clock` — never `svg.lucide-minus` — in the header chip,
  the panel headline, and each waiting row's status (3 occurrences with one
  entry).
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
  back to `createdAt + 7d`; OBSERVED `6d 23h`), one line.
- The rejections panel and its header chip are both absent while this panel
  shows anything.

The `Retrying` and `Failed` rows were **not** produced this run either — both
need the Drive connection broken — so their icons and the orange/red panel
treatments remain unverified.

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
not a fill. Do not look for `role="alert"`. OBSERVED 2026-09-20: headline icon
`svg.lucide-circle-x`, stroke `status.error`; no red fill and no red body
text anywhere in the panel. In dark mode the panel's `background-color` is
byte-identical to the page background, so the 1px border is the only other
thing separating them (in light mode the two differ).

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
hour."* datapipe #261 also reworded the METADATA_ERROR `detail` itself — see
[endpoints.md](endpoints.md). OBSERVED 2026-09-20: **the new wording is now
live in this panel** — the reworded detail ("No columns were found in the
submitted data…") appeared exactly as it does on the wire, the first time
this has been confirmed off the network log.

**Counts are since the last clear**, not lifetime: `lib/error-panel.js`'s
`visibleErrors` returns `logError - logErrorCleared`, and rows older than
`errorsClearedAt` are filtered out. So a "0 rejections" panel means "nothing
since the last clear", and an earlier clear makes the count disagree with the
number of probes you fired. **"Clear this list"** posts to `/api/clearerrors`
with the account's ID token and moves the watermark; the lifetime counters are
untouched.

**OBSERVED 2026-09-20, exercised for the first time:** `POST /api/clearerrors`
→ **200**. The panel and the header chip **disappear together, without a
reload** — the parent's Firestore listener unmounts both once the watermark
lands. **The round trip is slow: budget more than 10 s, up to ~16 s** (a
cold `dashboardapi` most likely) — at ~5 s a driver would reasonably, and
wrongly, conclude the button did nothing; nothing flashes or errors while
waiting, the button just shows its loading state. A fresh rejection after a
clear shows a headline count of **exactly one**, with only the new row in the
accordion — the watermark, not the lifetime count, drives the number.

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

- **`resize_window` reported success and changed nothing**, OBSERVED both
  2026-09-19 and 2026-09-20. At 420 px, 440 px, 1280 px, `window.innerWidth`
  stayed pinned at its starting value (1710 = `screen.width` on 2026-09-19,
  1384 on 2026-09-20) while only `outerWidth` moved: the Chrome window was in
  macOS fullscreen, so the renderer viewport does not follow the window
  bounds. **After calling it, verify `window.innerWidth` actually changed. If
  it did not, report that and move on — do not retry the call.** A responsive
  check needs a human to take the Chrome window out of fullscreen first;
  neither the ~420 px nor the ~1280 px layout has ever been checked.
- **`computer` clicks are in the screenshot frame, not CSS pixels, and the
  scale differs per tab.** OBSERVED 2026-09-20: 1544×784 on testbed tabs,
  1384×703 on the dashboard tab, while `getBoundingClientRect()` always
  returns CSS pixels. A click built from an unscaled JS rect silently misses
  (a download-button click produced no network request at all) — scale by
  `screenshotWidth / window.innerWidth` before clicking, and scroll the
  target into view first.
- **`javascript_tool` has a hard ~45 s CDP ceiling** ("Runtime.evaluate timed
  out after 45000ms"). OBSERVED 2026-09-20: keep an in-page poll loop under
  ~40 s per call rather than writing one long loop that dies. The extension
  also returns `[BLOCKED: Cookie/query string data]` for expressions that
  enumerate `localStorage` keys or dump all of an element's attributes (e.g.
  `[...html.attributes].map(...)`) — read one named value per call instead.
- **A tab created with `tabs_create_mcp` + `navigate` is not the tab Chrome
  is displaying** (`document.visibilityState === "hidden"`, while
  `document.hasFocus()` misleadingly reads `true`), so a keypress sent to it
  does nothing and `type` is ignored too. Taking a `computer` screenshot of
  the tab is what brings it to the front; see SKILL.md §5 step 3.
- **Accordions animate.** The first screenshot of an expanded explainer caught
  it mid-flight, clipped to a ~4 px sliver. Screenshot after it settles, or
  measure the element (`data-state="open"`, a real `height`) instead. Not a
  clipping bug.
- **Background tabs are throttled.** A 20 s `setInterval` poller in a
  backgrounded dashboard tab fired about once a minute. It still caught every
  transition, but do not size a tight window off a background poll.
- **`get_page_text` is unreliable in two places.** It is intermittently
  refused on `jspsych.github.io`, and OBSERVED 2026-09-20: it returned "No
  text content found" on the dashboard immediately after a hard reload (it
  worked before the reload). `document.body.innerText` always worked, on
  both.
- **Firebase ID tokens expire after about an hour.** A poller holding a
  captured token started getting `401 {"error":"Invalid authentication token"}`
  at 22:55Z. Re-read the token from IndexedDB on every poll — see
  [endpoints.md](endpoints.md).
- **A theme override EXISTS** — earlier text here said the pages "follow the
  OS colour scheme and have no theme toggle"; that is wrong. See "Colour
  mode" below.

## Colour mode

`pages/_app.js` wraps the app in next-themes' `ThemeProvider` with
`attribute="class"`, `defaultTheme="dark"` and `forcedTheme="dark"` — dark is
DataPipe's only supported mode (DESIGN.md §2) and there is no in-app toggle.
`forcedTheme` means the provider stamps `class="dark"` on `<html>` and never
calls `setTheme` again on its own, so a driver can flip modes for a
screenshot with a plain DOM write that next-themes will not fight back:

1. Read and record `document.documentElement.className` (it should be
   `"dark"`).
2. Set `document.documentElement.className = "light"` for a light-mode
   screenshot; the whole page repaints instantly.
3. Set it back to the value you recorded in step 1 to restore it exactly.

OBSERVED 2026-09-20: this round-trips cleanly and does not touch
`localStorage`. **One discrepancy to flag, not paper over:** the 2026-09-20
live run also reported `localStorage["datapipe-color-mode"] = "dark"` on the
page, and read that as next-themes' persisted preference. Nothing in
`pages/_app.js`, or anywhere else in the source at `origin/test`, sets a
`storageKey` of `"datapipe-color-mode"` — the code passes no `storageKey` at
all, so next-themes' own default (`"theme"`) would apply if anything ever
called `setTheme`, which nothing here does. That `localStorage` entry, if
present, is unexplained by the current code — it may be left over from an
earlier build that had a real toggle. **Do not hardcode either key name.**
Read whatever key is actually present with one named `localStorage.getItem`
call before relying on it (the query-string-data block above bans enumerating
all keys at once), and prefer the DOM-write/restore procedure above, which
works regardless of what is or is not in storage.

Observed token values (`--chakra-colors-status-error`): `#A82E16` light /
`#F17761` dark. Both the red left edge on the rejections panel and the clock
icon and muted sub-line on the queue panel stay clearly legible in light
mode.

## Other traps

- `components/dashboard/CodeHints.js` hides its snippets behind a language menu
  (**"jsPsych v8"** / **"JavaScript"**) and tabs (**"Save data"**, **"Save as
  you go"**, **"Save file"**, **"Conditions"**). Only the active tab is in the
  DOM.
- Renaming an experiment (`Title.js`) is icon-only: `aria-label="Rename
  experiment"`, then `aria-label="Save new name"` or `"Cancel renaming"`.
- The experiment list links to `/admin/<id>` from the title text, not a button.

## Timings measured on 2026-09-19 and 2026-09-20

Use these to size waits, not as assertions.

| | |
|---|---|
| jsPsych page, `auto=1` | 1.1–1.7 s per trial |
| Vanilla page, `auto=1` | 400 ms per trial |
| `POST /api/data` that writes to Drive | 2–4.5 s (OBSERVED 2026-09-20: one vanilla-page save at 4.79 s) |
| `POST /api/createexperiment` | 1.3 s |
| Warm `dashboardapi` calls | 190–370 ms |
| Refusals that never reach a provider | 270–480 ms |
| `dashboardapi` cold start, clean deploy | ~745 ms |
| `dashboardapi` cold start, click landed in the last 10 s of a deploy | **17.9 s** (OBSERVED 2026-09-20 — wait ~1 min after "Deploy to Test" completes) |
| Abandoned tab → queue entry | 10 min 25 s exactly (OBSERVED 2026-09-20; was estimated 10–12 min) |
| Queue entry (recovered partial) → first Drive attempt | `createdAt` + 60 min exactly |
| `METADATA_ERROR` refusal → its kept copy queued | 25 min 24 s (OBSERVED 2026-09-20, the next `:00`/`:15`/`:30`/`:45` slot; was estimated ~27 min) |
| That metadata-kept entry → its own first attempt | `createdAt` + **1 min** (not +60 like a recovered partial), so visible in the queue only ~5 min |
| `POST /api/clearerrors` round trip | **> 10.4 s, ≤ ~16 s** (OBSERVED 2026-09-20 — a slow round trip, not a broken button) |

`participantapi`'s genuinely-first call is made inside the page by the
extension and is not visible, so its cold start remains unmeasured.
