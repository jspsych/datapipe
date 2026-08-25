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
        purpose="What DataPipe costs, how it's funded, the risks of using it, and where to get help."
      />

      <DocsSection id="cost" title="Cost">
        <Text maxW="70ch">DataPipe is free to use.</Text>
        <Text maxW="70ch">
          The expensive parts of running an online experiment — hosting files
          and storing data — are handled by services you already have access to:
          GitHub Pages for hosting, and Google Drive, Dataverse, or Zenodo for
          storage. DataPipe is a lightweight bridge between them, which makes it
          inexpensive to operate.
        </Text>
      </DocsSection>

      <DocsSection id="funding" title="Funding">
        <Text maxW="70ch">
          DataPipe is hosted on Google Firebase. Current resource consumption is
          less than $1 per month. The{" "}
          <ProseLink
            href="https://opencollective.com/jspsych#category-BUDGET"
            external
          >
            jsPsych Open Collective account
          </ProseLink>{" "}
          has funding reserves to sustain the service, and we keep costs and
          available funds public so you can judge the service&apos;s long-term
          viability. A{" "}
          <ProseLink
            href="https://opencollective.com/jspsych#category-CONTRIBUTE"
            external
          >
            donation of a few dollars
          </ProseLink>{" "}
          covers roughly the lifetime cost of providing DataPipe to one
          researcher.
        </Text>
      </DocsSection>

      <DocsSection id="risks" title="Risks">
        <Text maxW="70ch">There are a few risks to be aware of:</Text>
        <List.Root as="ol" maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Authorization tokens.
            </Text>{" "}
            DataPipe needs permission to write to your storage account, and all
            tokens are stored encrypted. For Google Drive and Zenodo you
            authorize DataPipe directly, and it manages and refreshes those
            tokens for you. For Dataverse you supply an API token, so create one
            specifically for DataPipe and revoke it when you are done collecting
            data. You can disconnect any provider from your account settings at
            any time.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Fake or spam data.
            </Text>{" "}
            As with any online experiment, a technically savvy user could submit
            fabricated data or spam files to your storage. DataPipe provides
            validation rules and session limits to reduce this risk.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Support availability.
            </Text>{" "}
            DataPipe is not a commercial product, and has no dedicated support
            team — the developers of jsPsych maintain it and answer what they
            can. The{" "}
            <ProseLink href="https://github.com/jspsych/datapipe" external>
              source code is open
            </ProseLink>{" "}
            and thoroughly tested, and the service runs on Google Cloud
            infrastructure.
          </List.Item>
        </List.Root>
      </DocsSection>

      <DocsSection id="support" title="Support">
        <Text maxW="70ch">
          If you have a question or a problem, first check the{" "}
          <ProseLink
            href="https://github.com/jspsych/datapipe/issues"
            external
          >
            GitHub repository issues
          </ProseLink>{" "}
          to see whether it has already been answered. If not, post a new issue
          there. If you need to reach the developers directly, the{" "}
          <ProseLink href="/contact">contact page</ProseLink> has an email
          address.
        </Text>
        <Text maxW="70ch">
          If what you need is the reference for the DataPipe paper, that moved
          to <ProseLink href="/docs/citation">Citing DataPipe</ProseLink>.
        </Text>
      </DocsSection>
    </>
  );
}

AboutDataPipePage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
