import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Field,
  HStack,
  Stack,
  Switch,
  VisuallyHidden,
} from "@chakra-ui/react";
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
 * ---------------------------------------------------------------------------
 * Why the confirmation does not move the page
 * ---------------------------------------------------------------------------
 * The confirmation used to mount as a new block UNDER the row. Flipping the
 * first switch in a four-row panel grew that row by a line and pushed the
 * three rows below it down; three seconds later they sprang back. So the
 * feedback for "your change landed" was the whole panel jumping -- and if the
 * researcher had already reached for the next switch, the switch they were
 * aiming at had moved. That is the WCAG 2.2 3.2.5-adjacent failure mode this
 * split exists to remove, and it hurts most exactly when someone is setting
 * up an experiment by running down the list of toggles.
 *
 * So the two outcomes now render in two different places:
 *
 *   SavedFlag  -- success. Sits INLINE in the row, immediately left of the
 *                 control it is confirming, and is ALWAYS in the layout: the
 *                 chip is rendered at full size whether or not the write has
 *                 landed, and only `opacity` changes. Nothing reflows, ever,
 *                 in either direction. Placing it beside the control also
 *                 answers "which of these four rows saved?", which a message
 *                 in the gap between two rows never quite did.
 *   SaveError  -- failure. Stays a block under the row. It is a full sentence,
 *                 it is not transient, and it SHOULD claim space and push
 *                 things down: the researcher has to read it and act.
 *
 * A row with dependent controls uses the same pair one level down (the
 * numeric fields in ExperimentActive, the validation detail block) so the
 * confirmation always appears at the top right of whatever it saved.
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

// The visible text of the confirmation chip, on every row. Constant on
// purpose: it is what makes the reserved width identical everywhere, and it
// sits next to the control it refers to, so it does not need to name it. The
// per-call-site `savedLabel` is the SPOKEN version, which does.
const SAVED_TEXT = "Saved";

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
 * SavedFlag
 *
 * The success half of `useTrackedSave`: a small confirmation chip that lives
 * NEXT TO the control it is confirming rather than under it.
 *
 * The chip is always rendered, at full size, and only its `opacity` moves.
 * That is the whole point -- an element that mounts and unmounts is an element
 * that reflows its neighbours twice per save (see the header comment). Because
 * the visible text is the constant `SAVED_TEXT` rather than the caller's
 * `savedLabel`, the reserved width is the same on every row, so the controls
 * beside it line up.
 *
 * Accessibility: the chip is `aria-hidden`, because at `opacity: 0` it is
 * still in the accessibility tree and would otherwise announce a stale
 * "Saved". The announcement comes instead from the visually hidden
 * `role="status"` live region beside it, which carries the caller's full
 * `savedLabel` ("Data collection setting saved") -- a screen-reader user is
 * not looking at which switch the chip is next to, so the announcement has to
 * name the setting that the sighted layout is naming by position.
 *
 * Motion: 150ms `ease-out`, the only durations/easing DESIGN.md §7 allows, and
 * it is dropped entirely under `prefers-reduced-motion: reduce` -- the chip
 * still appears and still announces, it just cuts instead of fading.
 *
 * @param {boolean} saved - From `useTrackedSave`.
 * @param {string} [savedLabel="Saved"] - What a screen reader hears. Name the
 *   setting, not just the outcome.
 */
export function SavedFlag({ saved, savedLabel = "Saved" }) {
  return (
    // `lineHeight="1"` keeps the slot's box tight to the icon and the word,
    // so a permanently-present but usually-invisible element cannot add
    // leading to the row it sits in.
    <Box flexShrink={0} lineHeight="1">
      <Box
        aria-hidden="true"
        opacity={saved ? 1 : 0}
        transition="opacity 150ms cubic-bezier(0, 0, 0.2, 1)"
        _motionReduce={{ transition: "none" }}
      >
        <StatusIndicator status="ok" label={SAVED_TEXT} />
      </Box>
      <VisuallyHidden role="status" aria-live="polite">
        {saved ? savedLabel : ""}
      </VisuallyHidden>
    </Box>
  );
}

/**
 * SaveError
 *
 * The failure half. A block under the control, through the app's one error
 * surface (`FormErrorAlert`, which already carries `role="alert"` and already
 * renders nothing for a falsy message, so call sites need no guard).
 *
 * This one is deliberately NOT space-reserving. Reserving a blank slot the
 * height of an unknown-length sentence would put a permanent hole in every
 * row, and unlike the confirmation, an error is not transient -- it stays
 * until the researcher does something about it, so it is allowed to take the
 * room it needs.
 */
export function SaveError({ error }) {
  return (
    <FormErrorAlert mt={2} w="100%">
      {error}
    </FormErrorAlert>
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
  // Renders the switch inert. For settings that become permanent rather than
  // merely unavailable -- pass `description` to say WHY, because a control
  // that is off with no explanation reads as broken (Nielsen 1). The server
  // rule is the real gate; this only keeps the UI from offering a write that
  // is going to be refused.
  disabled = false,
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
    // Belt and braces with the `disabled` prop below: Chakra's disabled Switch
    // already blocks pointer and keyboard activation, but a locked setting
    // must not be writable by any route that reaches this handler.
    if (disabled) return;
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
    <Stack w="100%" gap={0}>
      {/* The Field wraps ONLY the switch and its label. It must not wrap
          `children`, and that is not a stylistic preference.

          Ark's `useSwitch` and `useCheckbox` both take their hidden input's
          id from the surrounding Field context -- literally
          `ids: { hiddenInput: field?.ids.control }`. So a Checkbox rendered
          inside this row's Field.Root was handed the SAME DOM id as the
          switch's hidden input. `Checkbox.Root` is itself a
          `<label htmlFor={thatId}>`, and the browser resolves a label to the
          FIRST element in the document carrying that id -- the switch, which
          renders above. Ticking "Allow CSV" in the validation panel therefore
          flipped the row's switch instead: validation turned itself off and
          the dependent block collapsed out from under the click. The label
          ids collided the same way.

          Dependent controls open their own fields (the numeric inputs in
          ExperimentActive, the required-fields box in ExperimentValidation),
          so nothing below needs this context -- and anything that inherits it
          is broken by it. */}
      <Field.Root>
        <Stack w="100%" gap={0}>
          <HStack justify="space-between" alignItems="center" w="100%" gap={4}>
            <HStack gap={2} alignItems="center" minW={0}>
              <Field.Label fontWeight="normal" mb={0} color="fg">
                {label}
              </Field.Label>
              {badge}
            </HStack>
            {/* The confirmation rides in the same group as the switch, on the
                switch's left, so it reads as belonging to THIS row. It holds
                its width whether or not it is showing, which is what keeps
                the switch from sliding sideways when a save lands. */}
            <HStack gap={3} alignItems="center" flexShrink={0}>
              <SavedFlag saved={saved} savedLabel={savedLabel} />
              <Switch.Root
                colorPalette="brandGreen"
                size="md"
                checked={value}
                disabled={disabled}
                onCheckedChange={(e) => handleChange(e.checked)}
              >
                <Switch.HiddenInput />
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </HStack>
          </HStack>

          {description && <GuidanceLine mt={2}>{description}</GuidanceLine>}
        </Stack>
      </Field.Root>

      <SaveError error={error} />

      {children && (
        <Box w="100%" mt={3}>
          {children}
        </Box>
      )}
    </Stack>
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
