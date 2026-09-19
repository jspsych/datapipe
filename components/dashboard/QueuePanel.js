import { useState } from "react";
import {
  Box,
  Accordion,
  Alert,
  Table,
  IconButton,
  Button,
  Text,
  HStack,
} from "@chakra-ui/react";
import { Download } from "lucide-react";
import { auth } from "../../lib/firebase";
import {
  queueEntryKind,
  summarizeQueue,
  queueToneStatus,
  friendlyReason,
  timeRemaining,
} from "../../lib/upload-queue";
import StatusIndicator from "../ui/StatusIndicator";
import FormErrorAlert from "../ui/FormErrorAlert";
import SectionPanel from "./SectionPanel";

// Status rendering, rebuilt on StatusIndicator.
//
// What was here before was the single worst contrast failure in the app. The
// panel painted itself `Alert variant="solid"`, which fills the root with
// `colorPalette.solid`; each row then rendered a `Badge variant="solid"` in
// the SAME palette. Status warning -> orange.600 badge on an orange.600
// panel: 1.00:1. Literally invisible. StatusIndicator is icon + always-
// visible text on `status.*` tokens, which satisfies DESIGN.md §5's "status
// is never color-alone".
//
// A SECOND thing was wrong, fixed separately (see lib/upload-queue.js's
// header): the panel only ever knew "pending" (badged "Retrying") or
// "failed". A pending/processing entry that DataPipe has never actually
// tried to upload -- a recovered partial, a raw file kept after a metadata
// failure, an upload held for compaction or a cold collision cache -- was
// badged "Retrying" identically to one that had already failed and come back
// for another attempt, and the panel told the researcher a file "did not
// upload" that DataPipe had never tried to upload. `queueEntryKind` below
// tells "waiting" (held, unattempted) apart from "retrying" (attempted,
// failed, coming back around), and this function renders each kind
// distinctly rather than reusing the same badge for both.
// `nowrap` keeps each short label on one line -- at the table's usual width
// "Waiting to be stored" was breaking onto two lines while the Reason column
// beside it, which is prose, had the room to absorb a wrap instead.
function rowStatusIndicator(kind, entry) {
  if (kind === "failed") {
    return <StatusIndicator status="error" label="Failed" nowrap />;
  }
  if (kind === "retrying") {
    return (
      <StatusIndicator
        status="warning"
        label={entry.status === "processing" ? "Retrying now" : "Retrying"}
        nowrap
      />
    );
  }
  // kind === "waiting"
  return (
    <StatusIndicator
      status="waiting"
      label={entry.status === "processing" ? "Storing now" : "Waiting to be stored"}
      nowrap
    />
  );
}

function nextRetryText(nextRetryAt) {
  if (!nextRetryAt) return null;
  const t = nextRetryAt.toDate ? nextRetryAt.toDate() : new Date(nextRetryAt);
  const msUntil = t.getTime() - Date.now();
  // The retry worker runs on a flat */5 cron (functions/src/scheduled-sweep.ts),
  // ungated -- see scheduled-sweep-core.ts's jobsDueAt, which gives upload
  // retry the full 5-minute cadence every other gated job is a multiple of.
  // A `nextRetryAt` already in the past just means the next tick hasn't run
  // yet, so "within 5 minutes" is the honest bound, not "soon" (which read as
  // indefinite next to a sibling row's concrete "in 37m").
  if (msUntil <= 0) return "within 5 minutes";
  const minUntil = Math.ceil(msUntil / (60 * 1000));
  if (minUntil >= 60) {
    const hours = Math.floor(minUntil / 60);
    const mins = minUntil % 60;
    return `in ${hours}h${mins > 0 ? ` ${mins}m` : ""}`;
  }
  return `in ${minUntil}m`;
}

// A "waiting" row's nextRetryAt is when DataPipe will make its FIRST attempt,
// not a retry -- "Next retry in 57m" on a file that has never been tried
// reads as a failure that already happened. Same underlying field, different
// sentence per kind.
//
// `ms={6}` (1.5rem = 24px) lines this up under StatusIndicator's LABEL, not
// its icon: icon size 16 + the icon/label `gap={2}` (0.5rem = 8px) = 24px,
// both theme spacing tokens rather than a measured pixel offset. If
// StatusIndicator's default icon size or gap ever changes, this drifts with
// it and needs a matching update.
function rowSubline(kind, entry) {
  if (kind === "failed") return null;
  if (!(entry.status === "pending" || entry.status === "processing")) return null;
  const text = nextRetryText(entry.nextRetryAt);
  if (!text) return null;
  return (
    <Text fontSize="xs" color="fg.muted" mt={2} ms={6}>
      {kind === "waiting" ? "First attempt" : "Next retry"} {text}
    </Text>
  );
}

