import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function WhatDataPipeStoresPage() {
  return (
    <>
      <PageHeader
        title="What DataPipe stores"
        purpose="What DataPipe keeps, who can see it, what it logs, and how long any of it stays."
      />

      <DocsSection id="what-datapipe-stores" title="What DataPipe stores">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="who-can-see-it" title="Who can see it">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="what-we-log" title="What we log">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="retention" title="Retention">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

WhatDataPipeStoresPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
