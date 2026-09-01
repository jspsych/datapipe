import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useCopyToClipboard
 *
 * The copy-button state machine, extracted from components/CopyButton.js so
 * the code specimen's icon button and the citation page's labelled button
 * share one implementation rather than two that can drift.
 *
 * Three states, and the two non-idle ones are what the button has to say out
 * loud (see CopyButton's own notes): `writeText` rejects on insecure origins
 * and when clipboard permission is denied, so an unawaited call reports a
 * success that never happened. It is awaited here, and a rejection lands in
 * `error` rather than in `copied`.
 *
 * `copied` reverts after `resetAfterMs`; `error` does not. A failure carries
 * an instruction -- select it and copy manually -- and clearing that after two
 * seconds would take the instruction away from exactly the reader who needs
 * it. It clears on the next successful copy instead.
 *
 * The timeout is cleared on unmount, and before each new copy, so a reader who
 * navigates away inside the two-second window doesn't leave a setState aimed
 * at a component that is gone.
 */
export default function useCopyToClipboard({ resetAfterMs = 2000 } = {}) {
  const [state, setState] = useState("idle"); // idle | copied | error
  const timeoutRef = useRef(null);

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  const copy = useCallback(
    async (text) => {
      clearTimeout(timeoutRef.current);
      try {
        await navigator.clipboard.writeText(text);
        setState("copied");
        timeoutRef.current = setTimeout(() => setState("idle"), resetAfterMs);
      } catch (err) {
        console.error("Copy failed:", err);
        setState("error");
      }
    },
    [resetAfterMs]
  );

  return { state, copy };
}
