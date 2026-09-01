import { Box, HStack, IconButton, Text } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";
import useCopyToClipboard from "../lib/use-copy-to-clipboard";

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
 * The behavior -- awaited write, a real error state, and a visible label in an
 * `aria-live` region rather than a 16px glyph swap as the only confirmation --
 * now lives in lib/use-copy-to-clipboard.js, shared with the citation page's
 * page-surface copy button. The reasoning behind each of those three is in
 * that file.
 */
export default function CopyButton({ code }) {
  const { state, copy } = useCopyToClipboard();

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
        onClick={() => copy(code)}
      >
        {state === "copied" ? <Check /> : <Copy />}
      </IconButton>
    </HStack>
  );
}
