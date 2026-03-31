import { useState } from "react";
import {
  Box,
  Accordion,
  Alert,
  Table,
  Badge,
  IconButton,
  Button,
  Text,
  HStack,
} from "@chakra-ui/react";
import { Download } from "lucide-react";
import { auth } from "../../lib/firebase";

function friendlyReason(reason) {
  if (!reason) return null;
  if (reason.includes("interrupted upload") || reason.includes("memory limit")) {
    return "Upload was interrupted by a server restart or memory limit. Data was automatically recovered.";
  }
  if (reason.includes("Upload exception") || reason.includes("fetch failed")) {
    return "Could not connect to OSF. This is usually temporary.";
  }
  if (reason.includes("OSF error 503") || reason.includes("OSF error 502")) {
    return "OSF is temporarily unavailable.";
  }
  if (reason.includes("OSF error 429")) {
    return "OSF is rate-limiting requests. Retries are spaced out automatically.";
  }
  if (reason.includes("OSF error 401") || reason.includes("OSF error 403")) {
    return "Authentication error. Your OSF token may need to be refreshed.";
  }
  return reason;
}

function timeRemaining(createdAt) {
  if (!createdAt) return null;
  const created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
  const expiresAt = created.getTime() + 7 * 24 * 60 * 60 * 1000;
  const msLeft = expiresAt - Date.now();
  if (msLeft <= 0) return "expiring soon";
  const hoursLeft = Math.floor(msLeft / (60 * 60 * 1000));
  if (hoursLeft >= 24) {
    const days = Math.floor(hoursLeft / 24);
    return `${days}d ${hoursLeft % 24}h remaining`;
  }
  return `${hoursLeft}h remaining`;
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

/**
 * FailedUploadsPanel — shown only when uploads have exhausted all retries
 * and the researcher needs to download the data manually.
 */
export function FailedUploadsPanel({ entries, experimentId }) {
  const [downloading, setDownloading] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const handleDownload = async (entry) => {
    setDownloading(entry.id);
    try {
      const response = await fetchFile(experimentId, entry.id);
      if (!response || !response.ok) {
        console.error("Failed to download file");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const idToken = await user.getIdToken();
      const response = await fetch(
        `/api/queuestatus?experimentID=${experimentId}&downloadAll=true`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      if (!response.ok) {
        console.error("Failed to download ZIP");
        return;
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
    } finally {
      setDownloadingAll(false);
    }
  };

  const plural = (n, word) => `${n} ${word}${n !== 1 ? "s" : ""}`;

  return (
    <Alert.Root status="error" variant="solid">
      <Alert.Indicator />
      <Box flex="1">
        <Alert.Title mb={1}>
          {plural(entries.length, "file")} could not be uploaded to OSF.
        </Alert.Title>
        <Text fontSize="sm" mb={4}>
          These files could not be delivered after multiple attempts. Download
          them below to avoid data loss, then upload them to your OSF project
          manually.
        </Text>
        <Accordion.Root collapsible size="sm" mb={4}>
          <Accordion.Item value="why">
            <Accordion.ItemTrigger>
              <Box as="span" flex="1" textAlign="left" fontSize="sm">
                Why did these uploads fail?
              </Box>
              <Accordion.ItemIndicator />
            </Accordion.ItemTrigger>
            <Accordion.ItemContent>
              <Text fontSize="sm" pb={3}>
                When a participant submits data, DataPipe tries to upload it to
                your OSF project immediately. If that fails, it retries
                automatically over the next several days. Common reasons include:
              </Text>
              <Box as="ul" fontSize="sm" pl={5} pb={3} listStyleType="disc">
                <Box as="li" mb={1}>
                  <strong>Server memory limit</strong> — Large data submissions
                  can occasionally exceed the server&apos;s memory capacity.
                </Box>
                <Box as="li" mb={1}>
                  <strong>OSF unavailable</strong> — OSF may be temporarily
                  down or rate-limiting requests.
                </Box>
                <Box as="li" mb={1}>
                  <strong>Configuration issue</strong> — There may be a problem
                  with your OSF project settings or authentication token.
                </Box>
              </Box>
              <Text fontSize="sm" pb={3}>
                These files exhausted all retry attempts. Download them and
                upload to OSF manually to avoid data loss.
              </Text>
            </Accordion.ItemContent>
          </Accordion.Item>
        </Accordion.Root>
        <HStack mb={4}>
          <Button
            size="sm"
            variant="solid"
            colorPalette="gray"
            loading={downloadingAll}
            onClick={handleDownloadAll}
          >
            <Download size={14} />
            Download all as ZIP
          </Button>
        </HStack>
        <Accordion.Root collapsible defaultValue={["queue-list"]}>
          <Accordion.Item value="queue-list">
            <Accordion.ItemTrigger>
              <Box as="span" flex="1" textAlign="left">
                View file details
              </Box>
              <Accordion.ItemIndicator />
            </Accordion.ItemTrigger>
            <Accordion.ItemContent pb={4}>
              <Table.Root variant="line" size="sm">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>FILENAME</Table.ColumnHeader>
                    <Table.ColumnHeader>REASON</Table.ColumnHeader>
                    <Table.ColumnHeader>AUTO-CLEANUP</Table.ColumnHeader>
                    <Table.ColumnHeader>DOWNLOAD</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {entries.map((entry) => (
                    <Table.Row key={entry.id}>
                      <Table.Cell>{entry.filename}</Table.Cell>
                      <Table.Cell>
                        <Text fontSize="xs">
                          {friendlyReason(entry.failureReason) || "Unknown error"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="xs">
                          {timeRemaining(entry.createdAt) || "\u2014"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <IconButton
                          aria-label="Download file"
                          size="xs"
                          variant="ghost"
                          loading={downloading === entry.id}
                          onClick={() => handleDownload(entry)}
                        >
                          <Download size={14} />
                        </IconButton>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Accordion.ItemContent>
          </Accordion.Item>
        </Accordion.Root>
      </Box>
    </Alert.Root>
  );
}

/**
 * PendingUploadsInfo — a light, non-alarming indicator for uploads
 * that are being retried automatically. Shown near the header badges.
 */
export function PendingUploadsInfo({ entries }) {
  if (entries.length === 0) return null;

  const processingCount = entries.filter((e) => e.status === "processing").length;

  // Find the soonest next retry time among pending entries
  const pendingEntries = entries.filter((e) => e.status === "pending");
  let nextRetryText = null;
  if (pendingEntries.length > 0) {
    const soonest = pendingEntries.reduce((earliest, entry) => {
      const t = entry.nextRetryAt?.toDate
        ? entry.nextRetryAt.toDate()
        : entry.nextRetryAt
          ? new Date(entry.nextRetryAt)
          : null;
      if (!t) return earliest;
      if (!earliest) return t;
      return t < earliest ? t : earliest;
    }, null);

    if (soonest) {
      const msUntil = soonest.getTime() - Date.now();
      if (msUntil <= 0) {
        nextRetryText = "Retrying now";
      } else {
        const minUntil = Math.ceil(msUntil / (60 * 1000));
        if (minUntil >= 60) {
          const hours = Math.floor(minUntil / 60);
          const mins = minUntil % 60;
          nextRetryText = `Next retry in ${hours}h ${mins > 0 ? `${mins}m` : ""}`;
        } else {
          nextRetryText = `Next retry in ${minUntil}m`;
        }
      }
    }
  }

  const plural = (n, word) => `${n} ${word}${n !== 1 ? "s" : ""}`;

  let statusText;
  if (processingCount > 0) {
    statusText = `Retrying ${plural(processingCount, "upload")} now.`;
  } else {
    statusText = `${plural(entries.length, "upload")} being retried automatically.`;
  }

  return (
    <Text fontSize="xs" color="gray.400">
      {statusText}
      {nextRetryText && processingCount === 0 && (
        <> {nextRetryText}.</>
      )}
    </Text>
  );
}

/**
 * UploadsResolvedNotice — brief success confirmation shown when
 * previously pending/failed uploads have all been resolved.
 */
export function UploadsResolvedNotice() {
  return (
    <Alert.Root status="success" variant="subtle" size="sm">
      <Alert.Indicator />
      <Alert.Title fontSize="sm">All queued uploads completed successfully.</Alert.Title>
    </Alert.Root>
  );
}

// Default export kept for backward compatibility
export default FailedUploadsPanel;
