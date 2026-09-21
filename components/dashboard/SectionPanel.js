import { Children } from "react";
import { Box } from "@chakra-ui/react";

/**
 * SectionPanel / SwitchTable — the boundaries the experiment page never had.
 *
 * `pages/admin/[experiment_id].js` grouped its content with headings and
 * whitespace alone. That satisfies DESIGN.md §4's "spacing carries grouping"
 * BETWEEN sections, but it left the content INSIDE each section with no edge
 * at all: four switches, a set of ID/link rows and a tabbed code block all
 * sitting directly on the page, in a two-column layout where the eye has no
 * way to tell where one group stops and the next begins.
 *
 * DESIGN.md §1 is explicit about what a container costs here: page-to-panel
 * separation is 1.07:1 in both modes BY DESIGN, so "panels must carry a
 * `border` -- never rely on the fill alone to define an edge". `border` is
 * gray.500 in both modes (4.50:1 light / 3.43:1 dark), clearing WCAG 1.4.11's
 * 3:1 floor for a non-text boundary. This is the same surface recipe
 * `components/ui/EmptyState.js` already uses, so the page's cards agree.
 *
 * SwitchTable is the "tidy table" half. A run of settings switches is exactly
 * the "dense repeating structure" §4's separator policy carves out: hairlines
 * are allowed INSIDE an already-grouped region, using `border.subtle`, as long
 * as they are not the primary grouping device. The panel border does the
 * grouping; the hairlines only keep one row's description from reading as the
 * next row's label. `border.subtle` is #3F4449 in dark (1.68:1) -- decorative
 * by intent, which is why it is never the only edge.
 *
 * Rows are a real `<ul>`/`<li>`: a screen reader announces "list, 4 items" and
 * can step row by row, which is the semantic a visual table of switches
 * promises. The switch labelling itself is untouched -- every row is still a
 * `SettingsRow`, which owns its `Field.Root` / `Field.Label` association.
 */

/**
 * @param {React.ReactNode} children - Panel content.
 * @param {number} [p=5] - Padding. Pass 0 when the children own their own
 *   insets (SwitchTable does, so its hairlines can run edge to edge).
 */
export default function SectionPanel({ children, p = 5, ...rest }) {
  return (
    <Box
      w="100%"
      bg="bg.panel"
      color="fg"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      p={p}
      {...rest}
    >
      {children}
    </Box>
  );
}

/**
 * @param {React.ReactNode} children - One node per row, normally SettingsRow.
 * @param {string} [label] - Accessible name for the list, when the section
 *   heading above it is not specific enough on its own.
 */
export function SwitchTable({ children, label }) {
  const rows = Children.toArray(children);

  return (
    <SectionPanel p={0} overflow="hidden">
      <Box as="ul" listStyleType="none" m={0} p={0} aria-label={label}>
        {rows.map((row, i) => (
          <Box
            as="li"
            key={row.key ?? i}
            px={5}
            py={4}
            // Hairline between rows only -- the panel's own `border` is the
            // outer edge, so a rule at the top of the first row would double it.
            borderTopWidth={i === 0 ? 0 : "1px"}
            borderTopColor="border.subtle"
          >
            {row}
          </Box>
        ))}
      </Box>
    </SectionPanel>
  );
}
