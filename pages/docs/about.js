import { Link as ChakraLink, List, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../components/ui/PageHeader";
import DocsLayout from "../../components/docs/DocsLayout";
import DocsSection from "../../components/docs/DocsSection";

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

export default function AboutDataPipePage() {
  return (
    <>
      <PageHeader
        title="About DataPipe"
        purpose="What DataPipe costs, who pays for it, what could go wrong, and where to get help."
      />

      <DocsSection id="cost" title="Cost">
        <Text maxW="70ch">DataPipe is free to use.</Text>
        <Text maxW="70ch">
          The expensive parts of running an online experiment, hosting the
          experiment and storing the data, are done by services you already
          have: GitHub Pages for hosting, and Google Drive, Dataverse, or
          Zenodo for storage. DataPipe is a small bridge between them, so it
          costs very little to run.
        </Text>
      </DocsSection>

      <DocsSection id="funding" title="Funding">
        <Text maxW="70ch">
          DataPipe runs on Google Firebase and currently costs less than $1 a
          month. The{" "}
          <ProseLink
            href="https://opencollective.com/jspsych#category-BUDGET"
            external
          >
            jsPsych Open Collective
          </ProseLink>{" "}
          holds reserves to keep it running, and we keep both the costs and the
          available funds public so you can judge for yourself how sustainable
          the service is. A{" "}
          <ProseLink
            href="https://opencollective.com/jspsych#category-CONTRIBUTE"
            external
          >
            donation of a few dollars
          </ProseLink>{" "}
          covers roughly what it costs to provide DataPipe to one researcher
          for good.
        </Text>
      </DocsSection>

      <DocsSection id="risks" title="Risks">
        <Text maxW="70ch">
          A few things are worth knowing before you rely on DataPipe. Each
          has its own page.
        </Text>
        <List.Root as="ol" maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Authorization tokens.
            </Text>{" "}
            DataPipe needs permission to write to your storage account, and it
            holds that permission as an encrypted token.{" "}
            <ProseLink href="/docs/account#how-credentials-are-stored">
              How credentials are stored
            </ProseLink>
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Fake or spam data.
            </Text>{" "}
            Anyone who reads your experiment&apos;s code can see its
            experiment ID, and that ID is all it takes to submit.{" "}
            <ProseLink href="/docs/experiments/validation#security-posture">
              Security posture
            </ProseLink>
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Support availability.
            </Text>{" "}
            DataPipe is not a commercial product and has no support team. The
            jsPsych developers maintain it and answer what they can, and the{" "}
            <ProseLink href="https://github.com/jspsych/datapipe" external>
              source code is open
            </ProseLink>
            .
          </List.Item>
        </List.Root>
      </DocsSection>

      <DocsSection id="support" title="Support">
        <Text maxW="70ch">
          If you have a question or run into a problem, start with the{" "}
          <ProseLink
            href="https://github.com/jspsych/datapipe/issues"
            external
          >
            issues on GitHub
          </ProseLink>
          . Someone may have hit the same thing already. If not, open a new
          issue there. To reach the developers directly, use the email address
          on the <ProseLink href="/contact">contact page</ProseLink>.
        </Text>
        <Text maxW="70ch">
          Looking for the reference to the DataPipe paper? It has its own page:{" "}
          <ProseLink href="/docs/citation">Citing DataPipe</ProseLink>.
        </Text>
      </DocsSection>
    </>
  );
}

AboutDataPipePage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
