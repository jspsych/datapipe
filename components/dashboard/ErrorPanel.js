import { Box, Accordion, Alert, Table, Text } from "@chakra-ui/react";

// How many rows to render. `logs/{id}.errors` grows by `arrayUnion` and is
// never trimmed, so a broken integration during piloting can produce thousands
// of entries -- which this component used to render, all of them, unpaginated.
// The recent ones are the only ones a researcher can act on.
const MAX_ROWS = 20;

/**
 * ErrorPanel — the record of submissions the API rejected for this experiment.
 *
 * Three things were wrong with the previous version, all of them frontend:
 *
 * 1. IT COULD WHITE-SCREEN THE PAGE. It called `errors.map(...)` with no
 *    guard, while `functions/src/write-log.ts` writes `logError` (an
 *    increment) and the `errors` array in TWO SEPARATE, NON-ATOMIC `set`
 *    calls. Between those two writes -- or permanently, if the second one
 *    fails -- the document has `logError > 0` and no `errors` field, and the
 *    parent page renders this panel on `logError` alone. `undefined.map` then
 *    takes down the whole experiment page, including the integration code and
 *    the queued-upload recovery panel. The backend race is real and is filed
 *    separately; this component simply must not be the thing that breaks when
 *    it happens. Every read below is defensive: missing array, missing fields,
 *    non-object entries.
 *
 * 2. IT SHOWED MACHINE CODES. It rendered `error.error` -- literally the
 *    string "EXPERIMENT_NOT_FOUND" -- while `error.message` ("The experiment
 *    ID does not match an experiment") and `error.detail`, the two fields a
 *    human can act on, were discarded. DESIGN.md §6 sets the rule for
 *    FormErrorAlert ("a human message, never a raw Firebase code") and it
 *    applies just as much here. The code survives as fine print, because it is
 *    what a researcher pastes into a bug report.
 *
 * 3. IT COULD NOT BE DISMISSED OR AGED OUT. `logError` is a counter that
 *    nothing ever resets, so a single typo during piloting in January is still
 *    announcing "There was an error in data upload" in July. A permanent red
 *    banner is a cry-wolf signal that trains researchers to ignore the one
 *    indicator that matters. Without a backend change the honest fix is
 *    temporal framing: the heading says these were *recorded*, past tense, and
 *    the time of the most recent one is stated on the face of the panel, so an
 *    old resolved problem cannot pass itself off as a live one.
 *
 * Color: `variant="subtle"` on `brandRed` rather than `variant="solid"` on
 * Chakra's stock red. Subtle pairs brandRed.subtle with brandRed.fg -- 50 with
 * 700 in light, 900 with 300 in dark -- both clearing the 4.5:1 body floor,
 * where the solid fill put `sm` and `xs` body text on a saturated red at
 * roughly 3.5:1. brandRed is also DESIGN.md §5's irreversible-destruction hue,
 * which fits: these are submissions that were refused and are not coming back.
 *
 * @param {Array<object>|undefined} errors - The `logs/{id}.errors` array.
 *   Tolerates undefined, null, empty, and malformed entries.
 */
export default function ErrorPanel({ errors }) {
  // The guard that stops the non-atomic backend write from white-screening
  // the page. `logError > 0` with no `errors` array is a state the backend
  // can genuinely produce, and the honest render for it is nothing at all --
  // there is no information here to show.
  const all = Array.isArray(errors) ? errors.filter(Boolean) : [];
  if (all.length === 0) return null;

  // arrayUnion appends, so the tail is the most recent. `time` is written as
  // a preformatted en-GB string by write-log.ts, not a Timestamp, so it is
  // displayed rather than parsed -- reordering by it would be guesswork.
  const recent = all.slice(-MAX_ROWS).reverse();
  const latest = recent[0];
  const latestTime = typeof latest?.time === "string" ? latest.time : null;

  return (
    <Alert.Root status="error" colorPalette="brandRed" variant="subtle">
      <Alert.Indicator />
      <Box flex="1" minW={0}>
        <Alert.Title mb={1}>
          {all.length === 1
            ? "One submission to this experiment was rejected."
            : `${all.length} submissions to this experiment were rejected.`}
        </Alert.Title>
        <Text fontSize="sm" mb={4}>
          {latestTime
            ? `These submissions did not reach your storage provider. The most recent was ${latestTime}. If you have since fixed the problem, this list will not clear on its own -- it is a running record, not a live alarm.`
            : "These submissions did not reach your storage provider. This is a running record of past rejections, not a live alarm -- it does not clear on its own."}
        </Text>
        <Accordion.Root collapsible>
          <Accordion.Item value="error-logs">
            <Accordion.ItemTrigger>
              <Box as="span" flex="1" textAlign="left" fontSize="sm">
                {all.length > MAX_ROWS
                  ? `Show the ${MAX_ROWS} most recent of ${all.length}`
                  : "Show what was rejected"}
              </Box>
              <Accordion.ItemIndicator />
            </Accordion.ItemTrigger>
            <Accordion.ItemContent pb={4}>
              <Box
                bg="bg.panel"
                color="fg"
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                overflowX="auto"
              >
                <Table.Root variant="line" size="sm">
                  <Table.Header>
                    <Table.Row>
                      {/* Sentence case per DESIGN.md §3; these were `ERROR`
                          and `TIME`. */}
                      <Table.ColumnHeader>What happened</Table.ColumnHeader>
                      <Table.ColumnHeader>Time</Table.ColumnHeader>
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
                            <Text fontSize="sm" color="fg.muted" mt={1}>
                              {error.detail}
                            </Text>
                          )}
                          {error?.error && (
                            <Text fontSize="xs" color="fg.muted" mt={1}>
                              Code: {error.error}
                            </Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <Text fontSize="xs" color="fg.muted">
                            {error?.time || "—"}
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
      </Box>
    </Alert.Root>
  );
}
