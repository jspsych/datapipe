import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function FilenamesArchivesAndYourStoragePage() {
  return (
    <>
      <PageHeader
        title="Filenames, archives and your storage"
        purpose="How DataPipe checks filenames, what happens if you edit your storage during collection, and why archives appear mid-study."
      />

      <DocsSection id="how-filenames-are-checked" title="How filenames are checked">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection
        id="dont-edit-your-storage-during-collection"
        title="Don't edit your storage during collection"
      >
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="what-your-files-are-named" title="What your files are named">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="archives-during-collection" title="Archives during collection">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="file-count-limits" title="File count limits">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

FilenamesArchivesAndYourStoragePage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
