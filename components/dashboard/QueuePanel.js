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

// Copy keyed off the provider-agnostic error taxonomy that adapters map their
// own failures into (functions/src/providers/types.ts's ProviderErrorCode).
// This is the preferred classification: guessing from an HTTP status (below)
// was an OSF-era assumption that does not survive other providers -- Dataverse
// returns 400 for BOTH write contention and quota-exceeded, so a status-based
// map either mislabels them or, as before this change, shows the researcher a
// raw string like "Provider error 400: Failed to add file to dataset."
const PROVIDER_ERROR_COPY = {
  // Contention is routine and self-resolving: some providers (Dataverse)
  // accept only one write per container at a time, so simultaneous
  // submissions collide.
  CONTENTION:
    "Your storage provider was busy with another upload from this experiment. This is normal when several participants finish at once.",
  RATE_LIMITED: "Your storage provider rate-limited the request.",
  AUTH_EXPIRED:
    "Authentication error. Your storage provider connection may need to be refreshed.",
  QUOTA_EXCEEDED:
    "Your storage provider is out of space, or this file is larger than it allows.",
  NAME_CONFLICT:
    "A file with this name already exists in your storage provider.",
  UNAVAILABLE: "Your storage provider was temporarily unavailable.",
};

// Overrides for the cases where one taxonomy code covers genuinely different
// provider behavior and the generic wording above would send the researcher
// looking in the wrong place. Keyed [code][storageProvider]; anything absent
// falls back to the generic copy, which stays the default rather than the
// exception. `storageProvider` is undefined on legacy OSF queue docs, which
// simply misses here and falls back.
//
// Deliberately small. A per-provider string for every code would be six
// entries times five adapters of copy to keep true, and most of it would just
// restate the generic line -- the whole point of the taxonomy is that the
// researcher's next action is usually the same whoever is storing the data.
const PROVIDER_SPECIFIC_COPY = {
  QUOTA_EXCEEDED: {
    // Zenodo maps BOTH of its hard caps to QUOTA_EXCEEDED: the 50 GB
    // per-file/per-record size limits, and the 100-files-per-record cap. The
    // generic "out of space, or this file is larger than it allows" is
    // actively wrong for the second one -- the record has room and the file is
    // fine, it just cannot hold another entry -- and that is the EXPECTED
    // failure at session 101, not an edge case, since the compaction that
    // would keep a study under the cap is not built yet (see zenodo.ts's
    // setupWarnings, which warns about this before collection starts).
    zenodo:
      "This Zenodo record has reached one of its limits: 100 files, or 50 GB. DataPipe does not yet combine sessions into archives, so further submissions will keep failing. Download these files and add them to the record yourself.",
  },
};

// Copy for failures that carry NO taxonomy code, matched against the prose in
// failureReason. Two populations land here: queue docs written before
// providerErrorCode existed, and — the larger group — every failure that never
// reached the provider at all, since only a provider WriteResult produces a
// code. Those are written in six places across api-data.ts, api-base64.ts and
// scheduled-upload-retry.ts; each distinct prefix they emit has an entry here.
//
// ORDER MATTERS. The interpolated `detail` on a cache or cached-data failure
// can itself contain "fetch failed", so the specific prefixes must be tested
// before the generic network match below, or a rehydration failure would be
// reported as a connection problem.
//
// Matching on prose is the same fragility PROVIDER_ERROR_COPY was introduced
// to escape, and it stays fragile: change a string on the writing side and the
// copy here silently reverts to showing that raw string. The durable fix is a
// structured stage field on the queue doc alongside providerErrorCode; this is
// deliberately the cheaper version, and it is also the only thing that can
// work for docs already in Firestore.
const REASON_COPY = [
  [
    /Token resolution (failed|exception)/,
    "DataPipe could not authenticate with your storage provider. Reconnect it from your account page, then upload this file manually.",
  ],
  [
    /Collision cache rehydration failed/,
    "DataPipe could not read the existing files in your storage provider, so it could not safely check whether this filename was already used.",
  ],
  [
    /Collision cache rehydrating/,
    "DataPipe was still checking this experiment's existing filenames when this submission arrived.",
  ],
  [
    /(Owner user not found|Experiment not found)/,
    "The experiment or account this upload belonged to no longer exists. Download the file now if you still need it.",
  ],
  [
    // The saved copy is what the download button serves, so if it cannot be
    // read the researcher must not be told to just download it.
    /Failed to read cached data/,
    "DataPipe could not read its own saved copy of this submission, so it cannot be uploaded or downloaded. Please report this.",
  ],
  [/(interrupted upload|memory limit)/, "Upload was interrupted by a server restart or memory limit."],
  [/(Upload exception|fetch failed)/, "Could not connect to your storage provider."],
];

