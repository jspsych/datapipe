import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function PsychDsMetadataPage() {
  return (
    <>
      <PageHeader
        title="Psych-DS metadata"
        purpose="Turn on Psych-DS metadata production and know what it writes, where it comes from, and what it does not affect."
      />

      <DocsSection id="what-gets-written" title="What gets written">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="folder-names-are-flattened" title="Folder names are flattened">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="where-descriptions-come-from" title="Where descriptions come from">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="how-it-merges-across-sessions" title="How it merges across sessions">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="metadata-never-blocks-your-data" title="Metadata never blocks your data">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

PsychDsMetadataPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
