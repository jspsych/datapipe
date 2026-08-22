import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Field, HStack, Stack, Switch } from "@chakra-ui/react";
import FormErrorAlert from "./FormErrorAlert";
import GuidanceLine from "./GuidanceLine";
import StatusIndicator from "./StatusIndicator";

/**
 * SettingsRow, and the write-feedback machinery behind it.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * The dashboard shipped eleven empty `catch` blocks
 * (`ExperimentActive.js` x7, `MetadataControl.js` x2, `ExperimentValidation.js`,
 * `Title.js`). Every one of them sat at the end of an optimistic toggle: set
 * local React state, fire a `setDoc`, discard whatever came back. A researcher
 * flips "Enable data collection" on, the write fails -- offline, security
 * rules, quota -- and the switch stays green while the experiment collects
 * nothing for six weeks.
 *
 * That is not a generic bug. PRODUCT.md defines success as "an experiment
 * collects for six weeks and every participant's data arrives"; a control that
 * lies about whether collection is on inverts the product's entire promise.
 * DESIGN.md §8.7 bans silent catches by name, and PRODUCT.md Principle 5 is
 * "no silent failures".
 *
 * The same toggle shape was repeated seven times across three files, so the
 * fix is repeated seven times too unless it lives in one component. This is
 * that component: it owns the optimistic update, the await, the revert, the
 * human error message, and the confirmation that a write actually landed.
 *
 * ---------------------------------------------------------------------------
 * The revert invariant
 * ---------------------------------------------------------------------------
 * On failure the row must end up displaying what Firestore actually holds, not
 * what the researcher asked for. `useTrackedSave` takes an explicit `revert`
 * callback and runs it before surfacing the error, so the switch snaps back to
 * its previous position at the same moment the message appears. The two
 * together say "this did not happen"; either alone is ambiguous.
 *
 * Success is surfaced too (Nielsen 1, visibility of system status): a
 * transient "Saved" indicator, inside a `role="status"` live region so a
 * screen-reader user learns the write landed. Persona Sam in the critique
 * cannot tell a saved toggle from an unsaved one at all today -- there is no
 * announcement of any kind.
 *
 * No silent retry. A failed write stays failed and visible until the
 * researcher acts, because a retry that also fails silently is the original
 * bug with extra steps.
 *
 * ---------------------------------------------------------------------------
 * Color
 * ---------------------------------------------------------------------------
 * The switch is `colorPalette="brandGreen"`, not Chakra's stock `green`.
 * DESIGN.md §1: "one green, not two" -- `green.500` (#22c55e) and the brand
 * #2E7D32 are visibly different hues and were rendering side by side. Solid
 * fill measures 4.77:1 vs the light page and 5.96:1 vs the dark one.
 * Everything else here is `fg` / `fg.muted` / `bg.muted` semantic tokens.
 */

const DEFAULT_FAILURE_MESSAGE =
  "Could not save this change. Your experiment is still running with its " +
  "previous setting -- check your connection and try again.";

// How long the transient "Saved" confirmation stays up. Long enough to be
// noticed on a glance, short enough that it never reads as permanent state.
const SAVED_VISIBLE_MS = 3000;

/**
 * useTrackedSave
 *
 * Wraps a Firestore write so that failure is impossible to miss and impossible
 * to leave the UI lying about. Shared by SettingsRow and by the call sites
 * that are not switch rows at all (numeric inputs, the inline title editor,
 * the validation form), so all of them get the same contract.
 *
 * @param {string} [failureMessage] - The human sentence shown on failure.
 *   Never a raw Firebase code -- same rule DESIGN.md §6 sets for
 *   FormErrorAlert.
 * @returns {{error: string|null, saved: boolean, saving: boolean,
 *   save: (write: () => Promise<any>, revert?: () => void) => Promise<boolean>,
 *   clear: () => void}}
 */
