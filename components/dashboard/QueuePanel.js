import { useState } from "react";
import {
  Box,
  Accordion,
  Alert,
  Table,
  Badge,
  IconButton,
  Text,
} from "@chakra-ui/react";
import { Download } from "lucide-react";
import { auth } from "../../lib/firebase";

function statusBadge(status) {
  const colors = {
    pending: "orange",
    processing: "blue",
    failed: "red",
  };
  return (
    <Badge colorPalette={colors[status] || "gray"} variant="solid" px={2}>
      {status}
    </Badge>
  );
}

function formatDate(isoString) {
  if (!isoString) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(isoString));
}

export default function QueuePanel({ entries, experimentId }) {
  const [downloading, setDownloading] = useState(null);

  const handleDownload = async (entry) => {
    setDownloading(entry.id);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const idToken = await user.getIdToken();
      const response = await fetch(
        `/api/queuestatus?experimentID=${experimentId}&download=${entry.id}`,
        {
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );
      if (!response.ok) {
        console.error("Failed to get download URL");
        return;
      }
      const { url } = await response.json();
      window.open(url, "_blank");
    } catch (e) {
      console.error("Download failed:", e);
    } finally {
      setDownloading(null);
    }
  };

  const pendingCount = entries.filter(
    (e) => e.status === "pending" || e.status === "processing"
  ).length;
  const failedCount = entries.filter((e) => e.status === "failed").length;

  let alertTitle = "";
  if (pendingCount > 0 && failedCount > 0) {
    alertTitle = `${pendingCount} file(s) queued for upload, ${failedCount} failed.`;
  } else if (pendingCount > 0) {
    alertTitle = `${pendingCount} file(s) queued for upload to OSF.`;
  } else {
    alertTitle = `${failedCount} file(s) failed to upload to OSF.`;
  }

  return (
    <Alert.Root status="warning" variant="solid">
      <Alert.Indicator />
      <Box flex="1">
        <Alert.Title mb={1}>{alertTitle}</Alert.Title>
        <Text fontSize="sm" mb={4}>
          Queued files are retried automatically every hour and stored for up to
          1 week. You can download them below.
        </Text>
        <Accordion.Root collapsible>
          <Accordion.Item value="queue-list">
            <Accordion.ItemTrigger>
              <Box as="span" flex="1" textAlign="left">
                See Queued Files
              </Box>
              <Accordion.ItemIndicator />
            </Accordion.ItemTrigger>
            <Accordion.ItemContent pb={4}>
              <Table.Root variant="line" size="sm">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>FILENAME</Table.ColumnHeader>
                    <Table.ColumnHeader>STATUS</Table.ColumnHeader>
                    <Table.ColumnHeader>QUEUED AT</Table.ColumnHeader>
                    <Table.ColumnHeader>RETRIES</Table.ColumnHeader>
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
                      <Table.Cell>{formatDate(entry.createdAt)}</Table.Cell>
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
                </Table.Body>
              </Table.Root>
            </Accordion.ItemContent>
          </Accordion.Item>
        </Accordion.Root>
      </Box>
    </Alert.Root>
  );
}
