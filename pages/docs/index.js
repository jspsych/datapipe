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
        purpose="What DataPipe does, what it leaves to other tools, and where to read next."
      />

      <GuidanceLine href="/docs/whats-changed" linkText="What's changed" mb={6}>
        DataPipe had a large update in September 2026. If you used DataPipe
        before, start there.
      </GuidanceLine>

      <DocsSection id="how-it-works" title="How it works">
        <Text maxW="70ch">
          DataPipe takes the data your participants produce and puts it in
          storage you already own. You connect Google Drive, Dataverse, or
          Zenodo to your DataPipe account, create an experiment, and add a few
          lines of code to the experiment your participants run. Google Drive
          and Zenodo connect in one click. Dataverse asks for an API token from
          your institution&apos;s installation. The{" "}
          <ProseLink href="/getting-started">getting started guide</ProseLink>{" "}
          walks through all of it in order.
        </Text>
        <Text maxW="70ch">Three things are involved:</Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Your experiment
            </Text>
            , hosted wherever you like, sends each participant&apos;s data to
            DataPipe along with your experiment ID and a filename.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              DataPipe
            </Text>{" "}
            checks the submission against your experiment&apos;s settings. Is
            it still accepting data? Does the file pass validation? Is the
            session limit reached? If everything checks out, DataPipe passes
            the file along.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Your storage provider
            </Text>{" "}
            receives the file into your own account, in the Drive folder,
            Dataverse dataset, or Zenodo deposition that DataPipe created for
            this experiment.
          </List.Item>
        </List.Root>
        <GuidanceLine
          href="/docs/providers"
          linkText="Choosing a provider"
        >
          The provider you pick decides where files land and what happens if
          two of them share a name.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="what-datapipe-does-not-do" title="What DataPipe does not do">
        <Text maxW="70ch" fontWeight="semibold">
          It doesn&apos;t host your experiment.
        </Text>
        <Text maxW="70ch">
          You still need somewhere to put the experiment itself online, such
          as GitHub Pages, Netlify, or your university&apos;s web hosting.
          DataPipe handles only the data. That&apos;s what lets you skip
          running a server of your own.
        </Text>
        <Text maxW="70ch">
          <ProseLink href="https://pages.github.com/" external>
            GitHub Pages
          </ProseLink>{" "}
          is a free option. In their guide, pick &quot;project site&quot; and
          &quot;start from scratch&quot;.
        </Text>
        <GuidanceLine
          href="/getting-started"
          linkText="Getting started guide, step 6"
        >
          A step-by-step walkthrough of publishing on GitHub Pages.
        </GuidanceLine>

        <Text maxW="70ch" fontWeight="semibold" mt={4}>
          It doesn&apos;t keep your data.
        </Text>
        <Text maxW="70ch">
          Normally DataPipe passes each participant&apos;s data straight to
          your storage provider and keeps no copy. The one exception is an
          upload that fails. DataPipe holds that submission, retries it on its
          own, and lets you download it from your experiment dashboard while
          you wait.
        </Text>
        <GuidanceLine href="/docs/data" linkText="What DataPipe stores">
          Exactly what is held, for how long, and who can read it.
        </GuidanceLine>
        <GuidanceLine href="/docs/privacy" linkText="Privacy & information for IRBs">
          The page to hand your IRB: architecture, encryption, retention, and
          jurisdiction in one place.
        </GuidanceLine>

        <Text maxW="70ch" fontWeight="semibold" mt={4}>
          It doesn&apos;t analyze your data.
        </Text>
        <Text maxW="70ch">
          DataPipe never interprets, summarizes, or scores what a participant
          submitted. The only thing it can add is Psych-DS metadata, a
          description of your dataset and its variables that is written
          alongside the data when you turn that option on.
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
          The pages below are in reading order, but each one stands on its
          own. Jump to whichever answers your question.
        </Text>
        <Box maxW="70ch">
          <ProseLink href={GETTING_STARTED_LINK.href}>
            {GETTING_STARTED_LINK.label}
          </ProseLink>
          <Text fontSize="sm" color="fg.muted">
            Sets up one experiment end to end, from choosing a provider to your
            first test run. Start here if you haven&apos;t used DataPipe
            before.
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
