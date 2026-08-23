import { Code, Link as ChakraLink, List, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

// Prose link, per DESIGN.md §5: brandGreen.fg with a persistent underline, so
// a link is never signalled by color alone. Local to this page for the same
// reason pages/index.js keeps its own -- there is no shared prose-link
// primitive yet, and this package owns only page files.
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

export default function CreatingAnExperimentPage() {
  return (
    <>
      <PageHeader
        title="Creating an experiment"
        purpose="Set up a new experiment on DataPipe, from the creation form to the dashboard you'll use to manage it."
      />

      {/* The per-provider form fields below are the ones each provider's
          adapter declares in its own `containerInput` -- gdrive.ts:246,
          dataverse.ts:291-297, zenodo.ts:382-386. lib/provider-config.js
          carries a hand-maintained presentational copy of the same list; the
          adapter is the authority, so check that file when this section is
          revised. */}
      <DocsSection id="create" title="Creating your experiment">
        <Text maxW="70ch">
          Click <strong>New Experiment</strong> in the navigation bar. Pick your
          storage provider at the top of the form and give the experiment a{" "}
          <strong>Title</strong>. The rest of the form changes with the
          provider:
        </Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Google Drive
            </Text>{" "}
            — nothing else is required. To keep the data somewhere specific,
            click <strong>Choose Drive folder</strong> and pick a parent folder.
            Otherwise DataPipe creates the folder in <em>My Drive/DataPipe</em>.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Dataverse
            </Text>{" "}
            — the <strong>collection alias</strong>, which is the short name
            from your collection&apos;s URL, plus the author name, contact
            email, and description that Dataverse requires for every dataset.
            Subject is optional.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Zenodo
            </Text>{" "}
            — the <strong>creator name</strong> and a{" "}
            <strong>description</strong> for the deposition. Affiliation is
            optional.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          Click <strong>Create</strong>. DataPipe makes the folder, dataset, or
          deposition for you and opens the experiment dashboard, which links
          straight to it.
        </Text>
        <Text maxW="70ch">
          A new DataPipe experiment is not accepting data yet. It starts with
          data collection off, validation on, and no session limit, so nothing
          can be submitted until you enable data collection on the dashboard.
        </Text>
        <GuidanceLine href="/docs/providers" linkText="Choosing a provider">
          You pick the provider once per experiment, and it is where every file
          from that experiment lands.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="the-dashboard" title="The dashboard">
        <Text maxW="70ch">
          The dashboard is where you get the experiment ID your code needs,
          watch sessions arrive, and change any setting later. Open it from{" "}
          <ProseLink href="/admin">My Experiments</ProseLink>.
        </Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              The heading
            </Text>{" "}
            shows the experiment&apos;s name, whether it is accepting data, and
            how many sessions have been completed.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Experiment details
            </Text>{" "}
            holds the <strong>experiment ID</strong> — the value your code
            sends with every request — and a link that opens the folder,
            dataset, or deposition in your own storage account.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Data collection
            </Text>
            , <Text as="span" fontWeight="semibold">Validation</Text>,{" "}
            <Text as="span" fontWeight="semibold">Metadata</Text> and{" "}
            <Text as="span" fontWeight="semibold">Finalize</Text> are the
            settings for this experiment. Every one of them can be changed
            while a study is running, except finalizing, which is permanent.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Integration code
            </Text>{" "}
            has ready-to-paste snippets with your experiment ID already filled
            in.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Queued uploads
            </Text>{" "}
            appears only when a submission DataPipe accepted has not reached
            your storage provider yet. An empty dashboard here is the normal
            state.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          The completed-session count is the number of submissions DataPipe
          accepted, including any that are still queued for your provider. It
          is not a count of the files sitting in your storage, and it does not
          include rejected submissions or base64 file uploads.
        </Text>
        <GuidanceLine href="/docs/data/failures" linkText="When an upload fails">
          Queued uploads are retried automatically and can be downloaded
          straight from the dashboard in the meantime.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="renaming" title="Renaming an experiment">
        <Text maxW="70ch">
          You can rename an experiment at any time from the pencil icon beside
          its title, and nothing about data collection changes: the experiment
          ID stays the same, so your code keeps working. The new name is used
          inside DataPipe only. Your storage provider took its folder, dataset
          or deposition name from the title when the experiment was created,
          and it keeps that name — rename it there yourself if you want the two
          to match.
        </Text>
      </DocsSection>

      <DocsSection id="switches" title="The four switches">
        <Text maxW="70ch">
          The <strong>Data collection</strong> section holds four switches.
          Each takes effect immediately, and none of them affects data you have
          already collected.
        </Text>
        <List.Root maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Accept new data
            </Text>{" "}
            — while this is on, your experiment ID accepts submissions from
            participants. Turn it off and every submission is rejected with{" "}
            <Code>DATA_COLLECTION_NOT_ACTIVE</Code>, so leave it off until you
            are ready to recruit.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Accept base64 file uploads
            </Text>{" "}
            — a separate switch, needed only if your experiment sends binary
            files such as audio, video or images.{" "}
            <ProseLink href="/docs/experiments/sending-data#media-and-binary-files">
              Media and binary files
            </ProseLink>
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Assign conditions in sequence
            </Text>{" "}
            — hands each participant the next condition number in order. Set
            how many conditions you have when you turn it on.{" "}
            <ProseLink href="/docs/experiments/conditions">
              Condition assignment
            </ProseLink>
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Stop after a set number of sessions
            </Text>{" "}
            — refuses submissions once the count reaches the limit you set, so
            a study cannot overrun its recruitment target.{" "}
            <ProseLink href="/docs/experiments/validation#session-limits">
              Session limits
            </ProseLink>
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          Two more settings sit below them, each with its own page:{" "}
          <ProseLink href="/docs/experiments/validation">Validation</ProseLink>,
          which is on for every new experiment and checks submissions before
          they reach your provider, and{" "}
          <ProseLink href="/docs/experiments/metadata">Metadata</ProseLink>,
          which describes your data in a standard format as it arrives.
        </Text>
        <GuidanceLine
          href="/docs/experiments/validation#security-posture"
          linkText="Security posture"
        >
          Every switch you turn on widens the path into your storage provider,
          so turn each one off again when collection ends.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

CreatingAnExperimentPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
