// This route (/docs) does not collide with the repo's top-level docs/
// directory (finalization-spec.md, provider-migration-design.md, brand/logo/)
// -- that directory is never served (Firebase Hosting serves the framework
// build plus public/). The collision is cognitive only: do not move brand
// assets into this route.
import { Text } from "@chakra-ui/react";
import PageHeader from "../../components/ui/PageHeader";
import DocsLayout from "../../components/docs/DocsLayout";
import DocsSection from "../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function DocsOverviewPage() {
  return (
    <>
      <PageHeader
        title="Documentation overview"
        purpose="What DataPipe does, what it deliberately does not do, and where to go next."
      />

      <DocsSection id="how-it-works" title="How it works">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="what-datapipe-does-not-do" title="What DataPipe does not do">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="where-to-start" title="Where to start">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

DocsOverviewPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
