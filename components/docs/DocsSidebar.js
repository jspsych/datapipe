import { useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/router";
import {
  Box,
  Button,
  Collapsible,
  Link as ChakraLink,
  Text,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DOCS_NAV, GETTING_STARTED_LINK, PRIVACY_LINK, findDocsPage } from "../../lib/docs-nav";

/**
 * DocsSidebar
 *
 * Renders DOCS_NAV at two breakpoints from one component (docs IA plan
 * §3.3), the same dual-render-internally pattern components/Navbar.js
 * already uses for its desktop/mobile nav.
 *
 * Desktop (md+): a static, always-expanded nav. Two levels only -- group
 * headers (plain text, not links, not collapsible: five groups of three to
 * five items fit without disclosure) and page links underneath.
 *
 * Mobile (base): DESIGN.md §8.10 bans "modal as first thought", and a drawer
 * is a modal with a different animation. Instead the nav renders above the
 * content as a Collapsible (the primitive getting-started.js's
 * CollapsibleSection already uses), closed by default, whose trigger reads
 * "Documentation -- <current page title>" -- orientation for a reader
 * arriving from a search engine, without opening anything. Opening pushes
 * content down; nothing is trapped.
 *
 * Current-page state uses three signals, never color alone: aria-current=
 * "page", fontWeight="medium" + color="fg" (vs fg.muted for the rest), and a
 * 2px left border in brandGreen.border. Nothing shifts position on state
 * change. Focus ring is the theme default on every link -- focusRing="none"
 * is never set here.
 */
function NavLinks({ currentHref, onNavigate }) {
  return (
    <Box as="nav" aria-label="Documentation">
      <Box mb={6}>
        <ChakraLink
          asChild
          fontSize="md"
          fontWeight="medium"
          color="fg"
          _hover={{ textDecoration: "underline" }}
        >
          <NextLink href={GETTING_STARTED_LINK.href} onClick={onNavigate}>
            {GETTING_STARTED_LINK.label}
          </NextLink>
        </ChakraLink>
      </Box>

      {DOCS_NAV.map(({ group, pages }, groupIndex) => {
        const groupId = group
          ? `docs-sidebar-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
          : undefined;

        return (
          <Box key={group ?? `ungrouped-${groupIndex}`} mt={groupIndex === 0 ? 0 : 6}>
            {group && (
              <Text id={groupId} fontSize="sm" fontWeight="600" color="fg.muted" mb={2}>
                {group}
              </Text>
            )}
            <Box as="ul" aria-labelledby={groupId} listStyleType="none" m={0} p={0}>
              {pages.map((page) => {
                const isCurrent = page.href === currentHref;
                return (
                  <Box as="li" key={page.href}>
                    <ChakraLink
                      asChild
                      display="block"
                      fontSize="md"
                      fontWeight={isCurrent ? "medium" : "normal"}
                      color={isCurrent ? "fg" : "fg.muted"}
                      borderLeft="2px solid"
                      borderColor={isCurrent ? "brandGreen.border" : "transparent"}
                      pl={3}
                      py={1}
                      _hover={{ color: "fg", textDecoration: "underline" }}
                    >
                      <NextLink
                        href={page.href}
                        aria-current={isCurrent ? "page" : undefined}
                        onClick={onNavigate}
                      >
                        {page.label}
                      </NextLink>
                    </ChakraLink>
                  </Box>
                );
              })}
            </Box>
          </Box>
        );
      })}

      <Box mt={6}>
        <ChakraLink
          asChild
          fontSize="md"
          fontWeight="medium"
          color="fg"
          _hover={{ textDecoration: "underline" }}
        >
          <NextLink href={PRIVACY_LINK.href} onClick={onNavigate}>
            {PRIVACY_LINK.label}
          </NextLink>
        </ChakraLink>
      </Box>
    </Box>
  );
}

export default function DocsSidebar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const found = findDocsPage(router.pathname);
  const currentTitle = found?.page.label ?? "Documentation";

  return (
    <>
      {/* Mobile: collapsible disclosure, not a drawer. */}
      <Box display={{ base: "block", md: "none" }} w="100%">
        <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
          <Collapsible.Trigger asChild>
            <Button
              variant="outline"
              borderColor="border"
              color="fg"
              size="sm"
              w="100%"
              justifyContent="space-between"
              _hover={{ bg: "bg.muted" }}
            >
              <Text as="span" fontWeight="medium">
                Documentation — {currentTitle}
              </Text>
              {open ? (
                <ChevronDown size={16} aria-hidden="true" />
              ) : (
                <ChevronRight size={16} aria-hidden="true" />
              )}
            </Button>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Box
              mt={3}
              p={4}
              borderWidth="1px"
              borderColor="border"
              rounded="md"
              bg="bg.panel"
            >
              <NavLinks currentHref={router.pathname} onNavigate={() => setOpen(false)} />
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      </Box>

      {/* Desktop: static, always-expanded, sticky alongside the content. */}
      <Box
        as="aside"
        display={{ base: "none", md: "block" }}
        w="240px"
        flexShrink={0}
        position="sticky"
        top="6"
        alignSelf="flex-start"
        maxH="calc(100vh - 2rem)"
        overflowY="auto"
      >
        <NavLinks currentHref={router.pathname} />
      </Box>
    </>
  );
}
