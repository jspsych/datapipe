import { createContext, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@chakra-ui/react";
import Navbar from "../Navbar";
import Footer from "../Footer";
import TestEnvironmentWarning from "../TestEnvironmentWarning";
import DocsSidebar from "./DocsSidebar";
import DocsPager from "./DocsPager";
import { findDocsPage } from "../../lib/docs-nav";

/**
 * DocsLayout
 *
 * The shared shell for every /docs/* page, consumed through Next's per-page
 * `getLayout` (the pattern pages/index.js already uses) rather than wrapping
 * inside _app.js's default <Center>, which cannot hold a sidebar:
 *
 *   Page.getLayout = (page) => <DocsLayout>{page}</DocsLayout>;
 *
 * Structure and measures follow docs IA plan §3.2 / DESIGN.md §4:
 *  - Outer shell mirrors pages/index.js's getLayout (Navbar / content /
 *    Footer / TestEnvironmentWarning guard).
 *  - Content region maxW="1100px" -- the sanctioned wide measure, no new
 *    width introduced.
 *  - Two columns at md+: sidebar 240px flexShrink=0, content flex=1 minW=0.
 *    Prose measure (65-75ch) is enforced per-element inside page content
 *    (GuidanceLine already does this at 70ch) rather than on the whole
 *    column, so tables and CodeBlock can use the full column width and
 *    scroll horizontally in their own container instead of widening the
 *    page.
 *  - Rhythm: DocsSection carries mt={10} between sections itself. No
 *    <Separator> -- spacing carries grouping (DESIGN.md §4).
 */
export const DocsSectionRegistryContext = createContext(null);

export default function DocsLayout({ children }) {
  const router = useRouter();
  const renderedIds = useRef([]);

  const registerSectionId = (id) => {
    renderedIds.current.push(id);
  };

  // Dev-only assertion (docs IA plan §3.4): compares the ids DocsSection
  // actually rendered on this page against DOCS_NAV[...].sections and
  // console.errors on drift. Anchor ids are contract-stable -- the FAQ
  // redirect map and existing /faq#item-N deep links target them -- so a
  // silent rename here would break an inbound link with no signal. Same
  // defensive style as GuidanceLine.js and PageHeader.js.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    const found = findDocsPage(router.pathname);
    const actual = renderedIds.current;
    renderedIds.current = [];

    if (!found) return;

    const expected = found.page.sections.map((section) => section.id);
    const missing = expected.filter((id) => !actual.includes(id));
    const extra = actual.filter((id) => !expected.includes(id));

    if (missing.length || extra.length) {
      console.error(
        `DocsLayout: section id drift on ${router.pathname}. ` +
          `Missing: [${missing.join(", ")}]. Unexpected: [${extra.join(", ")}]. ` +
          "DocsSection ids must match lib/docs-nav.js exactly -- inbound " +
          "anchors (the FAQ redirect map, /faq#item-N deep links) depend on them."
      );
    }
  });

  return (
    <Box minH="100vh" display="flex" flexDirection="column">
      <Navbar />
      <Box flexGrow={1} w="100%">
        <Flex
          maxW="1100px"
          mx="auto"
          px={4}
          py={8}
          gap={8}
          direction={{ base: "column", md: "row" }}
          align="flex-start"
        >
          <DocsSectionRegistryContext.Provider value={registerSectionId}>
            <DocsSidebar />
            <Box as="main" flex="1" minW={0} w="100%">
              {children}
              <DocsPager />
            </Box>
          </DocsSectionRegistryContext.Provider>
        </Flex>
      </Box>
      <Footer />
      {/* Same NEXT_PUBLIC_DEPLOY_ENV gate as pages/_app.js and pages/index.js
          -- this layout bypasses _app.js's default <Center> (see the doc
          comment above), so it repeats the check rather than inheriting
          it. TestEnvironmentWarning itself repeats the check again as a
          second guard. */}
      {Boolean(process.env.NEXT_PUBLIC_DEPLOY_ENV) &&
        process.env.NEXT_PUBLIC_DEPLOY_ENV !== "production" && (
          <TestEnvironmentWarning />
        )}
    </Box>
  );
}
