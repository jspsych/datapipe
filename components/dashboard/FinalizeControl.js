import { useState } from "react";
import {
  Stack,
  HStack,
  Text,
  Button,
  Alert,
  Dialog,
  Spinner,
} from "@chakra-ui/react";

import { auth } from "../../lib/firebase";

// Phase 4 of docs/finalization-spec.md. Modeled on MetadataControl.js for the
// data-driven shape and DeleteAccount.js for the confirm-dialog pattern
// (finalization is just as irreversible as account deletion, and for the
// same reason deserves the same explicit "are you sure" step rather than a
// bare toggle).
//
// `data` is the live experiment document as loaded by the parent page's
// useDocumentData listener (pages/admin/[experiment_id].js) -- that listener
// IS the "polling" docs/finalization-spec.md's Phase 4 asks for: every write
// finalizeTask makes to experiments/{id}.finalization (functions/src/
// api-finalize.ts) arrives here as a normal prop update, no separate fetch
// loop required.
const IN_PROGRESS_STATUSES = new Set(["queued", "running"]);

// Copy for every terminal, non-finalized status finalizeTask can leave behind
// (FinalizationState in functions/src/interfaces.ts). Keyed by status so a
// new status added to FinalizationResult (finalization.ts) fails safe: an
// unrecognized status still renders the Finalize button with no extra alert,
// rather than looking broken.
const STATUS_COPY = {
  // The one status that must never read as a generic, alarming failure: it
  // means the researcher's own data is still safely in flight and belongs in
  // the archive, not that anything is wrong.
  "queued-uploads-pending": {
    tone: "warning",
    title: "Some uploads are still in flight.",
    describe: (detail) =>
      detail ||
      "Uploads for this experiment are still queued, and they belong in the final archive. Finalization will wait until the queue has drained -- try again once those uploads finish.",
  },
  "nothing-to-archive": {
    tone: "info",
    title: "Nothing to finalize yet.",
    describe: () =>
      "This experiment has never received any data, so there is nothing to merge. You can finalize later once data has been submitted.",
  },
  "archive-too-large": {
    tone: "error",
    title: "The merged archive is too large for your storage provider.",
    describe: (detail) =>
      detail || "The merged archive exceeded your storage provider's per-file limit.",
  },
  "leased-elsewhere": {
    tone: "error",
    title: "Finalization is already running elsewhere.",
    describe: () =>
      "Another finalization or compaction pass is already in progress for this experiment. Try again shortly.",
  },
  "not-eligible": {
    tone: "error",
    title: "This experiment can't be finalized.",
    describe: (detail) => detail || "This experiment is not eligible for finalization.",
  },
  failed: {
    tone: "error",
    title: "Finalization failed.",
    describe: (detail) => detail || "Something went wrong while finalizing this experiment.",
  },
};

async function requestFinalize(experimentId) {
  const user = auth.currentUser;
  const idToken = await user.getIdToken();
  const response = await fetch("/api/finalize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ experimentID: experimentId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error ||
        body.detail ||
        "Could not start finalization. Nothing was changed -- please try again."
    );
  }
}

export default function FinalizeControl({ data, experimentId }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const status = data?.finalization?.status;
  const inProgress = IN_PROGRESS_STATUSES.has(status);

  const handleConfirm = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await requestFinalize(experimentId);
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      // Closed either way: on success there is nothing left to confirm (the
      // live `data` prop takes over from here), and on failure the dialog
      // would otherwise sit on top of the retry button and the error it
      // explains -- both live outside the dialog, in the idle-state view.
      setOpen(false);
      setSubmitting(false);
    }
  };

  // Finalized is permanent and wins over anything else: even a stray
  // in-progress-looking status from a stale read cannot un-hide the control.
  if (data?.finalized === true) {
    return (
      <Alert.Root status="success" variant="subtle">
        <Alert.Indicator />
        <Stack gap={1}>
          <Alert.Title>This experiment has been finalized.</Alert.Title>
          <Text fontSize="sm">
            Every remaining file has been merged into one archive on your
            storage provider, and no further submissions will be accepted.
            This cannot be undone.
          </Text>
        </Stack>
      </Alert.Root>
    );
  }

  if (inProgress) {
    return (
      <HStack gap={3} align="center">
        <Spinner size="sm" />
        <Text fontSize="sm">
          Finalizing this experiment&hellip; This merges every remaining file
          into one archive and may take a while. You can leave this page --
          progress will continue and pick up here when you return.
        </Text>
      </HStack>
    );
  }

  const terminalCopy = STATUS_COPY[status];

  return (
    <Stack gap={3} align="flex-start">
      {terminalCopy && (
        <Alert.Root status={terminalCopy.tone} variant="subtle">
          <Alert.Indicator />
          <Stack gap={1}>
            <Alert.Title>{terminalCopy.title}</Alert.Title>
            <Text fontSize="sm">{terminalCopy.describe(data?.finalization?.detail)}</Text>
          </Stack>
        </Alert.Root>
      )}
      {submitError && (
        <Alert.Root status="error" variant="subtle">
          <Alert.Indicator />
          <Text fontSize="sm">{submitError}</Text>
        </Alert.Root>
      )}

      <Button colorPalette="red" onClick={() => setOpen(true)} loading={submitting}>
        Finalize experiment
      </Button>

      <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="greyBackground" color="white">
            <Dialog.Header fontSize="lg" fontWeight="bold">
              Finalize this experiment?
            </Dialog.Header>

            <Dialog.Body>
              <Text mb={4}>
                This action cannot be undone. Finalizing merges every
                remaining file into a single archive on your storage provider
                and permanently deletes the loose files it was built from. No
                further submissions will be accepted once this completes.
              </Text>
              <Text>
                This can take a while for large studies. You can leave this
                page after confirming -- progress continues in the background
                and will show here when you return.
              </Text>
            </Dialog.Body>

            <Dialog.Footer>
              <Button onClick={() => setOpen(false)} colorPalette="brandTeal">
                Cancel
              </Button>
              <Button
                colorPalette="red"
                loading={submitting}
                onClick={handleConfirm}
                ml={3}
              >
                Confirm
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </Stack>
  );
}
