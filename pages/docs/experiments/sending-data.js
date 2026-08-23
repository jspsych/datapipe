import { Text } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function SendingDataPage() {
  return (
    <>
      <PageHeader
        title="Sending data from your experiment"
        purpose="Send data from a jsPsych experiment or plain JavaScript, and know what each response means."
      />

      <DocsSection id="jspsych" title="jsPsych">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="plain-javascript" title="Plain JavaScript">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="filenames-must-be-unique" title="Filenames must be unique">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="media-and-binary-files" title="Media and binary files">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="request-size-limits" title="Request size limits">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="what-the-response-means" title="What the response means">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

SendingDataPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
