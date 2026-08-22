import { Box, HStack } from "@chakra-ui/react";
import CopyButton from "./CopyButton";
import { useEffect, useRef } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-markup";

/**
 * Syntax-highlight token colors, defined locally against the `code.*` semantic
 * tokens instead of importing `prismjs/themes/prism-tomorrow.css`.
 *
 * The vendored theme was a hard blocker for light mode. It sets
 * `pre[class*="language-"] { background: #2d2d2d }` plus token colors picked
 * for that specific dark ground (#ccc, #7ec699, #f8c555, ...). This component
 * neutralised the `pre` background but not `code`'s and not the token colors,
 * so on any lighter surface every token dropped to roughly 1.5-2:1.
 *
 * DESIGN.md §1 resolves it differently than "make the block light": the code
 * specimen is a MODE-INVARIANT device. `code.bg` is gray.950 #111111 in both
 * modes -- 17.57:1 against the light page, a deliberate object rather than a
 * region of the page -- and every token color below is computed against that
 * one ground, so a single palette is correct in light and dark alike. The
 * invariance is the design; do not add `_light`/`_dark` here.
 *
 * Measured on `code.bg` #111111:
 *   code.fg        gray.300  12.78:1   default token text
 *   code.fg.strong gray.50   17.57:1   keywords, numbers, literals
 *   code.fg.muted  gray.400   7.37:1   punctuation, operators
 *   code.comment   gray.400   7.37:1   comments
 *   code.string    brandOrange.300  10.91:1   string literals
 *   code.fn        brandGreen.300    9.38:1   function and plugin names, tags
 *
 * The lowest of those is 7.37:1, comfortably clear of the 4.5:1 body floor,
 * which matters more than usual here: code is read character by character and
 * a mis-set token is a copy-paste bug, not a typography nit.
 */
const PRISM_TOKEN_STYLES = {
  "& code[class*='language-'], & pre[class*='language-']": {
    background: "none",
    color: "code.fg",
    textShadow: "none",
    fontFamily: "mono",
  },
  "& .token.comment, & .token.prolog, & .token.doctype, & .token.cdata": {
    color: "code.comment",
    fontStyle: "italic",
  },
  "& .token.punctuation, & .token.operator, & .token.entity": {
    color: "code.fg.muted",
  },
  "& .token.string, & .token.char, & .token.attr-value, & .token.inserted, & .token.regex, & .token.url":
    {
      color: "code.string",
    },
  "& .token.function, & .token.class-name, & .token.tag, & .token.selector, & .token.property, & .token.attr-name":
    {
      color: "code.fn",
    },
  "& .token.keyword, & .token.boolean, & .token.number, & .token.constant, & .token.symbol, & .token.atrule, & .token.builtin, & .token.important, & .token.variable":
    {
      color: "code.fg.strong",
    },
  "& .token.deleted": {
    color: "code.fg.muted",
    textDecoration: "line-through",
  },
  "& .token.bold": { fontWeight: "bold" },
  "& .token.italic": { fontStyle: "italic" },
};

export default function CodeBlock({ children, language = "javascript", ...props }) {
  let lines = children.split("\n");
  // remove first line if it is empty
  if (lines[0].trim() === "") {
    lines.shift();
  }
  // get indent of the first line
  const indent = lines[0].match(/^\s*/)[0].length;
  // remove indent from all lines
  lines = lines.map((line) => line.slice(indent));
  // join lines back together
  const code = lines.join("\n");

  const codeRef = useRef(null);

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code]);

  return (
    <Box
      w="100%"
      // Was `bg="gray.800" color="white"` -- two raw literals, and white on
      // gray.800 is fine only while the page is forced dark. `code.border`
      // (gray.500) is the seam between the invariant device and the
      // mode-aware page: 4.50:1 against the light page, 3.43:1 against the
      // dark one, clearing WCAG 1.4.11's 3:1 in both.
      bg="code.bg"
      color="code.fg"
      borderWidth="1px"
      borderColor="code.border"
      p={4}
      rounded="md"
      overflow="hidden"
      css={PRISM_TOKEN_STYLES}
      {...props}
    >
      <HStack alignItems="start" justifyContent="space-between" gap={6}>
        <Box
          as="pre"
          fontFamily="mono"
          pb={3}
          overflowX="auto"
          flex="1"
          minW={0}
          style={{ background: "none", margin: 0, padding: 0 }}
        >
          <code ref={codeRef} className={`language-${language}`}>
            {code}
          </code>
        </Box>
        <CopyButton code={children} />
      </HStack>
    </Box>
  );
}
