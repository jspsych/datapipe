import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function ConnectingAndReconnectingPage() {
  return (
    <>
      <PageHeader
        title="Connecting and reconnecting"
        purpose="How DataPipe gets permission to write to your storage, and what to do when that permission lapses."
      />

      <DocsSection id="how-permission-works" title="How permission works">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="google-drive" title="Google Drive">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="zenodo" title="Zenodo">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="dataverse" title="Dataverse">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="when-a-token-expires" title="When a token expires">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="reconnecting" title="Reconnecting">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="disconnecting" title="Disconnecting">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

ConnectingAndReconnectingPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
