import { Box, HStack, IconButton, Text } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * CopyButton
 *
 * Lives INSIDE the code specimen (see CodeBlock.js), which DESIGN.md §1 makes
 * mode-invariant: `code.bg` is #111111 in both light and dark. That is why
 * this button names `code.*` colors explicitly instead of using the default
 * gray outline recipe -- the recipe is mode-aware, so in light mode it would
 * paint gray.800 (#27272a) on the invariant #111111 ground at 1.09:1. A
 * control that is correct on the page is not automatically correct on an
 * object that ignores the page's mode.
 *
 *   code.fg     gray.300 on #111111 -> 12.78:1 (icon and label)
 *   code.border gray.500 on #111111 ->  3.30:1 (outline; 3:1 floor, WCAG 1.4.11)
 *   code.bg.active gray.800         -> hover fill
 *
 * Two behavioral fixes alongside the color:
 *
 * - `navigator.clipboard.writeText` was called unawaited with no catch. It
 *   rejects on insecure origins and when clipboard permission is denied, so
 *   the button showed a checkmark for a copy that never happened.
 * - The only success signal was an icon swap. There is now a visible "Copied"
 *   label in an `aria-live="polite"` region, so the confirmation reaches
 *   people who are not watching a 16px glyph -- and a failure says what to do
 *   instead, rather than nothing.
 */
export default function CopyButton({ code }) {
  const [state, setState] = useState("idle"); // idle | copied | error

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
      setState("error");
    }
  };

  return (
    <HStack gap={2} align="center" flexShrink={0}>
      <Box aria-live="polite" role="status">
        {state === "copied" && (
          <Text fontSize="xs" color="code.fg">
            Copied
          </Text>
        )}
        {state === "error" && (
          <Text fontSize="xs" color="code.fg" maxW="20ch">
            Could not copy. Select the code and copy it manually.
          </Text>
        )}
      </Box>
      <IconButton
        aria-label="Copy code"
        size="sm"
        variant="outline"
        color="code.fg"
        borderColor="code.border"
        _hover={{ bg: "code.bg.active", color: "code.fg.strong" }}
        onClick={onCopy}
      >
        {state === "copied" ? <Check /> : <Copy />}
      </IconButton>
    </HStack>
  );
}
