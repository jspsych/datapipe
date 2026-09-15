import { useCallback } from "react";
import { TagsInput, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import useTransientNotice from "./useTransientNotice";

/**
 * TagListInput
 *
 * A short list of exact string values, entered one at a time and rendered as
 * pills. Replaces the "type a comma-separated list into a textarea" pattern.
 *
 * ---------------------------------------------------------------------------
 * Why a pill, and not a textarea
 * ---------------------------------------------------------------------------
 * The list this was built for is `requiredFields` on an experiment: names that
 * are compared with `includes` against JSON keys and CSV header cells
 * (`functions/src/validate-json.ts`, `validate-csv.ts`). The comparison is
 * exact. There is no fuzzy match, no trim on the server, and no error message
 * that names the field that failed -- a rejected submission is a bare 400
 * `INVALID_DATA` (pages/docs/experiments/validation.js). So a stray space, a
 * pasted quote, or a trailing comma does not produce a warning; it produces an
 * experiment that silently rejects every participant.
 *
 * A textarea cannot show that. `trial_type , rt` and `trial_type,rt` look the
 * same at a glance, and the empty string that a trailing comma leaves behind
 * is invisible by definition -- that one shipped, and `[""]` in a live
 * experiment document is why both validators now carry a filter for it.
 *
 * A pill is the fix because it is a *receipt*. The moment a name becomes a
 * pill, the researcher can see exactly what will be compared: its boundaries
 * are drawn, its whitespace is gone, and an empty entry has nothing to draw so
 * it cannot appear at all. Text that has not yet become a pill is still in the
 * input, visibly pending. Nothing is ambiguous.
 *
 * ---------------------------------------------------------------------------
 * Normalization happens on the way OUT, not on the way in
 * ---------------------------------------------------------------------------
 * There are four routes a value can take into the list -- typed + Enter, typed
 * + comma, pasted (split on commas), and edited in place on an existing pill --
 * and Chakra's underlying machine treats them as four different code paths.
 * Guarding them one by one is how you end up guarding three of them.
 *
 * So `normalizeList` runs on every committed value, whatever produced it, and
 * the caller only ever receives a list that is trimmed, unquoted, non-empty
 * and de-duplicated. `validate` below is *not* where correctness lives; it
 * exists only so that a rejected keystroke can say why, instead of the pill
 * quietly failing to appear.
 *
 * ---------------------------------------------------------------------------
 * The message slot does not move the page
 * ---------------------------------------------------------------------------
 * Same rule SettingsRow's SavedFlag follows: feedback that appears and
 * disappears must not reflow its neighbours. There is one line under the
 * control, and the rejection notice *replaces* the helper text in it rather
 * than mounting below it, then restores itself. Nothing below the field moves.
 *
 * ---------------------------------------------------------------------------
 * Deviations from Chakra's stock `tagsInput` recipe, and why
 * ---------------------------------------------------------------------------
 * - `itemDeleteTrigger` ships `opacity: 0.4` at rest. A 40%-opacity glyph on a
 *   tinted fill is nowhere near the 3:1 WCAG 1.4.11 floor, and it is the
 *   control that removes a rule from a live experiment. Full opacity,
 *   `fg.muted`.
 * - That same trigger ships no focus ring at all (the recipe gives one to
 *   `clearTrigger` and forgets the per-item one). DESIGN.md §5 requires a ring
 *   on *every* interactive element including icon-only ones; §8.8 bans going
 *   without. Added.
 * - `itemPreview` fills with `colorPalette.subtle` and no border. On the light
 *   page that is `gray.100` inside a `bg` control -- 1.17:1, an edge that is
 *   not there. DESIGN.md §1 settles this for panels ("must carry a border --
 *   never rely on the fill alone") and a pill boundary is load-bearing in
 *   exactly the same way: it is what separates one exact string from the next.
 *   `bg.muted` + 1px `border`.
 * - Focus on the control is Chakra's 1px outline; DESIGN.md §5 specifies 2px.
 *
 * @param {string} label - Required. The field's visible label.
 * @param {string[]} value - The committed list. Controlled.
 * @param {(next: string[]) => void} onChange - Called with a normalized list
 *   whenever it changes. Never called with an unchanged list.
 * @param {string} [helperText] - The steady-state line under the control.
 * @param {string} [placeholder]
 * @param {string} [itemNoun="item"] - Singular noun used in the accessible
 *   announcements and the rejection notices ("field", "column", "tag").
 * @param {boolean} [disabled=false]
 * @param {boolean} [editable=true] - Allow editing a pill in place (Enter on a
 *   highlighted pill, or double-click).
 */

// Quote characters a researcher can plausibly paste around a field name:
// straight pairs from source code, curly pairs from a document or a chat
// client, and backticks from a Markdown span. `"trial_type"` copied out of a
// jsPsych example is a different string from `trial_type` as far as
// `Array.includes` is concerned, and nothing downstream would ever tell them.
const QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["“", "”"],
  ["‘", "’"],
];

