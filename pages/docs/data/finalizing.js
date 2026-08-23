import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function FinishingAStudyPage() {
  return (
    <>
      <PageHeader
        title="Finishing a study"
        purpose="What finalizing an experiment does, which providers support it, and why it can't be undone."
      />

      <DocsSection id="what-finalizing-does" title="What finalizing does">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="which-providers-support-it" title="Which providers support it">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="queued-uploads-must-drain-first" title="Queued uploads must drain first">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="it-cannot-be-undone" title="It cannot be undone">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="publishing-is-still-your-call" title="Publishing is still your call">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

FinishingAStudyPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
