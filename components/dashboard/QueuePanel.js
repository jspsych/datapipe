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
    return "Upload was interrupted by a server restart or memory limit.";
  }
  if (reason.includes("Upload exception") || reason.includes("fetch failed")) {
    return "Could not connect to OSF.";
  }
  if (reason.includes("OSF error 503") || reason.includes("OSF error 502")) {
    return "OSF was temporarily unavailable.";
  }
  if (reason.includes("OSF error 429")) {
    return "OSF rate-limited the request.";
  }
  if (reason.includes("OSF error 401") || reason.includes("OSF error 403")) {
    return "Authentication error. Your OSF token may need to be refreshed.";
  }
  return reason;
}

function statusBadge(status) {
  const labels = {
    pending: { color: "orange", text: "Retrying" },
    processing: { color: "blue", text: "Retrying now" },
    failed: { color: "red", text: "Failed" },
  };
  const { color, text } = labels[status] || { color: "gray", text: status };
  return (
    <Badge colorPalette={color} variant="solid" px={2}>
      {text}
    </Badge>
  );
}

function nextRetryText(nextRetryAt) {
  if (!nextRetryAt) return null;
  const t = nextRetryAt.toDate ? nextRetryAt.toDate() : new Date(nextRetryAt);
  const msUntil = t.getTime() - Date.now();
  if (msUntil <= 0) return "soon";
  const minUntil = Math.ceil(msUntil / (60 * 1000));
  if (minUntil >= 60) {
    const hours = Math.floor(minUntil / 60);
    const mins = minUntil % 60;
    return `in ${hours}h${mins > 0 ? ` ${mins}m` : ""}`;
  }
  return `in ${minUntil}m`;
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
    return `${days}d ${hoursLeft % 24}h`;
  }
  return `${hoursLeft}h`;
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
 * QueuePanel — shows all queued uploads (pending + failed) with immediate
 * download access. Pending items are being retried automatically but the
 * researcher can download them right away without waiting.
 */
export default function QueuePanel({ entries, experimentId }) {
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

  const pendingCount = entries.filter(
    (e) => e.status === "pending" || e.status === "processing"
  ).length;
  const failedCount = entries.filter((e) => e.status === "failed").length;
  const allFailed = failedCount > 0 && pendingCount === 0;

  const plural = (n, word) => `${n} ${word}${n !== 1 ? "s" : ""}`;

  let alertTitle;
  let alertDescription;

  if (allFailed) {
    alertTitle = `${plural(failedCount, "file")} could not be uploaded to OSF.`;
    alertDescription = "All retries were exhausted. Download these files and upload them to your OSF project manually to prevent data loss.";
  } else if (failedCount > 0) {
    alertTitle = `${plural(entries.length, "file")} did not upload to OSF.`;
    alertDescription = `${plural(pendingCount, "file")} still being retried. ${plural(failedCount, "file")} failed permanently. You can download all files below.`;
  } else {
    alertTitle = `${plural(pendingCount, "file")} did not upload to OSF.`;
    alertDescription = "DataPipe is retrying automatically. You can also download the files now.";
  }

  return (
    <Alert.Root status={allFailed ? "error" : "warning"} variant="solid">
      <Alert.Indicator />
      <Box flex="1">
        <Alert.Title mb={1}>{alertTitle}</Alert.Title>
        <Text fontSize="sm" mb={4}>{alertDescription}</Text>
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
                your OSF project immediately. If that fails, DataPipe saves a
                copy and retries automatically. Common reasons include:
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
                Files are stored for up to 7 days. If retries don&apos;t succeed,
                download the files and upload them to OSF manually.
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
        <Table.Root variant="line" size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>FILENAME</Table.ColumnHeader>
              <Table.ColumnHeader>STATUS</Table.ColumnHeader>
              <Table.ColumnHeader>REASON</Table.ColumnHeader>
              <Table.ColumnHeader>STORED FOR</Table.ColumnHeader>
              <Table.ColumnHeader></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {entries.map((entry) => (
              <Table.Row key={entry.id}>
                <Table.Cell>{entry.filename}</Table.Cell>
                <Table.Cell>
                  {statusBadge(entry.status)}
                  {(entry.status === "pending" || entry.status === "processing") &&
                    entry.nextRetryAt && (
                      <Text fontSize="xs" color="gray.400" mt={1}>
                        Next retry {nextRetryText(entry.nextRetryAt)}
                      </Text>
                    )}
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="xs">
                    {friendlyReason(entry.failureReason) || "\u2014"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="xs">
                    {timeRemaining(entry.createdAt) || "\u2014"}
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
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </Alert.Root>
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