export function useTrackedSave(failureMessage = DEFAULT_FAILURE_MESSAGE) {
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Guards a setState on an unmounted component when a researcher navigates
  // away mid-write.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!saved) return undefined;
    const timer = setTimeout(() => {
      if (mounted.current) setSaved(false);
    }, SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const clear = useCallback(() => {
    setError(null);
    setSaved(false);
  }, []);

  const save = useCallback(
    async (write, revert) => {
      setError(null);
      setSaved(false);
      setSaving(true);
      try {
        await write();
        if (mounted.current) setSaved(true);
        return true;
      } catch (err) {
        // Revert FIRST, so the control and the message agree the instant the
        // researcher reads either one.
        if (revert) revert();
        if (mounted.current) setError(failureMessage);
        // Kept for debugging; it is no longer the ONLY place the failure
        // goes, which was the actual defect.
        console.error("Settings write failed:", err);
        return false;
      } finally {
        if (mounted.current) setSaving(false);
      }
    },
    [failureMessage]
  );

  return { error, saved, saving, save, clear };
}

/**
 * SaveStatus
 *
 * The visible half of `useTrackedSave`. Renders the failure through the app's
 * one error surface (`FormErrorAlert`, which already carries `role="alert"`)
 * and the success through a `StatusIndicator` -- icon plus mandatory visible
 * text, never color alone (DESIGN.md §5).
 *
 * The wrapper is a `role="status"` `aria-live="polite"` region so a change in
 * either direction is announced without stealing focus.
 */
export function SaveStatus({ saved, error, savedLabel = "Saved" }) {
  if (!saved && !error) return null;

  return (
    <Box role="status" aria-live="polite" w="100%" mt={2}>
      {error ? (
        <FormErrorAlert>{error}</FormErrorAlert>
      ) : (
        <StatusIndicator status="ok" label={savedLabel} />
      )}
    </Box>
  );
}

/**
 * SettingsRow
 *
 * One labelled switch, its optional description, its optional dependent
 * controls, and its own write feedback.
 *
 * @param {React.ReactNode} label - Required. The control's visible label.
 * @param {React.ReactNode} [description] - One line of guidance under the
 *   label, rendered through GuidanceLine (`sm`/`fg.muted`). Consequence
 *   before mechanism.
 * @param {React.ReactNode} [badge] - Optional node beside the label, e.g. a
 *   "Recommended" chip.
 * @param {boolean} checked - The committed value, as loaded from Firestore.
 *   When this prop changes the row re-syncs to it, so an update made in
 *   another tab is reflected here.
 * @param {(next: boolean) => void} [onChange] - Called with the optimistic
 *   value immediately, and called AGAIN with the previous value if the write
 *   fails. Lets a parent mirror the state for dependent UI without having to
 *   re-implement the revert.
 * @param {(next: boolean) => Promise<any>} onSave - Required. Performs the
 *   write. Must reject on failure -- a resolved promise is taken as proof the
 *   change landed.
 * @param {string} [failureMessage] - Human sentence for the failure case.
 *   Say what is still true about the researcher's data, not what the SDK
 *   called the error.
 * @param {string} [savedLabel="Saved"] - Text of the transient confirmation.
 * @param {React.ReactNode} [children] - Dependent controls (e.g. "how many
 *   conditions?"), rendered below the row. The call site decides whether they
 *   are conditional on `checked`.
 */
export default function SettingsRow({
  label,
  description,
  badge,
  checked,
  onChange,
  onSave,
  failureMessage,
  savedLabel,
  children,
}) {
  if (process.env.NODE_ENV !== "production") {
    if (!label) console.error("SettingsRow: `label` is required.");
    if (!onSave) {
      console.error(
        "SettingsRow: `onSave` is required and must return a promise that " +
          "rejects on failure. Without it this row cannot know whether the " +
          "change was saved, which is the bug this component exists to fix."
      );
    }
  }

  const { error, saved, save } = useTrackedSave(failureMessage);

  // Displayed value, seeded from the committed prop. Compared during render
  // rather than synced in an effect: an effect would fight the optimistic
  // update during the round trip and flip the switch back and forth while the
  // write was still in flight.
  const [value, setValue] = useState(checked);
  const [committed, setCommitted] = useState(checked);
  if (committed !== checked) {
    setCommitted(checked);
    setValue(checked);
  }

  const handleChange = (next) => {
    const previous = value;
    setValue(next);
    if (onChange) onChange(next);

    save(
      () => onSave(next),
      () => {
        setValue(previous);
        if (onChange) onChange(previous);
      }
    );
  };

  return (
    <Field.Root>
      <Stack w="100%" gap={0}>
        <HStack justify="space-between" alignItems="center" w="100%" gap={4}>
          <HStack gap={2} alignItems="center" minW={0}>
            <Field.Label fontWeight="normal" mb={0} color="fg">
              {label}
            </Field.Label>
            {badge}
          </HStack>
          <Switch.Root
            colorPalette="brandGreen"
            size="md"
            checked={value}
            onCheckedChange={(e) => handleChange(e.checked)}
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>

        {description && <GuidanceLine mt={1}>{description}</GuidanceLine>}

        <SaveStatus saved={saved} error={error} savedLabel={savedLabel} />

        {children && (
          <Box w="100%" mt={3}>
            {children}
          </Box>
        )}
      </Stack>
    </Field.Root>
  );
}

/**
 * SettingsRowGroup — vertical rhythm for a run of SettingsRows.
 * DESIGN.md §4: within a section, `gap={4}`.
 */
export function SettingsRowGroup({ children }) {
  return (
    <Stack w="100%" gap={4}>
      {children}
    </Stack>
  );
}

export { DEFAULT_FAILURE_MESSAGE };
