import { useEffect, useRef, useState } from "react";
import { Box, Accordion, Table, Text, Button } from "@chakra-ui/react";

import { auth } from "../../lib/firebase";
import { relativeErrorTime, visibleErrors } from "../../lib/error-panel";
import SectionPanel from "./SectionPanel";
import StatusIndicator from "../ui/StatusIndicator";
import FormErrorAlert from "../ui/FormErrorAlert";

// How many rows to render. `logs/{id}.errors` is now capped at 50 by
// write-log.ts (MAX_ERROR_ENTRIES), but the recent ones are still the only
// ones a researcher can act on, and documents written before the cap landed
// can hold thousands of entries that will not rotate out until fifty new ones
// arrive.
const MAX_ROWS = 20;

// Exported so the test asserts on the constant, not a copy of the sentence.
// "About half an hour": the recovery job takes pending copies older than 15
// minutes on a 15-minute slot, and the retry worker picks the entry up on its
// next 5-minute pass.
export const METADATA_KEPT_NOTE =
  "The raw data was kept. DataPipe stores it in your storage provider without " +
  "Psych-DS metadata, usually within about half an hour.";

/**
 * `time` on an error entry comes in two shapes and both are live at once:
 *
 *  - A Firestore Timestamp, on everything written since write-log.ts started
 *    storing a real one. Through the client SDK this arrives as a Timestamp
 *    instance with .toDate(); through anything that serialized it in between
 *    it can arrive as a plain `{seconds, nanoseconds}`.
 *  - A preformatted en-GB string, on entries that were already in the array.
 *    Those are displayed verbatim -- reparsing a formatted string to reformat
 *    it would be guesswork.
 *
 * Returns null rather than throwing on anything else, because a malformed
 * timestamp must not be the thing that white-screens the experiment page.
 */
function formatErrorTime(time) {
  if (typeof time === "string") return time;
  if (!time) return null;

  let date = null;
  if (typeof time.toDate === "function") {
    date = time.toDate();
  } else if (typeof time.seconds === "number") {
    date = new Date(time.seconds * 1000);
  } else if (time instanceof Date) {
    date = time;
  }
  if (!date || Number.isNaN(date.getTime())) return null;

  // Matches the format the old string entries were written in, so a table
  // holding both does not read as two different kinds of record.
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "long",
  }).format(date);
}

// Fire-and-forget-ISH: awaited by the button below, but nothing here writes
// to Firestore directly. Same Bearer/idToken shape as FinalizeControl.js's
// requestFinalize -- a human sentence is thrown on any non-2xx response
// rather than the server's raw body, because the only failure modes a
// researcher can hit here (offline, a dropped connection) have nothing to do
// with what functions/src/clear-errors.ts might say about them.
async function requestClearErrors(experimentId) {
  const user = auth.currentUser;
  const idToken = await user.getIdToken();
  const response = await fetch("/api/clearerrors", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ experimentID: experimentId }),
  });
  if (!response.ok) {
    throw new Error(
      "Could not clear this list -- it is unchanged. Check your connection and try again."
    );
  }
}