// A metadata-active experiment's queue entries carry the storage path
// (`data/raw/<name>`, see functions/src/metadata-derived-files.ts's
// uploadPathFor), not just the original filename -- that prefix is provider
// layout, not something the researcher who submitted this file chose or
// needs to see. The Filename column and the saved download both show only
// the part after the last slash; the full value is still what gets sent to
// the download endpoint and what appears in the `title` attribute for anyone
// who needs to confirm the exact path.
function basename(filename) {
  const idx = filename?.lastIndexOf("/") ?? -1;
  return idx === -1 ? filename : filename.slice(idx + 1);
}

async function fetchFile(experimentId, entryId) {
  const user = auth.currentUser;
  if (!user) return;
  const idToken = await user.getIdToken();
  return fetch(
    `/api/queuestatus?experimentID=${experimentId}&download=${entryId}`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );
}

const plural = (n, word) => `${n} ${word}${n !== 1 ? "s" : ""}`;

// The four headline/body cases. `failed`/`retrying`/`waiting` are
// summarizeQueue's counts. Kept as one function (rather than four call
// sites) so the "is/are" agreement rules live in exactly one place.
function summaryText({ failed, retrying, waiting }) {
  if (failed > 0 && retrying === 0 && waiting === 0) {
    return {
      title: `${plural(failed, "file")} could not be uploaded to your storage provider.`,
      description:
        "All retries were exhausted. Download these files and upload them to your storage provider manually to prevent data loss.",
    };
  }

  if (failed > 0) {
    const more = retrying + waiting;
    return {
      title: `${plural(failed, "file")} could not be uploaded to your storage provider.`,
      description:
        "All retries were exhausted for these. Download them and upload them to your storage provider manually to prevent data loss. " +
        `${more} more file${more !== 1 ? "s" : ""} ${more === 1 ? "is" : "are"} still being stored automatically.`,
    };
  }

  if (retrying > 0) {
    let description = "DataPipe is retrying automatically.";
    if (waiting > 0) {
      description += ` ${waiting} more file${waiting !== 1 ? "s" : ""} ${waiting === 1 ? "is" : "are"} waiting to be stored.`;
    }
    description += " You can also download the files now.";
    return {
      title: `${plural(retrying, "upload")} did not go through on the first try.`,
      description,
    };
  }

  // Only waiting entries.
  return {
    title:
      waiting === 1
        ? "One file is waiting to be stored."
        : `${waiting} files are waiting to be stored.`,
    description:
      "DataPipe is storing these automatically; nothing has failed. You can download them now if you need them sooner.",
  };
}

/**
 * QueuePanel — shows every queued upload (waiting + retrying + failed) with
 * immediate download access. Waiting and retrying items are handled by
 * DataPipe automatically, but the researcher can download any of them right
 * away without waiting.
 *
 * THREE VISUAL TREATMENTS, one shared body (title/description/accordion/
 * download button/table), chosen by `summarizeQueue(entries).tone`:
 *
 *  - "error" (any permanent failure) keeps the strong, filled
 *    `Alert.Root status="error" colorPalette="brandRed" variant="subtle"`
 *    treatment this panel has always used. Deliberately not softened: a
 *    permanently failed entry is the one state on this panel with an actual
 *    data-loss deadline (the Cloud Storage payload is deleted 7-14 days after
 *    createdAt), and it is the only one that needs a researcher to act.
 *  - "warning" (retrying, nothing failed) gets the quiet treatment
 *    ErrorPanel.js now uses: `SectionPanel` with a 3px `status.warning` left
 *    border, the headline as a `StatusIndicator`, body copy in muted `sm`
 *    text. Retries are normal, self-healing operation, not an alarm.
 *  - "neutral" (only held/unattempted entries) is the same `SectionPanel`
 *    with no coloured edge at all -- nothing here has failed or even been
 *    attempted yet, so there is nothing to accent.
 *
 * The table drops its own bg/border box inside the two quiet variants, the
 * same call ErrorPanel.js made for its accordion table: a box inside a box
 * inside a bordered panel reads as visual noise, and SectionPanel already
 * supplies the outer edge.
 */