function reasonCopy(reason) {
  if (!reason) return null;
  for (const [pattern, copy] of REASON_COPY) {
    if (pattern.test(reason)) return copy;
  }
  // Older queue docs say "OSF error <status>"; current writes say
  // "Provider error <status>". Both must keep mapping.
  const status = reason.match(/(?:OSF|Provider) error (\d{3})/)?.[1];
  if (status === "503" || status === "502") {
    return "Your storage provider was temporarily unavailable.";
  }
  if (status === "429") {
    return "Your storage provider rate-limited the request.";
  }
  if (status === "401" || status === "403") {
    return "Authentication error. Your storage provider connection may need to be refreshed.";
  }
  return reason;
}

// Reassurance that is only true while retries are still running. Appended to
// the copy above for pending/processing entries and withheld once an entry has
// exhausted its retries -- a failed row used to sit under a "Failed" badge
// still telling the researcher the upload "is being retried automatically",
// which reads as "no action needed" at the exact moment manual recovery is the
// only thing that will save the file.
const STILL_RETRYING_SUFFIX = {
  CONTENTION: " It is being retried automatically.",
};

function friendlyReason(entry) {
  const code = entry?.providerErrorCode;
  const copy =
    PROVIDER_SPECIFIC_COPY[code]?.[entry?.storageProvider] ?? PROVIDER_ERROR_COPY[code];
  if (copy) {
    const stillRetrying = entry?.status === "pending" || entry?.status === "processing";
    return stillRetrying ? `${copy}${STILL_RETRYING_SUFFIX[code] ?? ""}` : copy;
  }
  return reasonCopy(entry?.failureReason);
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
    alertTitle = `${plural(failedCount, "file")} could not be uploaded to your storage provider.`;
    alertDescription = "All retries were exhausted. Download these files and upload them to your storage provider manually to prevent data loss.";
  } else if (failedCount > 0) {
    alertTitle = `${plural(entries.length, "file")} did not upload to your storage provider.`;
    alertDescription = `${plural(pendingCount, "file")} still being retried. ${plural(failedCount, "file")} failed permanently. You can download all files below.`;
  } else {
    alertTitle = `${plural(pendingCount, "file")} did not upload to your storage provider.`;
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
                your storage provider immediately. If that fails, DataPipe saves a
                copy and retries automatically. Common reasons include:
              </Text>
              <Box as="ul" fontSize="sm" pl={5} pb={3} listStyleType="disc">
                <Box as="li" mb={1}>
                  <strong>Server memory limit</strong> — Large data submissions
                  can occasionally exceed the server&apos;s memory capacity.
                </Box>
                <Box as="li" mb={1}>
                  <strong>Storage provider unavailable</strong> — Your storage
                  provider may be temporarily down or rate-limiting requests.
                </Box>
                <Box as="li" mb={1}>
                  <strong>Configuration issue</strong> — There may be a problem
                  with your storage provider settings or authentication token.
                </Box>
              </Box>
              <Text fontSize="sm" pb={3}>
                Files are stored for up to 7 days. If retries don&apos;t succeed,
                download the files and upload them to your storage provider manually.
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
                    {friendlyReason(entry) || "\u2014"}
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
