import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function CreatingAnExperimentPage() {
  return (
    <>
      <PageHeader
        title="Creating an experiment"
        purpose="Set up a new experiment on DataPipe, from the creation form to the dashboard you'll use to manage it."
      />

      <DocsSection id="create" title="Creating your experiment">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="the-dashboard" title="The dashboard">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="renaming" title="Renaming an experiment">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="switches" title="The four switches">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

CreatingAnExperimentPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
