import { useContext, useEffect } from "react";
import { Box, Heading, Link as ChakraLink } from "@chakra-ui/react";
import { DocsSectionRegistryContext } from "./DocsLayout";

/**
 * DocsSection
 *
 * <Box as="section"> + a real <Heading as="h2"> with the anchor id, per
 * DESIGN.md §3 "Section heading" (lg / 600 / fg, sentence case). Docs IA plan
 * §3.4.
 *
 * The id lives on the heading itself (deep-linkable), with scroll-margin-top
 * so a jump to the anchor doesn't tuck the heading under the sticky navbar.
 *
 * The anchor affordance is a link wrapping the heading that navigates to
 * #id: a "#" glyph sits at opacity 0 until :hover or :focus-visible -- the
 * focus case is what keeps it keyboard-reachable rather than purely
 * decorative. The heading text itself stays plain `fg` at rest, so no
 * heading looks like a link.
 *
 * Ids are hand-written by the caller, never derived from heading text --
 * DocsLayout's dev-only assertion compares what actually renders here
 * against lib/docs-nav.js and console.errors on drift.
 */
export default function DocsSection({ id, title, children }) {
  const registerSectionId = useContext(DocsSectionRegistryContext);

  useEffect(() => {
    registerSectionId?.(id);
    // Only re-register when the id itself changes -- registerSectionId is a
    // fresh closure every render and including it would re-fire needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <Box as="section" mt={10}>
      <ChakraLink
        href={`#${id}`}
        aria-label="Link to this section"
        color="inherit"
        display="inline-block"
        _hover={{ textDecoration: "none" }}
        css={{
          "&:hover .docs-anchor-glyph, &:focus-visible .docs-anchor-glyph": {
            opacity: 1,
          },
        }}
      >
        <Heading
          as="h2"
          id={id}
          fontSize="lg"
          fontWeight="600"
          color="fg"
          // The sticky navbar plus a little air, so a deep link doesn't land
          // with the heading tucked under the nav.
          scrollMarginTop="24"
        >
          {title}{" "}
          <Box
            as="span"
            className="docs-anchor-glyph"
            color="fg.muted"
            opacity={0}
            transition="opacity 150ms ease-out"
            aria-hidden="true"
          >
            #
          </Box>
        </Heading>
      </ChakraLink>
      <Box mt={4} display="flex" flexDirection="column" gap={4}>
        {children}
      </Box>
    </Box>
  );
}
