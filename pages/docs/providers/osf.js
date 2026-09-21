import { Link as ChakraLink, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";
import { osfSunsetLabel } from "../../../lib/osf-sunset";

// Prose link, per DESIGN.md §5: brandGreen.fg with a persistent underline, so
// a link is never signalled by color alone.
function ProseLink({ href, external, children }) {
  const style = {
    color: "brandGreen.fg",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  };

  if (external) {
    return (
      <ChakraLink href={href} target="_blank" rel="noopener noreferrer" {...style}>
        {children}
      </ChakraLink>
    );
  }

  return (
    <ChakraLink asChild {...style}>
      <NextLink href={href}>{children}</NextLink>
    </ChakraLink>
  );
}

export default function MovingOffOsfPage() {
  // Read from lib/osf-sunset.js rather than restated here, so this page, the
  // dashboard banners, the FAQ and the getting-started guide can never
  // disagree about the date. Tolerates a null date the same way they do:
  // every sentence below still reads correctly when no cutoff is set.
  const osfDeadline = osfSunsetLabel();

  const osfStops = osfDeadline
    ? `DataPipe will stop writing to OSF after ${osfDeadline}.`
    : "DataPipe is winding down its support for OSF.";
  const osfUntil = osfDeadline
    ? "Experiments already collecting keep running until that date."
    : "Experiments already collecting keep running for now.";

  return (
    <>
      <PageHeader
        title="Moving off OSF"
        purpose="OSF is winding down its projects feature. Here is what changes, what happens to data you already collected, and how to move."
      />

      <DocsSection id="what-changes" title="What changes">
        <Text maxW="70ch">
          {osfStops} OSF is shutting down its projects feature, so DataPipe can
          no longer create new experiments there. {osfUntil}
        </Text>
        <Text maxW="70ch">
          There&apos;s no way around this. OSF isn&apos;t offered on the
          new-experiment form, the server rejects a request that asks for it,
          and the database rules refuse the record. Plan on collecting new
          data somewhere else.
        </Text>
        <Text maxW="70ch">
          Everything else about an OSF experiment keeps working while
          it&apos;s still collecting. The endpoints, validation, condition
          assignment, session limits, and metadata all behave as they always
          have.
        </Text>
      </DocsSection>

      <DocsSection id="your-existing-data" title="Your existing data">
        <Text maxW="70ch">
          Data already on OSF isn&apos;t affected. It stays in your OSF
          account, and DataPipe never removes it. That remains true after the
          cutoff, if you disconnect OSF, or if you delete your DataPipe
          account. DataPipe never deletes anything from your storage.
        </Text>
      </DocsSection>

      <DocsSection id="how-to-move" title="How to move">
        <Text maxW="70ch">
          To keep collecting, connect Google Drive, Dataverse, or Zenodo in
          your <ProseLink href="/admin/account">account settings</ProseLink>,
          create a new experiment on that provider, and point your experiment
          code at the new experiment ID. Your existing data doesn&apos;t move.
          If you&apos;re close to finishing a study on OSF, finish it there
          rather than switching partway through.
        </Text>
        <Text maxW="70ch">
          If you do switch mid-study, you&apos;ll end up with two sets of
          files in two places: what OSF already holds, and what the new
          experiment collects from then on. Nothing merges them for you, so
          decide how you&apos;ll combine them before you start.
        </Text>
        <GuidanceLine href="/docs/providers" linkText="Choosing a provider">
          A comparison of the three providers, and what each one does with your
          files.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

MovingOffOsfPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
