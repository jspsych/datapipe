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

The experiment ID is in the URL and beside the label **"Experiment ID"**
(`components/dashboard/ExperimentInfo.js`). There is no copy button anywhere in
the app.

## Switches — `components/dashboard/ExperimentActive.js`

All four live in the **"Data collection"** section of `/admin/<id>`, autosave on
toggle, and show a "Saved" flag (`role="status"`) on success. No confirmation.

| Switch | Used by |
|---|---|
| **"Accept new data"** | everything; `closed-experiment` turns it off |
| **"Accept base64 file uploads"** | the `base64-*` scenarios |
| **"Assign conditions in sequence"** | the `vanilla-condition*` scenarios |
| **"Stop after a set number of sessions"** | session-cap checks |

Turning conditions on reveals a number field **"How many conditions?"**
(minimum 2), which autosaves with its own "Saved" flag.

On failure the switch snaps back and shows a sentence beginning "Could not
change data collection…". If the experiment is finalized the switch is disabled
with "Locked because this experiment has been finalized…".

## Live sessions — `components/dashboard/LiveSessionsPanel.js`

The panel is **only rendered while at least one session is open**, so its
absence is the assertion for "the session closed", not a bug. Heading:
**"Sessions in progress"**. Columns: "Status", "Running for", "Started".

Exact status strings:

- **`In progress`** — connected.
- **`Connection lost — may resume`** — disconnected, inside the 10-minute grace.
- **`Stopped — being recovered`** — disconnected past the grace; the sweep will
  take it.

"Running for" renders as `under a minute`, `<n> min`, `<h> h <m> min` or
`<h> h`. Above 25 rows a footer reads "<n> more sessions are in progress and
not shown."

## Queue — `components/dashboard/QueuePanel.js`

Rendered only when something is queued. It is an alert containing a table, not
a modal. Row statuses: `pending` → **"Retrying"**, `processing` → **"Retrying
now"**, `failed` → **"Failed"**.

There is **no retry button** — retries are server-side. The only controls are
**"Download all as ZIP"**, a per-row icon button with
`aria-label="Download <filename>"`, and an accordion trigger **"Why did these
uploads fail?"** whose body is hidden until clicked.

The alert title is `<n> files could not be uploaded to your storage provider.`
when all have failed, or `<n> files did not upload to your storage provider.`
otherwise.

When the queue drains, a notice reads **"All queued uploads completed
successfully."** and **auto-hides after 8 seconds** — do not build an assertion
that depends on catching it.

## Errors — `components/dashboard/ErrorPanel.js`

Shows the recent rejections for the experiment, each carrying the
`api-messages.ts` code. Its body sits behind an accordion trigger reading
either **"Show what was rejected"** or **"Show the <N> most recent of
<total>"** — expand it before matching on codes.

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
folder also holds derived CSVs. With it off, everything is at the folder root.
Base64 uploads always go to the root.

## Other traps

- `components/dashboard/CodeHints.js` hides its snippets behind a language menu
  (**"jsPsych v8"** / **"JavaScript"**) and tabs (**"Save data"**, **"Save as
  you go"**, **"Save file"**, **"Conditions"**). Only the active tab is in the
  DOM.
- Renaming an experiment (`Title.js`) is icon-only: `aria-label="Rename
  experiment"`, then `aria-label="Save new name"` or `"Cancel renaming"`.
- The experiment list links to `/admin/<id>` from the title text, not a button.