/**
 * One value: trimmed, unwrapped, trimmed again. Returns "" for anything that
 * is not a usable name, which is how empties are dropped downstream.
 */
export function normalizeTag(raw) {
  if (typeof raw !== "string") return "";
  let out = raw.trim();
  // Loop rather than a single pass: `'"rt"'` is a real paste (a quoted string
  // inside a quoted list) and one pass would leave the inner quotes on.
  let stripped = true;
  while (stripped && out.length >= 2) {
    stripped = false;
    for (const [open, close] of QUOTE_PAIRS) {
      if (out.startsWith(open) && out.endsWith(close)) {
        out = out.slice(1, -1).trim();
        stripped = true;
        break;
      }
    }
  }
  return out;
}

/**
 * A whole list: every value normalized, empties dropped, duplicates dropped
 * keeping first position. This is the only shape a caller ever sees.
 */
export function normalizeList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list ?? []) {
    const clean = normalizeTag(raw);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

const sameList = (a, b) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

export default function TagListInput({
  label,
  value,
  onChange,
  helperText,
  placeholder,
  itemNoun = "item",
  disabled = false,
  editable = true,
}) {
  if (process.env.NODE_ENV !== "production") {
    if (!label) console.error("TagListInput: `label` is required.");
    if (!onChange) console.error("TagListInput: `onChange` is required.");
  }

  // Shared with the format checkboxes in ExperimentValidation, which refuse
  // the same way for the same reason: the write never happened, and the
  // researcher is owed the reason.
  const { notice, say, clear: clearNotice } = useTransientNotice();

  const committed = normalizeList(value);

  const handleValueChange = useCallback(
    (details) => {
      const next = normalizeList(details.value);
      // The machine hands back its own raw list, which may normalize to
      // something identical to what the caller already holds -- pasting
      // "rt," adds nothing once the empty is dropped. Writing in that case
      // would be a Firestore round trip for no change.
      if (sameList(next, committed)) return;
      clearNotice();
      onChange(next);
    },
    [committed, onChange, clearNotice]
  );

  /**
   * Runs before a value is accepted. Correctness does not depend on it --
   * `handleValueChange` normalizes regardless -- but a pill that simply fails
   * to appear is the silent failure this component exists to remove, so every
   * rejection says why.
   *
   * `inputValue` is the whole pending string, and on the paste path it still
   * contains the delimiters (the machine validates first and splits after), so
   * this has to split for itself.
   */
  const validate = useCallback(
    (details) => {
      const pieces = normalizeList(details.inputValue.split(","));
      if (pieces.length === 0) {
        say(`That is not a ${itemNoun} name.`);
        return false;
      }
      const existing = new Set(normalizeList(details.value));
      const fresh = pieces.filter((piece) => !existing.has(piece));
      if (fresh.length === 0) {
        say(
          pieces.length === 1
            ? `"${pieces[0]}" is already in the list.`
            : `Those ${itemNoun}s are already in the list.`
        );
        return false;
      }
      return true;
    },
    [itemNoun, say]
  );

  return (
    <TagsInput.Root
      value={committed}
      onValueChange={handleValueChange}
      validate={validate}
      disabled={disabled}
      editable={editable}
      // Off by default in the machine, which would drop a pasted
      // "trial_type, rt, subject_id" in as ONE pill containing commas -- a
      // name no submission can ever have. Pasting a list is the single most
      // likely way this field gets filled.
      addOnPaste
      // A half-typed name left in the input when focus leaves is a name the
      // researcher meant to add; committing it is what the textarea did (it
      // parsed on blur) and dropping it now would be a regression.
      blurBehavior="add"
      // The machine's stock strings say "tag", which means nothing here. These
      // are what a screen-reader user hears from its live region, so they name
      // the thing the researcher named it.
      translations={{
        clearTriggerLabel: `Remove all ${itemNoun}s`,
        deleteTagTriggerLabel: (tag) => `Remove ${itemNoun} ${tag}`,
        tagAdded: (tag) => `Added ${itemNoun} ${tag}`,
        tagsPasted: (tags) => `Added ${tags.length} ${itemNoun}s`,
        tagEdited: (tag) =>
          `Editing ${itemNoun} ${tag}. Press enter to save or escape to cancel.`,
        tagUpdated: (tag) => `${itemNoun} changed to ${tag}`,
        tagDeleted: (tag) => `Removed ${itemNoun} ${tag}`,
        tagSelected: (tag) =>
          `${tag} selected. Press enter to edit, or backspace to remove.`,
      }}
    >
      <TagsInput.Label
        fontWeight="normal"
        fontSize="md"
        color="fg"
        mb={1}
        _disabled={{ opacity: 1, color: "fg.subtle" }}
      >
        {label}
      </TagsInput.Label>

      <TagsInput.Control
        borderColor="border"
        bg="bg"
        // DESIGN.md §5: 2px ring. Chakra's recipe emits a 1px outline here and
        // no offset. The control is not itself the focus target -- the input
        // inside it is -- so the ring is driven by `_focusWithin`, which is
        // what makes the whole pill box read as one field.
        _focusWithin={{
          borderColor: "brandGreen.focusRing",
          outline: "2px solid",
          outlineColor: "brandGreen.focusRing",
          outlineOffset: "2px",
        }}
        // Chakra's `_disabled` on this slot is `opacity: 0.5`, which takes the
        // pill text with it and drops it under the contrast floor. Grey the
        // surface instead and leave the names readable -- a locked list still
        // has to be legible, or the researcher cannot tell what it locked.
        _disabled={{ opacity: 1, bg: "bg.subtle", cursor: "not-allowed" }}
        py={2}
        px={2}
        gap={2}
        // A one-pill row measures 44px (28px pill + 8px of padding either
        // side) while the recipe's empty height is 40px, so the field grew by
        // 4px the instant the first pill landed and shrank again when the last
        // one went -- and it is the FIRST pill, the one you are looking at,
        // that moves the page. Reserve the row height instead.
        minH={11}
      >
        <TagsInput.Context>
          {(api) =>
            api.value.map((item, index) => (
              <TagsInput.Item key={`${item}-${index}`} index={index} value={item}>
                <TagsInput.ItemPreview
                  bg="bg.muted"
                  color="fg"
                  borderWidth="1px"
                  borderColor="border"
                  rounded="md"
                  gap={1}
                  ps={2}
                  pe={1}
                  _highlighted={{
                    borderColor: "brandGreen.focusRing",
                    bg: "bg.subtle",
                  }}
                >
                  <TagsInput.ItemText fontSize="sm">{item}</TagsInput.ItemText>
                  <TagsInput.ItemDeleteTrigger
                    opacity={1}
                    color="fg.muted"
                    rounded="sm"
                    // Chakra sizes this at `item-height / 1.5` -- 18.7px at
                    // size md -- and then pulls it back over the pill's own
                    // trailing padding with a negative margin. 24px square and
                    // no negative margin: WCAG 2.2 2.5.8 wants 24x24, and
                    // these pills sit 8px apart, so the spacing exception does
                    // not rescue an 18px target either.
                    boxSize="24px"
                    me={0}
                    _hover={{ color: "fg", bg: "bg.subtle" }}
                    _focusVisible={{
                      outline: "2px solid",
                      outlineColor: "brandGreen.focusRing",
                      outlineOffset: "1px",
                      color: "fg",
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                  </TagsInput.ItemDeleteTrigger>
                </TagsInput.ItemPreview>
                <TagsInput.ItemInput fontSize="sm" />
              </TagsInput.Item>
            ))
          }
        </TagsInput.Context>
        <TagsInput.Input
          placeholder={committed.length === 0 ? placeholder : undefined}
          fontSize="sm"
          _placeholder={{ color: "fg.subtle" }}
        />
        <TagsInput.HiddenInput />
      </TagsInput.Control>

      {/* ONE line, always exactly one line's worth of box, whether it is
          holding guidance or a rejection. See the header note: this used to be
          a message that mounted underneath and pushed the save-error block and
          everything below it down a row on every duplicate keystroke. */}
      <Text
        mt={2}
        fontSize="sm"
        maxW="70ch"
        color={notice ? "brandOrange.fg" : "fg.muted"}
        // `aria-live` rather than `role="alert"`: the machine already owns an
        // assertive live region for additions and removals, and two regions
        // interrupting each other is worse than either alone.
        aria-live="polite"
      >
        {notice || helperText}
      </Text>
    </TagsInput.Root>
  );
}
