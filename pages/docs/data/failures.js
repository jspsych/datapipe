import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function WhenAnUploadFailsPage() {
  return (
    <>
      <PageHeader
        title="When an upload fails"
        purpose="What a failed upload means, how DataPipe retries it, and where to find it while it's waiting."
      />

      <DocsSection id="what-202-means" title="What a 202 means">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="the-retry-schedule" title="The retry schedule">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="the-queued-files-panel" title="The queued files panel">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="downloading-queued-files" title="Downloading queued files">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="when-retries-run-out" title="When retries run out">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

WhenAnUploadFailsPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
