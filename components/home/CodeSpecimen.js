import { Box, Button, HStack, Tabs, Text } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { CODE_ROLE, snippets, snippetText } from "./hero-snippets";

// Controls that live INSIDE the mode-invariant code device cannot use the
// app's default focus ring: that ring is mode-aware and this surface is not.
// `code.fn` (brandGreen.300) is 9.38:1 on code.bg and clears the 3:1 non-text
// floor against every other surface inside the device (header strip, active tab
// fill) with room, so one ring value is visible in both modes, as the device is.
const deviceFocusRing = {
  outline: "2px solid",
  outlineColor: "code.fn",
  outlineOffset: "2px",
};

// The device's controls change color on hover and on selection, and those
// changes used to snap. DESIGN.md §7: 150-200ms, ease-out only
// (cubic-bezier(0, 0, 0.2, 1)), and feedback is one of the four things motion
// is allowed to convey. Color only -- nothing here moves, so there is no
// transform to suppress; under `prefers-reduced-motion: reduce` the
// transition is dropped and every state change lands instantly, which is the
// behaviour this file had before.
const deviceTransition = {
  transitionProperty: "color, background-color, border-color",
  transitionDuration: "160ms",
  transitionTimingFunction: "cubic-bezier(0, 0, 0.2, 1)",
  "@media (prefers-reduced-motion: reduce)": {
    transitionProperty: "none",
  },
};

// The visitor's literal next action on a page of code is to copy it, so the
// chrome carries a real Copy button rather than the three fake macOS traffic
// lights that used to sit here.
//
// This is deliberately NOT components/CopyButton.js. That one is icon-only --
// its entire "copied" state is a glyph swap, which DESIGN.md §5 bans ("status
// is never color-alone or icon-alone; a visible text label is mandatory") --
// and it paints itself with `color="white"` / `whiteAlpha.300`, both §1-banned
// and both mode-aware once that file converts, which would break this device's
// invariance. Icon plus a permanently visible word, on `code.*` tokens.
function CopyCodeButton({ code }) {
  // idle | copied | error. A clipboard write can be refused (insecure origin,
  // denied permission) and DESIGN.md §8 ban 7 forbids swallowing that: the
  // failure gets the same visible, announced label the success does.
  const [state, setState] = useState("idle");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 2000);
  };

  const label =
    state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy";

  return (
    <Button
      variant="ghost"
      size="xs"
      h="28px"
      px={2}
      gap={2}
      fontSize="xs"
      fontWeight="500"
      borderRadius={4}
      color="code.fg.muted"
      _hover={{ color: "code.fg.strong", bg: "code.bg.active" }}
      _focusVisible={deviceFocusRing}
      css={deviceTransition}
      onClick={onCopy}
    >
      {state === "copied" ? <Check size={14} /> : <Copy size={14} />}
      <Text as="span" aria-live="polite">
        {label}
      </Text>
    </Button>
  );
}

// The send half of the hero specimen: two snippets, user-controlled.
//
// This replaced a 6-second `setInterval` that flipped the panel underneath the
// reader and silently reverted their own click (WCAG 2.2.2 Pause/Stop/Hide,
// Level A). Chakra's Tabs supplies role="tablist", aria-selected, roving
// tabindex and arrow keys, and only the selected panel is in the accessibility
// tree -- the old version hid the inactive snippet with `opacity: 0`, so a
// screen reader read out both. Nothing here moves on its own, so there is no
// motion to give a reduced-motion story to.
export default function CodeSpecimen() {
  // Controlled only so the Copy button copies the snippet the reader is
  // actually looking at. Nothing but a click or an arrow key changes it.
  const [value, setValue] = useState(snippets[0].id);
  const active = snippets.find((s) => s.id === value) ?? snippets[0];

  return (
    <Tabs.Root
      value={value}
      onValueChange={(e) => setValue(e.value)}
      variant="plain"
      bg="code.bg"
      borderWidth="1px"
      // The seam where the invariant device meets the mode-aware page:
      // gray.500 is 4.50:1 on the light page and 3.43:1 on the dark one, both
      // clear of the 3:1 non-text floor, with one value and no branch.
      borderColor="code.border"
      borderRadius={12}
      overflow="hidden"
    >
      <HStack
        px={3}
        py={2}
        bg="code.bg.header"
        borderBottomWidth="1px"
        borderColor="code.border.subtle"
        justifyContent="space-between"
        gap={2}
      >
        <Tabs.List gap={1} border="none">
          {snippets.map((s) => (
            <Tabs.Trigger
              key={s.id}
              value={s.id}
              px={2}
              h="28px"
              fontSize="xs"
              fontWeight="500"
              // Selection is carried by a 2px rule as well as by color and
              // fill: the active fill alone is 1.43:1 against the header, which
              // is a state nobody can see. The code.fn rule (9.38:1 on code.bg)
              // clears the 3:1 non-text floor against header and active fill
              // alike, so the state is never color-alone (DESIGN.md §5).
              borderBottomWidth="2px"
              borderColor="transparent"
              borderRadius={0}
              color="code.fg.muted"
              _selected={{
                color: "code.fg.strong",
                bg: "code.bg.active",
                borderColor: "code.fn",
              }}
              _hover={{ color: "code.fg.strong" }}
              _focusVisible={deviceFocusRing}
              css={deviceTransition}
            >
              {s.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <CopyCodeButton key={active.id} code={snippetText(active)} />
      </HStack>

      {snippets.map((s) => (
        <Tabs.Content
          key={s.id}
          value={s.id}
          p={0}
          _focusVisible={deviceFocusRing}
        >
          <Box
            as="pre"
            p={[4, 4, 5]}
            fontSize={["xs", "xs", "sm"]}
            fontFamily="monospace"
            lineHeight="1.7"
            whiteSpace="pre"
            // The panel is narrower than 440px on a small viewport, and a <pre>
            // inside an `overflow: hidden` parent silently loses the tail of a
            // long line without this.
            overflowX="auto"
          >
            {s.lines.map((line, i) => (
              <Text as="span" key={`${s.id}-${i}`} color={CODE_ROLE[line.role]}>
                {line.text}
              </Text>
            ))}
          </Box>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
