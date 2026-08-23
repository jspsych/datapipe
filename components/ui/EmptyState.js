import { Box, Heading, Stack } from "@chakra-ui/react";
import GuidanceLine from "./GuidanceLine";

/**
 * EmptyState
 *
 * DESIGN.md §6: "a heading, one sentence of what goes here and why, and the
 * single primary action. Text only: no illustration, no mascot, no emoji."
 * PRODUCT.md's anti-references rule out the playful/consumer register
 * outright -- this is a tool holding irreplaceable research data, and an
 * illustrated shrug is the wrong voice for it.
 *
 * The load-bearing requirement is the `body` copy, not the layout. The
 * dashboard critique (F9, persona Jordan) traces the worst path in the
 * product to this component's absence: the zero-state offered "Create Your
 * First Experiment" as its only action, but a new signup *cannot* create one
 * until a storage provider is connected, so the single button on the page led
 * to a dead end. An empty state must state the precondition and point at
 * whatever satisfies it -- consequence before mechanism (PRODUCT.md
 * Principle 2), not an action that will be refused.
 *
 * Surface: `bg.panel` + a 1px `border`. DESIGN.md §1 is explicit that
 * page-to-panel separation is 1.07:1 in both modes *by design*, so a panel
 * that relies on its fill alone has no edge at all; the border is what makes
 * this a container. `border` is gray.500 in both modes -- 4.50:1 light,
 * 3.43:1 dark, clearing WCAG 1.4.11's 3:1 floor for non-text boundaries.
 * This replaces a `bg="black"` card that sat at 1.27:1 against the page with
 * no border whatsoever.
 *
 * Contrast: heading `fg` 13.16:1 light / 12.94:1 dark; body and secondary
 * link inherit `GuidanceLine`'s `sm`/`fg.muted` (8.30:1 / 9.14:1). The old
 * fine print was `gray.500` at `xs`, which is 4.35:1 and banned twice over --
 * DESIGN.md §3 forbids `fg.subtle` at `xs`, and §1 retires gray.500 as a text
 * color entirely.
 *
 * @param {string} title - Heading, rendered as an <h2>, sentence case.
 * @param {React.ReactNode} body - One or two sentences: what goes here, why
 *   it is empty, and what has to be true before it will not be.
 * @param {React.ReactNode} [action] - Exactly one primary action. If the
 *   obvious action is blocked by a precondition, this must be the control
 *   that clears the precondition instead.
 * @param {React.ReactNode} [secondary] - Optional single supporting line,
 *   typically a documentation link.
 */
export default function EmptyState({ title, body, action, secondary }) {
  if (process.env.NODE_ENV !== "production" && !title) {
    console.error("EmptyState: `title` is required.");
  }

  return (
    <Box
      w="100%"
      bg="bg.panel"
      color="fg"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      px={[6, 8]}
      py={[6, 8]}
    >
      <Stack gap={4} align="flex-start" maxW="60ch">
        <Heading as="h2" size="md" fontWeight="semibold" color="fg">
          {title}
        </Heading>

        {body && <GuidanceLine>{body}</GuidanceLine>}

        {action}

        {secondary}
      </Stack>
    </Box>
  );
}
