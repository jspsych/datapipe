import { Text } from "@chakra-ui/react";
import PageHeader from "../../components/ui/PageHeader";
import DocsLayout from "../../components/docs/DocsLayout";
import DocsSection from "../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function AboutDataPipePage() {
  return (
    <>
      <PageHeader
        title="About DataPipe"
        purpose="What DataPipe costs, how it's funded, the risks of using it, and how to cite it."
      />

      <DocsSection id="cost" title="Cost">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="funding" title="Funding">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="risks" title="Risks">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="support" title="Support">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="citing" title="Citing DataPipe">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

AboutDataPipePage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
