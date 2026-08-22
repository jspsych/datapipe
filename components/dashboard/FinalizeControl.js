import { useState } from "react";
import {
  Box,
  Stack,
  HStack,
  Text,
  Button,
  Alert,
  Spinner,
} from "@chakra-ui/react";

import { auth } from "../../lib/firebase";
import ConfirmDialog from "../ui/ConfirmDialog";
import StatusIndicator from "../ui/StatusIndicator";

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
//
// `tone` is both the Alert `status` (which picks the icon) and, through
// TONE_PALETTE below, an explicit brand colorPalette. Chakra's stock statuses
// resolve to its own blue/orange/green/red ramps; DESIGN.md §1 allows one
// orange, one red and one green, and §5 retires blue as a UI color entirely --
// so the informational tone is `neutral` (gray), not `info` (blue).
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
    tone: "neutral",
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

// Maps a tone onto the brand palette, so no alert on this control paints
// itself out of Chakra's stock ramps. brandOrange/brandRed `subtle` pairs
// clear the 4.5:1 body floor in both modes (DESIGN.md §1); `neutral` stays on
// gray, which is a real palette in both modes after lib/theme.js re-pointed
// it.
const TONE_PALETTE = {
  warning: "brandOrange",
  error: "brandRed",
  neutral: "gray",
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

  const status = data?.finalization?.status;
  const inProgress = IN_PROGRESS_STATUSES.has(status);

  // ConfirmDialog owns the loading state, the in-dialog error surface and the
  // close-on-success behavior, so this just has to throw. The hand-rolled
  // dialog it replaces closed itself on FAILURE too, which was reasoned about
  // carefully at the time (the retry button lived outside the dialog) but is
  // superseded: ConfirmDialog keeps the dialog open and renders the message in
  // place, so the researcher does not lose the context of what they were
  // about to do. It also fixes the DESIGN.md §8.4 green solid Cancel that sat
  // next to the red Confirm, shouting louder than the destructive button.
  const handleConfirm = async () => {
    await requestFinalize(experimentId);
  };

  // Finalized is permanent and wins over anything else: even a stray
  // in-progress-looking status from a stale read cannot un-hide the control.
  if (data?.finalized === true) {
    return (
      // Not `Alert status="success"`: that resolves to Chakra's stock green,
      // the second green DESIGN.md §1 retires, and brandGreen's own `subtle`
      // pairing is 3.91:1 in dark mode (§1 caveat). Neutral panel + a
      // StatusIndicator on `status.ok` instead.
      <Box
        w="100%"
        bg="bg.panel"
        color="fg"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        px={4}
        py={3}
      >
        <Stack gap={2}>
          <StatusIndicator status="ok" label="This experiment has been finalized." />
          <Text fontSize="sm" color="fg.muted">
            Every remaining file has been merged into one archive on your
            storage provider, and no further submissions will be accepted.
            This cannot be undone.
          </Text>
        </Stack>
      </Box>
    );
  }

  if (inProgress) {
    return (
      <HStack gap={3} align="center" role="status" aria-live="polite">
        <Spinner size="sm" color="brandGreen.solid" />
        <Text fontSize="sm" color="fg">
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
        <Alert.Root
          status={terminalCopy.tone}
          colorPalette={TONE_PALETTE[terminalCopy.tone]}
          variant="subtle"
        >
          <Alert.Indicator />
          <Stack gap={1}>
            <Alert.Title>{terminalCopy.title}</Alert.Title>
            <Text fontSize="sm">{terminalCopy.describe(data?.finalization?.detail)}</Text>
          </Stack>
        </Alert.Root>
      )}

      {/* brandRed, not Chakra's stock `red`. DESIGN.md §5 reserves red for
          irreversible destruction, and finalization is the most irreversible
          thing on this surface -- so the hue is right, it just has to be the
          brand's one red. The consequence itself is stated in the section
          description on the page ABOVE this button (DESIGN.md §8.10: a dialog
          must not hold the only copy of a consequence); the dialog repeats it
          at the point of decision rather than introducing it. */}
      <Button colorPalette="brandRed" onClick={() => setOpen(true)}>
        Finalize experiment
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={(e) => setOpen(e.open)}
        title="Finalize this experiment?"
        confirmLabel="Confirm"
        destructive
        onConfirm={handleConfirm}
      >
        <Stack gap={4}>
          <Text>
            This action cannot be undone. Finalizing merges every remaining
            file into a single archive on your storage provider and
            permanently deletes the loose files it was built from. No further
            submissions will be accepted once this completes.
          </Text>
          <Text>
            This can take a while for large studies. You can leave this page
            after confirming -- progress continues in the background and will
            show here when you return.
          </Text>
        </Stack>
      </ConfirmDialog>
    </Stack>
  );
}
