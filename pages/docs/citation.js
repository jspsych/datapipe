import { Box, Button, Link as ChakraLink, HStack, Text } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";
import NextLink from "next/link";
import PageHeader from "../../components/ui/PageHeader";
import DocsLayout from "../../components/docs/DocsLayout";
import DocsSection from "../../components/docs/DocsSection";
import CodeBlock from "../../components/CodeBlock";
import useCopyToClipboard from "../../lib/use-copy-to-clipboard";
import {
  CITATION,
  CITATION_APA,
  CITATION_BIBTEX,
  CITATION_DOI_URL,
} from "../../lib/citation";

// Prose link, per DESIGN.md §5: brandGreen.fg with a persistent underline, so
// a link is never signalled by color alone.
function ProseLink({ href, external, children }) {
  const style = {
    color: "brandGreen.fg",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  };

  if (external) {
    return (
      <ChakraLink href={href} target="_blank" rel="noopener noreferrer" {...style}>
        {children}
      </ChakraLink>
    );
  }

  return (
    <ChakraLink asChild {...style}>
      <NextLink href={href}>{children}</NextLink>
    </ChakraLink>
  );
}

// The APA reference and its copy button, on the page surface.
//
// The BibTeX entry below uses CodeBlock -- the mode-invariant #111111 code
// specimen with its own icon-only CopyButton -- because a BibTeX entry is
// code: it goes into a .bib file verbatim, and DESIGN.md §1 gives code
// surfaces that ground in both modes. An APA reference is not code. It goes
// into a manuscript as prose, with a real italic journal title that a
// monospace specimen would flatten, so it stays on `bg.subtle` and the button
// is the app's neutral outline (DESIGN.md §5: one primary per screen, every
// other action outline or ghost on gray).
//
// The button carries a visible "Copy" label rather than an icon alone. The
// specimen's icon button sits inside an object that is obviously code with an
// obvious corner affordance; a lone glyph floating over a paragraph of prose
// is not the same affordance, and this page's whole job is that one action.
function CitationPanel({ label, text, children }) {
  const { state, copy } = useCopyToClipboard();

  return (
    <Box
      maxW="70ch"
      bg="bg.subtle"
      borderWidth="1px"
      borderColor="border.subtle"
      p={4}
      borderRadius="md"
    >
      {children}
      <HStack gap={3} mt={3} align="center" flexWrap="wrap">
        <Button
          size="sm"
          variant="outline"
          color="fg"
          borderColor="border"
          _hover={{ bg: "bg.muted" }}
          onClick={() => copy(text)}
        >
          {state === "copied" ? <Check /> : <Copy />}
          Copy {label}
        </Button>
        {/* Always rendered, never conditionally mounted: a live region that
            appears at the same moment its text does is announced
            inconsistently across screen readers. */}
        <Box aria-live="polite" role="status">
          {state === "copied" && (
            <Text fontSize="sm" color="fg.muted">
              Copied
            </Text>
          )}
          {state === "error" && (
            <Text fontSize="sm" color="fg.muted">
              Could not copy. Select the text and copy it manually.
            </Text>
          )}
        </Box>
      </HStack>
    </Box>
  );
}

export default function CitationPage() {
  return (
    <>
      <PageHeader
        title="Citing DataPipe"
        purpose="The paper to cite if you collected data with DataPipe, in APA and BibTeX."
      />

      <DocsSection id="apa" title="APA">
        <Text maxW="70ch">
          If you use DataPipe to collect data, please cite the paper describing
          it. The article is open access.
        </Text>
        <CitationPanel label="APA citation" text={CITATION_APA}>
          {/* Rendered from the same fields the clipboard string is built
              from (lib/citation.js), so the reference you read and the one
              you paste cannot disagree. */}
          <Text fontSize="sm">
            {CITATION.authors} ({CITATION.year}). {CITATION.title}.{" "}
            <em>{CITATION.journal}</em>, {CITATION.volume}({CITATION.issue}),{" "}
            {CITATION.pages}.{" "}
            <ProseLink href={CITATION_DOI_URL} external>
              {CITATION_DOI_URL}
            </ProseLink>
          </Text>
        </CitationPanel>
      </DocsSection>

      <DocsSection id="bibtex" title="BibTeX">
        <Text maxW="70ch">
          The same reference as a BibTeX entry, for a{" "}
          <Text as="span" fontFamily="mono">
            .bib
          </Text>{" "}
          file.
        </Text>
        <Box maxW="70ch">
          <CodeBlock language="bibtex">{CITATION_BIBTEX}</CodeBlock>
        </Box>
      </DocsSection>
    </>
  );
}

CitationPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
