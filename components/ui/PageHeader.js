import { Box, Heading, HStack, Stack, Link as ChakraLink } from "@chakra-ui/react";
import NextLink from "next/link";
import { ArrowLeft } from "lucide-react";
import GuidanceLine from "./GuidanceLine";

/**
 * PageHeader
 *
 * DESIGN.md §6 names this under "anticipated": page title, optional
 * one-sentence purpose line, optional back link, optional single primary
 * action. Every page gets one.
 *
 * It exists mostly for the back link. The dashboard critique's §4 finding 1 --
 * "no orientation" -- is that `/admin/[experiment_id]` and `/admin/new` have no
 * route back to `/admin` at all: the only ways out are the browser button and
 * the navbar. A researcher who follows "connect a storage provider" out of the
 * create flow lands on account settings with no sign they were mid-task
 * (persona Jordan, §8). PRODUCT.md Principle 3 is "never strand a researcher";
 * a back link on every page is the cheapest possible version of that.
 *
 * Typography per DESIGN.md §3: title `2xl` (24px) / 700 / `fg`, sentence case,
 * one per page. The purpose line is a `GuidanceLine` (`sm` / `fg.muted`), so
 * there is one styling of a supporting sentence app-wide.
 *
 * Contrast: title `fg` = #1C1F22 light / gray.50 dark -> 13.16:1 / 12.94:1
 * against the worst permitted surface (`bg.muted`). The back link is
 * `fg.muted` (8.30:1 / 9.14:1) rather than green -- it is navigation chrome,
 * not the action on the page, and DESIGN.md §5's "one primary per screen"
 * means the green belongs to `action`. Its arrow icon is decorative and sits
 * beside always-visible text, never alone.
 *
 * @param {string} [title] - Page title, sentence case. Required unless
 *   `titleSlot` is given.
 * @param {React.ReactNode} [titleSlot] - Renders in place of `title` when the
 *   heading is itself interactive (the inline-editable experiment title). The
 *   call site owns its typography in that case.
 * @param {React.ReactNode} [purpose] - One sentence: what this page is for.
 * @param {string} [backHref] - Destination for the back link.
 * @param {string} [backLabel] - Back link text, e.g. "Back to experiments".
 *   Required when `backHref` is set -- an arrow with no words is not a label.
 * @param {React.ReactNode} [action] - The single primary action for the page,
 *   right-aligned on wide viewports and stacked below on narrow ones.
 * @param {number} [mb=8] - Bottom margin. DESIGN.md §4 spacing scale only.
 */
export default function PageHeader({
  title,
  titleSlot,
  purpose,
  backHref,
  backLabel,
  action,
  mb = 8,
}) {
  if (process.env.NODE_ENV !== "production") {
    if (!title && !titleSlot) {
      console.error("PageHeader: pass either `title` or `titleSlot`.");
    }
    if (backHref && !backLabel) {
      console.error(
        "PageHeader: `backLabel` is required with `backHref`. A back arrow " +
          "with no text does not say where it goes."
      );
    }
  }

  return (
    <Box w="100%" mb={mb}>
      {backHref && (
        <ChakraLink
          asChild
          fontSize="sm"
          color="fg.muted"
          display="inline-flex"
          alignItems="center"
          gap={2}
          mb={3}
          _hover={{ color: "fg", textDecoration: "underline" }}
        >
          <NextLink href={backHref}>
            <ArrowLeft size={16} aria-hidden="true" />
            {backLabel}
          </NextLink>
        </ChakraLink>
      )}

      <Stack
        direction={["column", "row"]}
        justify="space-between"
        align={["stretch", "flex-start"]}
        gap={4}
        w="100%"
      >
        <Box minW={0} flex="1">
          {titleSlot || (
            <Heading as="h1" fontSize="2xl" fontWeight="bold" color="fg">
              {title}
            </Heading>
          )}
          {purpose && <GuidanceLine mt={2}>{purpose}</GuidanceLine>}
        </Box>

        {action && <HStack justify={["stretch", "flex-end"]}>{action}</HStack>}
      </Stack>
    </Box>
  );
}
