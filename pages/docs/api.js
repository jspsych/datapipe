import { Text } from "@chakra-ui/react";
import PageHeader from "../../components/ui/PageHeader";
import DocsLayout from "../../components/docs/DocsLayout";
import DocsSection from "../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function ApiReferencePage() {
  return (
    <>
      <PageHeader
        title="API reference"
        purpose="Every endpoint your experiment can call, what it returns, and the limits every request runs under."
      />

      <DocsSection id="limits" title="Limits">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="save-text-data" title="Save text data">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="save-base64-data" title="Save base64-encoded data">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="get-condition" title="Get condition assignment">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="responses" title="Responses">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="error-codes" title="Error codes">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="queue-status" title="Queue status">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="finalize" title="Finalize">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

ApiReferencePage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
