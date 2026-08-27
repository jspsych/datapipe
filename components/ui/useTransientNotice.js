import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useTransientNotice
 *
 * A short message that explains why an input REFUSED something, and then gets
 * out of the way.
 *
 * This is the third piece of transient feedback in the dashboard, after
 * `SettingsRow`'s "Saved" chip and the save-error block. It covers the case
 * neither of those does: the write never happened, and not because anything
 * failed -- the control declined to make the change, and a control that
 * declines silently is indistinguishable from one that is broken. Both call
 * sites exist to remove that ambiguity (`TagListInput` when a pill would be a
 * duplicate, `ExperimentValidation` when unticking a format would leave none),
 * so they should say it the same way and for the same length of time.
 *
 * Pair it with a message slot that is ALWAYS one line tall -- steady-state
 * helper text swapped for the notice, not a message that mounts underneath.
 * See the note in TagListInput: a notice that appears and disappears in the
 * layout pushes everything below it down and back on every rejected keystroke.
 *
 * @param {number} [visibleMs] - How long the notice holds the slot.
 * @returns {{notice: string|null, say: (message: string) => void,
 *   clear: () => void}}
 */

// Matches SettingsRow's SAVED_VISIBLE_MS. The transient feedback on a page
// should not linger for different durations depending on which control
// produced it.
const DEFAULT_VISIBLE_MS = 3000;

export default function useTransientNotice(visibleMs = DEFAULT_VISIBLE_MS) {
  const [notice, setNotice] = useState(null);

  // The timer is keyed on a counter rather than the message text so that the
  // same rejection twice in a row restarts it, instead of letting the first
  // one's timeout clear the second one early.
  const [noticeKey, setNoticeKey] = useState(0);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => {
      if (mounted.current) setNotice(null);
    }, visibleMs);
    return () => clearTimeout(timer);
  }, [notice, noticeKey, visibleMs]);

  const say = useCallback((message) => {
    setNotice(message);
    setNoticeKey((k) => k + 1);
  }, []);

  const clear = useCallback(() => setNotice(null), []);

  return { notice, say, clear };
}

export { DEFAULT_VISIBLE_MS };
