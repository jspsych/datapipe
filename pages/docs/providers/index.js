import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function ChoosingAProviderPage() {
  return (
    <>
      <PageHeader
        title="Choosing a provider"
        purpose="Compare Google Drive, Zenodo, Dataverse and OSF, and see what changes once you pick one."
      />

      <DocsSection id="comparison" title="Comparing the providers">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="accounts-you-need" title="Accounts you need">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="one-provider-per-experiment" title="One provider per experiment">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="provider-specific-behavior" title="Provider-specific behavior">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="osf" title="OSF">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

ChoosingAProviderPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