/**
 * ErrorPanel — the record of submissions the API rejected for this experiment.
 *
 * Three things were wrong with the ORIGINAL version, all of them frontend:
 *
 * 1. IT COULD WHITE-SCREEN THE PAGE. It called `errors.map(...)` with no
 *    guard, while `functions/src/write-log.ts` wrote `logError` (an
 *    increment) and the `errors` array in TWO SEPARATE, NON-ATOMIC `set`
 *    calls. Between those two writes -- or permanently, if the second one
 *    failed -- the document had `logError > 0` and no `errors` field, and the
 *    parent page renders this panel on `logError` alone. `undefined.map` then
 *    takes down the whole experiment page, including the integration code and
 *    the queued-upload recovery panel. The backend race is fixed (both are
 *    one transactional write now), but a document that reached the split
 *    state before the fix still exists, so every read below stays defensive:
 *    missing array, missing fields, non-object entries.
 *
 * 2. IT SHOWED MACHINE CODES. It rendered `error.error` -- literally the
 *    string "EXPERIMENT_NOT_FOUND" -- while `error.message` ("The experiment
 *    ID does not match an experiment") and `error.detail`, the two fields a
 *    human can act on, were discarded. DESIGN.md §6 sets the rule for
 *    FormErrorAlert ("a human message, never a raw Firebase code") and it
 *    applies just as much here. The code survives as fine print, because it is
 *    what a researcher pastes into a bug report.
 *
 * 3. IT COULD NOT BE CLEARED. `logError` is a counter nothing ever reset, so
 *    a single typo during piloting in January was still announcing "There
 *    was an error" in July -- a permanent alarm trains researchers to ignore
 *    the one indicator that matters. THIS IS NOW FIXED: the "Clear this
 *    list" button below calls `functions/src/clear-errors.ts`, a server
 *    route (firestore.rules grants clients `read`/`create` on `logs/{id}` but
 *    never `update`, so a client-side clear is not possible). It writes a
 *    watermark (`errorsClearedAt`/`logErrorCleared`), never the lifetime
 *    counters themselves -- see `lib/error-panel.js`'s `visibleErrors`, which
 *    is what turns that watermark into the count and rows rendered here.
 *    Clearing is non-destructive (the lifetime record survives, for support
 *    and for the operator's cross-experiment queries), which is why its
 *    button is neutral, not `brandRed`.
 *
 * Color: this used to be a filled `Alert.Root status="error"
 * colorPalette="brandRed" variant="subtle"` -- a permanently red block for a
 * record that, per point 3 above, could never age out or be dismissed. Two
 * problems followed from stacking "permanent" on top of "loud": a
 * still-relevant alarm and a six-month-old non-issue looked identical, and
 * DESIGN.md §5 reserves `brandRed` for IRREVERSIBLE DESTRUCTION (account/
 * experiment deletion) -- a log of past rejections is neither destructive nor,
 * now that it can be cleared, un-actionable. This renders instead as the same
 * quiet `SectionPanel` (`bg.panel`, 1px `border`) the sibling "DataPipe could
 * not check for queued uploads" notice uses in
 * pages/admin/[experiment_id].js, carrying red in exactly two places: the
 * `StatusIndicator`'s icon (`status.error`, DESIGN.md §1's brandRed alias,
 * 5.92:1 light / 4.86:1 dark) and a 3px `status.error` LEFT border -- an
 * accent, not a fill, so it reads as "this needs attention" without
 * shouting it, in either mode, and without a single red background or red
 * body-text pixel anywhere in the panel.
 *
 * @param {Array<object>|undefined} errors - The `logs/{id}.errors` array, now
 *   capped at the 50 most recent by the backend. Tolerates undefined, null,
 *   empty, and malformed entries.
 * @param {number|undefined} totalCount - `logs/{id}.logError`, the lifetime
 *   count. Combined with `logErrorCleared` (below) by `visibleErrors` to get
 *   the count SINCE THE LAST CLEAR, which is what the headline reports.
 * @param {number|undefined} logErrorCleared - `logs/{id}.logErrorCleared`,
 *   the value `logError` held the moment of the last clear. Absent if the
 *   list has never been cleared.
 * @param {*} [errorsClearedAt] - `logs/{id}.errorsClearedAt`, a
 *   Timestamp-shaped value. Absent if the list has never been cleared.
 * @param {string} experimentId - Passed to `/api/clearerrors` when "Clear
 *   this list" is clicked.
 */
