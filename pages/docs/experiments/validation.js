import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function ValidationAndSessionLimitsPage() {
  return (
    <>
      <PageHeader
        title="Validation and session limits"
        purpose="How DataPipe checks incoming data before storing it, and how to cap how many sessions an experiment accepts."
      />

      <DocsSection id="how-validation-works" title="How validation works">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="required-fields" title="Required fields">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="rejected-data-is-gone" title="Rejected data is gone">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="validation-with-no-formats-allowed" title="Validation with no formats allowed">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="session-limits" title="Session limits">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="security-posture" title="Security posture">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

ValidationAndSessionLimitsPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
