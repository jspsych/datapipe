// This route (/docs) does not collide with the repo's top-level docs/
// directory (finalization-spec.md, provider-migration-design.md, brand/logo/)
// -- that directory is never served (Firebase Hosting serves the framework
// build plus public/). The collision is cognitive only: do not move brand
// assets into this route.
import { Box, Link as ChakraLink, List, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../components/ui/PageHeader";
import GuidanceLine from "../../components/ui/GuidanceLine";
import DocsLayout from "../../components/docs/DocsLayout";
import DocsSection from "../../components/docs/DocsSection";
import { DOCS_NAV, GETTING_STARTED_LINK } from "../../lib/docs-nav";

// Prose link, per DESIGN.md §5: brandGreen.fg with a persistent underline, so
// a link is never signalled by color alone. Local to this page for the same
// reason pages/index.js keeps its own -- there is no shared prose-link
// primitive yet, and this package owns only page files.
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

export default function DocsOverviewPage() {
  return (
    <>
      <PageHeader
        title="Documentation overview"
        purpose="What DataPipe does, what it deliberately does not do, and where to go next."
      />

      <DocsSection id="how-it-works" title="How it works">
        <Text maxW="70ch">
          Connect a storage provider — Google Drive, Dataverse, or Zenodo — to
          your DataPipe account, create an experiment, and add a few lines of
          code to the experiment your participants run. Google Drive and Zenodo
          connect in one click; Dataverse asks for an API token from your
          institution&apos;s installation. The{" "}
          <ProseLink href="/getting-started">getting started guide</ProseLink>{" "}
          covers all of it, in order.
        </Text>
        <Text maxW="70ch">There are three moving parts:</Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              The experiment your participants run
            </Text>
            , hosted wherever you put it, sends each participant&apos;s data to
            a DataPipe endpoint with the experiment ID and a filename.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              DataPipe
            </Text>{" "}
            checks the submission against the settings on that experiment —
            whether it is still accepting data, whether the file validates,
            whether the session limit is reached — and passes it on.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Your storage provider
            </Text>{" "}
            receives the file into your own account — the Drive folder,
            Dataverse dataset, or Zenodo deposition DataPipe created for this
            experiment.
          </List.Item>
        </List.Root>
        <GuidanceLine
          href="/docs/providers"
          linkText="Choosing a provider"
        >
          Which provider you connect changes where files land and what happens
          when two of them share a name.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="what-datapipe-does-not-do" title="What DataPipe does not do">
        <Text maxW="70ch" fontWeight="semibold">
          It does not host your experiment.
        </Text>
        <Text maxW="70ch">
          You need a separate service to put the experiment your participants
          run online — GitHub Pages, Netlify, or your university&apos;s web
          hosting. DataPipe only moves data to your storage provider, so you
          never have to set up a server of your own.
        </Text>
        <Text maxW="70ch">
          <ProseLink href="https://pages.github.com/" external>
            GitHub Pages
          </ProseLink>{" "}
          is a free option. Select &quot;project site&quot; and &quot;start
          from scratch&quot; in their guide.
        </Text>
        <GuidanceLine
          href="/getting-started"
          linkText="Getting started guide, step 6"
        >
          Publishing an experiment on GitHub Pages is walked through here.
        </GuidanceLine>

        <Text maxW="70ch" fontWeight="semibold" mt={4}>
          It does not keep your data.
        </Text>
        <Text maxW="70ch">
          Under normal operation, DataPipe routes each participant&apos;s data
          to the storage provider you connected but does not keep a copy. The
          one exception is an upload that fails: DataPipe queues that
          submission, retries it automatically, and lets you download it from
          your experiment dashboard in the meantime.
        </Text>
        <GuidanceLine href="/docs/data" linkText="What DataPipe stores">
          The full account of what is held, for how long, and who can read it.
        </GuidanceLine>
        <GuidanceLine href="/privacy" linkText="Privacy & information for IRBs">
          The page to hand your IRB: architecture, encryption, retention, and
          jurisdiction in one place.
        </GuidanceLine>

        <Text maxW="70ch" fontWeight="semibold" mt={4}>
          It does not analyze your data.
        </Text>
        <Text maxW="70ch">
          DataPipe never interprets, summarizes or scores what a participant
          submitted. The only thing it can add is Psych-DS metadata — a
          description of your dataset and its variables, written alongside the
          data when you turn metadata on.
        </Text>
        <GuidanceLine
          href="/docs/experiments/metadata"
          linkText="Psych-DS metadata"
        >
          What the metadata files contain and how they are built.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="where-to-start" title="Where to start">
        <Text maxW="70ch">
          These pages are in reading order, but each one answers its own
          question — arrive at any of them directly.
        </Text>
        <Box maxW="70ch">
          <ProseLink href={GETTING_STARTED_LINK.href}>
            {GETTING_STARTED_LINK.label}
          </ProseLink>
          <Text fontSize="sm" color="fg.muted">
            Sets up one experiment end to end, from choosing a provider to your
            first test run. Start here if you have not collected data through
            DataPipe before.
          </Text>
        </Box>

        {DOCS_NAV.filter(({ pages }) =>
          pages.some((page) => page.href !== "/docs")
        ).map(({ group, pages }, groupIndex) => (
          <Box key={group ?? `ungrouped-${groupIndex}`} maxW="70ch" mt={2}>
            {group && (
              <Text fontSize="sm" fontWeight="600" color="fg.muted" mb={2}>
                {group}
              </Text>
            )}
            <List.Root gap={2} ps={6}>
              {pages
                .filter((page) => page.href !== "/docs")
                .map((page) => (
                  <List.Item key={page.href}>
                    <ProseLink href={page.href}>{page.label}</ProseLink>
                  </List.Item>
                ))}
            </List.Root>
          </Box>
        ))}
      </DocsSection>
    </>
  );
}

DocsOverviewPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
