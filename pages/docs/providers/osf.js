import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function MovingOffOsfPage() {
  return (
    <>
      <PageHeader
        title="Moving off OSF"
        purpose="OSF is winding down its projects feature — what changes, what happens to data you already collected, and how to move."
      />

      <DocsSection id="what-changes" title="What changes">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="your-existing-data" title="Your existing data">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="how-to-move" title="How to move">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

MovingOffOsfPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
