import { useEffect, useState } from "react";
import { Alert, Button, CloseButton, Dialog, Text } from "@chakra-ui/react";

/**
 * Confirmation dialog for consequential actions (disconnecting a provider,
 * deleting an account, ...). Controlled, the same shape as every other
 * Dialog.Root on this page: the caller owns `open` and reacts to
 * `onOpenChange`, e.g. `onOpenChange={(e) => setOpen(e.open)}`.
 *
 * Props:
 *   - open, onOpenChange: controlled visibility, Chakra Dialog.Root shape.
 *   - title: dialog heading.
 *   - children: dialog body -- the consequence copy the caller composes.
 *   - confirmLabel: text on the confirm button.
 *   - destructive: red solid confirm for actions that cannot be undone;
 *     brandTeal solid (the default) for actions that are consequential but
 *     reversible. Keep red scarce -- it only means something in the Danger
 *     Zone if routine actions do not also wear it.
 *   - onConfirm: may be async. While it is pending the confirm button shows
 *     a loading state and Cancel is disabled (no closing out from under an
 *     in-flight request). If it throws, the dialog stays OPEN and
 *     `error.message` renders inside it -- the researcher's context (what
 *     they were about to do, what they typed) survives the failure instead
 *     of being thrown away with a closed dialog and a mystery toast. On
 *     success the dialog closes itself.
 *
 * Cancel is ALWAYS the neutral button (variant="outline", no colorPalette) --
 * never brandTeal solid. A solid green Cancel next to a solid red Confirm
 * reads as the button to press, which is backwards: walking away is supposed
 * to be the free, obvious choice, not competing for attention with the
 * action that has a consequence.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
}) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(null);

  // Reopening is a fresh attempt, not a continuation of whatever failed last
  // time -- an error left over from a previous open must not greet the
  // researcher before they have done anything this time.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleConfirm = async () => {
    setIsPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange({ open: false });
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content bg="greyBackground" color="white">
          <Dialog.CloseTrigger asChild>
            <CloseButton size="sm" aria-label="Close" disabled={isPending} />
          </Dialog.CloseTrigger>

          <Dialog.Header fontSize="lg" fontWeight="bold">
            {title}
          </Dialog.Header>

          <Dialog.Body>
            {children}
            {error && (
              <Alert.Root status="error" borderRadius="md" mt={4}>
                <Alert.Indicator />
                <Text fontSize="sm">{error}</Text>
              </Alert.Root>
            )}
          </Dialog.Body>

          <Dialog.Footer>
            <Button
              variant="outline"
              onClick={() => onOpenChange({ open: false })}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              colorPalette={destructive ? "red" : "brandTeal"}
              variant="solid"
              loading={isPending}
              onClick={handleConfirm}
              ml={3}
            >
              {confirmLabel}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