export default function QueuePanel({ entries, experimentId }) {
  const [downloading, setDownloading] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  // Four download paths used to end in `console.error` with NOTHING rendered:
  // the spinner stopped and the page looked exactly as it had before. These
  // buttons serve the last remaining copy of a participant's data before the
  // 7-day expiry, so a researcher who clicks, sees no change, and concludes
  // "that must have downloaded already" loses the file permanently. This is
  // the failure mode DESIGN.md §8.7 bans and the one PRODUCT.md Principle 5
  // singles out. One message at a time is deliberate -- the researcher is
  // acting on one file.
  const [downloadError, setDownloadError] = useState(null);

  const handleDownload = async (entry) => {
    setDownloading(entry.id);
    setDownloadError(null);
    try {
      const response = await fetchFile(experimentId, entry.id);
      if (!response || !response.ok) {
        throw new Error(`Download responded ${response?.status ?? "no response"}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // `a.download` is a suggested filename, not a path -- a browser either
      // strips or mangles the "/" in a metadata-active entry's stored path
      // (`data/raw/<name>`) rather than creating folders, so the full value
      // bought nothing but an odd-looking save-as name. The blob/object-URL
      // download this function does never sends the server's own
      // Content-Disposition header (functions/src/api-queue-status.ts sets
      // one, but it is unused here) -- this attribute is the only thing that
      // names the saved file, so it is what has to carry the basename.
      a.download = basename(entry.filename);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
      const stored = timeRemaining(entry, Date.now());
      setDownloadError(
        `Could not download ${entry.filename}. DataPipe still has this file` +
          (stored ? ` for another ${stored}` : "") +
          " -- try again, and contact support if it keeps failing."
      );
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    setDownloadError(null);
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("Not signed in");
      }
      const idToken = await user.getIdToken();
      const response = await fetch(
        `/api/queuestatus?experimentID=${experimentId}&downloadAll=true`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      if (!response.ok) {
        throw new Error(`Download-all responded ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${experimentId}-queued-files.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download all failed:", e);
      setDownloadError(
        "Could not build the ZIP of queued files. Nothing has been lost -- " +
          "try again, or download the files one at a time using the buttons " +
          "in the table below."
      );
    } finally {
      setDownloadingAll(false);
    }
  };

  const summary = summarizeQueue(entries);
  const { title, description } = summaryText(summary);
  const quiet = summary.tone !== "error";

  const downloadErrorBlock = downloadError && (
    <Box mb={4}>
      <FormErrorAlert>{downloadError}</FormErrorAlert>
    </Box>
  );

  const accordion = (
    <Accordion.Root collapsible size="sm" mb={4}>
      <Accordion.Item value="what-is-happening">
        <Accordion.ItemTrigger>
          <Box as="span" flex="1" textAlign="left" fontSize="sm">
            What is happening to these files?
          </Box>
          <Accordion.ItemIndicator />
        </Accordion.ItemTrigger>
        <Accordion.ItemContent>
          <Text fontSize="sm" pb={3}>
            DataPipe tries to store each submission in your storage provider
            the moment it arrives. A file is listed here when that has not
            happened yet.
          </Text>
          <Box as="ul" fontSize="sm" pl={6} pb={3} listStyleType="disc">
            <Box as="li" mb={2}>
              <strong>Waiting to be stored</strong> — DataPipe recovered the
              data from a session that did not finish, or kept the raw file
              after a processing problem, and has not tried to store it yet.
              Nothing has failed.
            </Box>
            <Box as="li" mb={2}>
              <strong>Retrying</strong> — An attempt failed, usually because
              your storage provider was busy or unavailable, or because
              DataPipe&apos;s connection to it needs refreshing. DataPipe
              tries again automatically.
            </Box>
            <Box as="li" mb={2}>
              <strong>Failed</strong> — Every retry was used up. Download the
              file and upload it to your storage provider yourself.
            </Box>
          </Box>
          <Text fontSize="sm" pb={3}>
            Files are stored for seven days, or up to fourteen if we
            couldn&apos;t deliver a failure notification to you.
          </Text>
        </Accordion.ItemContent>
      </Accordion.Item>
    </Accordion.Root>
  );

  // Right-aligned and pulled in close to the table (`mb={3}`, DESIGN.md §4's
  // within-a-row rhythm) rather than sharing the accordion's `mb={4}`
  // breathing room above it -- this button acts on the table's rows, not on
  // the accordion, and used to read as the accordion's own trailing content
  // because it sat at the same left edge with the same gap on both sides.
  const downloadAllButton = (
    <HStack w="100%" justifyContent="flex-end" mb={3}>
      {/* Was `variant="solid" colorPalette="gray"`, which put gray.200 on
          the old orange.600 fill at 2.81:1 -- under the 3:1 floor WCAG
          1.4.11 sets for a control's boundary. Outline on the panel's own
          ground uses border gray.500 (4.50:1 light / 3.43:1 dark). It is
          also correctly secondary: DESIGN.md §5 allows one primary per
          screen, and on the experiment page that is not this button. */}
      <Button
        size="sm"
        variant="outline"
        colorPalette="gray"
        loading={downloadingAll}
        onClick={handleDownloadAll}
      >
        <Download size={14} />
        Download all as ZIP
      </Button>
    </HStack>
  );

  const table = (
    <Table.Root variant="line" size="sm">
      <Table.Header>
        <Table.Row>
          {/* Sentence case, per DESIGN.md §3. The uppercase literals
              here were the table-header instance of the same reflex
              §8.1 bans for section eyebrows. */}
          <Table.ColumnHeader>Filename</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          {/* No `whiteSpace="nowrap"` here: this is the one column that is
              prose (the provider-error explanation), so it is the column
              that absorbs the row's horizontal space and wraps instead of
              the short Filename/Status/Kept-for-another columns around it. */}
          <Table.ColumnHeader>Reason</Table.ColumnHeader>
          <Table.ColumnHeader whiteSpace="nowrap">Kept for another</Table.ColumnHeader>
          <Table.ColumnHeader>
            <Box as="span" srOnly>
              Download
            </Box>
          </Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {entries.map((entry) => {
          const kind = queueEntryKind(entry);
          return (
            <Table.Row key={entry.id}>
              <Table.Cell title={entry.filename} wordBreak="break-all">
                {basename(entry.filename)}
              </Table.Cell>
              <Table.Cell>
                {rowStatusIndicator(kind, entry)}
                {rowSubline(kind, entry)}
              </Table.Cell>
              <Table.Cell>
                <Text fontSize="sm" color="fg">
                  {friendlyReason(entry) || "—"}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <Text fontSize="sm" color="fg.muted" whiteSpace="nowrap">
                  {timeRemaining(entry, Date.now()) || "—"}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <IconButton
                  aria-label={`Download ${entry.filename}`}
                  size="xs"
                  variant="ghost"
                  loading={downloading === entry.id}
                  onClick={() => handleDownload(entry)}
                >
                  <Download size={14} />
                </IconButton>
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table.Root>
  );

  // The table gets its own panel surface and border so it reads as a table
  // rather than a stripe of paint inside the surrounding container, and
  // scrolls horizontally instead of overflowing on a phone -- UNLESS the
  // surrounding container is already one of the quiet SectionPanel variants,
  // in which case that box-inside-a-box is dropped (ErrorPanel.js made the
  // same call for its own table).
  const tableBlock = quiet ? (
    <Box overflowX="auto">{table}</Box>
  ) : (
    <Box
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      overflowX="auto"
      color="fg"
    >
      {table}
    </Box>
  );

  if (summary.tone === "error") {
    return (
      // `variant="subtle"` instead of `solid`, and the palette named
      // explicitly as `brandRed` rather than left to Chakra's stock red.
      // DESIGN.md §5 reserves brandRed for irreversible destruction
      // elsewhere in the app, but a permanently failed upload is the one
      // queue state with a genuine, un-appealable deadline (the payload is
      // deleted 7-14 days after createdAt) -- the loud treatment stays here
      // on purpose. Subtle pairs colorPalette.subtle with colorPalette.fg:
      // brandRed 700-on-50 = 5.92:1 light, 300-on-900 = 4.86:1 dark.
      <Alert.Root status="error" colorPalette="brandRed" variant="subtle" role="alert">
        <Alert.Indicator />
        <Box flex="1" minW={0}>
          <Alert.Title mb={2}>{title}</Alert.Title>
          <Text fontSize="sm" mb={4}>
            {description}
          </Text>
          {downloadErrorBlock}
          {accordion}
          {downloadAllButton}
          {tableBlock}
        </Box>
      </Alert.Root>
    );
  }

  return (
    <SectionPanel
      {...(summary.tone === "warning"
        ? { borderLeftWidth: "3px", borderLeftColor: "status.warning" }
        : {})}
    >
      <StatusIndicator status={queueToneStatus(summary.tone)} label={title} />
      <Text fontSize="sm" color="fg.muted" mt={2} mb={4}>
        {description}
      </Text>
      {downloadErrorBlock}
      {accordion}
      {downloadAllButton}
      {tableBlock}
    </SectionPanel>
  );
}

/**
 * UploadsResolvedNotice — brief success confirmation shown when
 * previously pending/failed uploads have all been resolved.
 */
export function UploadsResolvedNotice() {
  // Not an `Alert status="success"`: that resolves to Chakra's stock `green`
  // palette, which is the second green DESIGN.md §1 retires, and switching it
  // to brandGreen is not available either -- the caveat in §1 is that
  // `variant="subtle"` paints brandGreen.fg on brandGreen.subtle, and in dark
  // mode that pairing is 300-on-900 = 3.91:1, below the body floor, with
  // nothing darker on the Material Green ramp to fix it with. So this uses
  // the neutral panel surface with a StatusIndicator, whose icon rides
  // `status.ok` (4.77:1 light / 6.71:1 dark) and whose label is `fg`
  // (13.16 / 12.94). Icon plus visible text, per DESIGN.md §5.
  return (
    <Box
      w="100%"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      px={4}
      py={4}
      role="status"
      aria-live="polite"
    >
      <StatusIndicator
        status="ok"
        label="All queued uploads completed successfully."
      />
    </Box>
  );
}