export default function ErrorPanel({
  errors,
  totalCount,
  logErrorCleared,
  errorsClearedAt,
  experimentId,
}) {
  const { count, rows } = visibleErrors({
    errors,
    logError: totalCount,
    logErrorCleared,
    errorsClearedAt,
  });

  const [clearing, setClearing] = useState(false);
  const [clearErrorMsg, setClearErrorMsg] = useState("");

  // Guards a setState after the researcher navigates away, or after a
  // successful clear has already made the parent's Firestore listener
  // unmount this panel, mid-request.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The guard that stops the non-atomic backend write from white-screening
  // the page, now expressed in terms of the count SINCE THE LAST CLEAR
  // rather than the raw array: `count === 0` covers both "nothing was ever
  // rejected" and "everything that was rejected has since been cleared",
  // and there is no information to show in either case.
  if (count === 0) return null;

  // Entries are appended, so the tail of `rows` is the most recent (the
  // array is not re-sorted by `time`: entries written before the Timestamp
  // change carry a formatted string instead, and a mixed-type sort would
  // scramble the order that insertion already gets right).
  const recent = rows.slice(-MAX_ROWS).reverse();
  const mostRecent = rows[rows.length - 1];

  async function handleClear() {
    setClearing(true);
    setClearErrorMsg("");
    try {
      await requestClearErrors(experimentId);
      // No success handling here on purpose: the parent page's Firestore
      // listener on logs/{id} will pick up errorsClearedAt/logErrorCleared
      // and this component will stop rendering (count becomes 0) on its own.
    } catch (err) {
      if (mounted.current) {
        setClearErrorMsg(
          err instanceof Error && err.message
            ? err.message
            : "Could not clear this list -- it is unchanged. Check your connection and try again."
        );
      }
    } finally {
      if (mounted.current) setClearing(false);
    }
  }

  // The body sentence. "When there is no usable time: just the first
  // sentence" covers both `!mostRecent` (count > 0 but every visible row was
  // filtered out -- possible because `errors` is capped at 50 and because
  // string-time rows are hidden once a clear has happened) and a real
  // timestamp that fails to parse.
  let recentPhrase = null;
  if (mostRecent) {
    if (typeof mostRecent.time === "string") {
      recentPhrase = <>The most recent was on {mostRecent.time}.</>;
    } else {
      const relative = relativeErrorTime(mostRecent.time);
      if (relative) {
        const absolute = formatErrorTime(mostRecent.time);
        recentPhrase = (
          <>
            The most recent was{" "}
            {/* `title` here is supplementary detail (the exact timestamp),
                not a status signal, so DESIGN.md §5's "status is never...
                behind a tooltip" rule does not apply -- the relative phrase
                itself is already the always-visible text. */}
            <Box as="span" title={absolute || undefined}>
              {relative}
            </Box>
            .
          </>
        );
      }
    }
  }

  return (
    <SectionPanel borderLeftWidth="3px" borderLeftColor="status.error">
      <StatusIndicator
        status="error"
        label={
          count === 1
            ? "One submission to this experiment was rejected."
            : `${count} submissions to this experiment were rejected.`
        }
      />
      <Text fontSize="sm" color="fg.muted" mt={2} mb={4}>
        DataPipe refused these submissions.
        {recentPhrase && <> {recentPhrase}</>}
      </Text>

      {/* `rows` can be empty with `count > 0` (the 50-entry cap, or every
          visible row being a legacy string-time entry hidden by a clear) --
          the headline above still has to be honest, but there is nothing to
          put in a table. */}
      {rows.length > 0 && (
        <Accordion.Root collapsible>
          <Accordion.Item value="error-logs">
            <Accordion.ItemTrigger>
              <Box as="span" flex="1" textAlign="left" fontSize="sm">
                {count > MAX_ROWS
                  ? `Show the ${MAX_ROWS} most recent of ${count}`
                  : "Show what was rejected"}
              </Box>
              <Accordion.ItemIndicator />
            </Accordion.ItemTrigger>
            <Accordion.ItemContent pb={4}>
              {/* No border/bg of its own -- SectionPanel already supplies
                  both, and repeating them here read as a box inside a box. */}
              <Box overflowX="auto">
                <Table.Root variant="line" size="sm">
                  <Table.Header>
                    <Table.Row>
                      {/* Sentence case per DESIGN.md §3; these were `ERROR`
                          and `TIME`. */}
                      <Table.ColumnHeader>What happened</Table.ColumnHeader>
                      {/* nowrap: at normal widths "19/09/2026, 18:33:48
                          GMT-4" was dropping "GMT-4" onto a second line. The
                          "What happened" column has prose room to spare and
                          absorbs the flex this gives up. */}
                      <Table.ColumnHeader whiteSpace="nowrap">Time</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {recent.map((error, index) => (
                      <Table.Row key={`${error?.time ?? "t"}-${index}`}>
                        <Table.Cell>
                          {/* Human sentence first. `message` is written by
                              functions/src/api-messages.ts and is already
                              plain English; `detail` carries the specifics.
                              The machine code is last and small -- useful in
                              a bug report, useless as a headline. */}
                          <Text fontSize="sm" color="fg">
                            {error?.message ||
                              error?.detail ||
                              "This submission was rejected, but DataPipe did not record why."}
                          </Text>
                          {error?.detail && error?.message && (
                            <Text fontSize="sm" color="fg.muted" mt={2}>
                              {error.detail}
                            </Text>
                          )}
                          {/* The one refusal that does NOT lose the data.
                              api-data.ts deliberately keeps the pending copy
                              when the metadata step fails, and
                              scheduled-pending-recovery.ts stores it later
                              without Psych-DS files. Said here, per row,
                              because the panel's own sentence ("refused")
                              would otherwise send a researcher looking for
                              data that is in fact on its way. */}
                          {error?.error === "METADATA_ERROR" && (
                            <Text fontSize="sm" color="fg.muted" mt={2}>
                              {METADATA_KEPT_NOTE}
                            </Text>
                          )}
                          {error?.error && (
                            <Text fontSize="xs" color="fg.muted" mt={2}>
                              Code: {error.error}
                            </Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                            {formatErrorTime(error?.time) || "—"}
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Box>
            </Accordion.ItemContent>
          </Accordion.Item>
        </Accordion.Root>
      )}

      <Button
        size="sm"
        variant="outline"
        colorPalette="gray"
        loading={clearing}
        disabled={clearing}
        onClick={handleClear}
        mt={4}
      >
        Clear this list
      </Button>
      {clearErrorMsg && <FormErrorAlert mt={2}>{clearErrorMsg}</FormErrorAlert>}
    </SectionPanel>
  );
}

export { formatErrorTime };
