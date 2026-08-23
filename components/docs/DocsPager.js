import NextLink from "next/link";
import { useRouter } from "next/router";
import { Box, HStack, Link as ChakraLink, Text } from "@chakra-ui/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { findDocsPage } from "../../lib/docs-nav";

/**
 * DocsPager
 *
 * Prev/next, derived from the flattened DOCS_NAV order -- no per-page
 * configuration (docs IA plan §3.5). The sidebar order IS the reading order,
 * so this costs one component with zero editorial upkeep: add or reorder a
 * page in lib/docs-nav.js and every pager on every page updates itself.
 *
 * Renders nothing when the current route isn't in DOCS_NAV (e.g. it is
 * rendered from a page that hasn't been wired up yet) or when there is
 * neither a previous nor a next page.
 */
export default function DocsPager() {
  const router = useRouter();
  const found = findDocsPage(router.pathname);

  if (!found) return null;

  const { prevPage, nextPage } = found;
  if (!prevPage && !nextPage) return null;

  return (
    <HStack
      as="nav"
      aria-label="Documentation pages"
      mt={16}
      pt={6}
      justify="space-between"
      align="flex-start"
      gap={4}
      wrap="wrap"
    >
      <Box>
        {prevPage && (
          <ChakraLink
            asChild
            display="inline-flex"
            flexDirection="column"
            alignItems="flex-start"
            gap={1}
            color="fg"
            _hover={{ color: "brandGreen.fg" }}
          >
            <NextLink href={prevPage.href}>
              <Text as="span" fontSize="sm" color="fg.muted">
                Previous
              </Text>
              <HStack gap={1.5}>
                <ArrowLeft size={16} aria-hidden="true" />
                <Text as="span">{prevPage.label}</Text>
              </HStack>
            </NextLink>
          </ChakraLink>
        )}
      </Box>
      <Box textAlign="right">
        {nextPage && (
          <ChakraLink
            asChild
            display="inline-flex"
            flexDirection="column"
            alignItems="flex-end"
            gap={1}
            color="fg"
            _hover={{ color: "brandGreen.fg" }}
          >
            <NextLink href={nextPage.href}>
              <Text as="span" fontSize="sm" color="fg.muted">
                Next
              </Text>
              <HStack gap={1.5}>
                <Text as="span">{nextPage.label}</Text>
                <ArrowRight size={16} aria-hidden="true" />
              </HStack>
            </NextLink>
          </ChakraLink>
        )}
      </Box>
    </HStack>
  );
}
