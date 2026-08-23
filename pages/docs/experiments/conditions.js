import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function ConditionAssignmentPage() {
  return (
    <>
      <PageHeader
        title="Condition assignment"
        purpose="How DataPipe assigns participants to conditions, and what it deliberately does not do."
      />

      <DocsSection id="how-many-conditions" title="How many conditions">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="what-it-is-not" title="What it is not">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="factorial-designs" title="Factorial designs">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

ConditionAssignmentPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
