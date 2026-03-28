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

function statusBadge(status) {
  const labels = {
    pending: { color: "orange", text: "Waiting to retry" },
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

export default function QueuePanel({ entries, experimentId, errorLog }) {
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

  let alertTitle = "";
  if (pendingCount > 0 && failedCount > 0) {
    alertTitle = `${plural(pendingCount, "file")} waiting to upload, ${plural(failedCount, "file")} failed.`;
  } else if (pendingCount > 0) {
    alertTitle = `${plural(pendingCount, "file")} waiting to upload to OSF.`;
  } else {
    alertTitle = `${plural(failedCount, "file")} could not be uploaded to OSF.`;
  }

  return (
    <Alert.Root status={allFailed ? "error" : "warning"} variant="solid">
      <Alert.Indicator />
      <Box flex="1">
        <Alert.Title mb={1}>{alertTitle}</Alert.Title>
        <Text fontSize="sm" mb={4}>
          {allFailed
            ? "These files could not be delivered after multiple attempts. Download them to avoid data loss."
            : "DataPipe will keep retrying automatically. Files are stored for up to 1 week. You can also download them below."}
        </Text>
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
        <Accordion.Root collapsible defaultValue={allFailed ? ["queue-list"] : []}>
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
                    <Table.ColumnHeader>STATUS</Table.ColumnHeader>
                    <Table.ColumnHeader>EXPIRES</Table.ColumnHeader>
                    <Table.ColumnHeader>ATTEMPTS</Table.ColumnHeader>
                    <Table.ColumnHeader>DOWNLOAD</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {entries.map((entry) => (
                    <Table.Row key={entry.id}>
                      <Table.Cell>
                        {entry.filename}
                        {entry.failureReason && (
                          <Text fontSize="xs" color="red.300" mt={1}>
                            {entry.failureReason}
                          </Text>
                        )}
                      </Table.Cell>
                      <Table.Cell>{statusBadge(entry.status)}</Table.Cell>
                      <Table.Cell>{timeRemaining(entry.createdAt)}</Table.Cell>
                      <Table.Cell>
                        {entry.retryCount}/{entry.maxRetries}
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
                  {errorLog && errorLog.map((error, index) => (
                    <Table.Row key={`error-${index}`}>
                      <Table.Cell>
                        <Text>{error.error}</Text>
                        <Text fontSize="xs" color="red.300" mt={1}>
                          {error.time}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge colorPalette="red" variant="solid" px={2}>
                          Error
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>-</Table.Cell>
                      <Table.Cell>-</Table.Cell>
                      <Table.Cell>-</Table.Cell>
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
