import { Text, Code, Box } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

export default function FinishingAStudyPage() {
  return (
    <>
      <PageHeader
        title="Finishing a study"
        purpose="What finalizing an experiment does, which providers support it, and why it can't be undone."
      />

      <Text maxW="70ch">
        When your study is finished, <strong>finalize</strong> the experiment
        from its dashboard. DataPipe merges every remaining data file into a
        single archive on your storage provider and stops accepting new
        submissions, which makes the dataset easier to share and cite.
        Finalizing cannot be undone, so do it only when you are certain no more
        data is coming.
      </Text>
      <Text maxW="70ch" mt={4}>
        Finalizing is optional. An experiment you stop using keeps its files
        exactly as they are; finalizing is for turning a finished collection
        into one tidy, citable object.
      </Text>

      <DocsSection id="what-finalizing-does" title="What finalizing does">
        <Text maxW="70ch">
          Finalizing merges <strong>everything</strong> — every archive created
          during collection, plus every file still sitting loose — into exactly
          one file called <Code>datapipe-final.zip</Code>. When it finishes,
          that archive is the only file in your Zenodo deposition.
        </Text>
        <Text maxW="70ch">
          Inside it is the complete folder tree the Psych-DS standard expects,
          with the <Code>data/raw/</Code> paths intact,{" "}
          <Code>dataset_description.json</Code> at the root and{" "}
          <Code>.psychds-ignore</Code> alongside it. That is the point of doing
          it: a provider that cannot store a slash in a filename cannot hold a
          Psych-DS dataset, but a zip can, so the archive is a valid dataset even
          though the record it sits in could never have been one.
        </Text>
        <Text maxW="70ch">
          It is an ordinary zip. Unzip it and you have the dataset. Zenodo also
          previews zip contents on the record page, so a visitor can see what is
          inside without downloading it.
        </Text>
        <Text maxW="70ch">
          Merging a whole study streams every file through DataPipe and back out
          to your provider, so clicking Finalize starts a background job rather
          than waiting for the answer. The dashboard shows <em>queued</em>, then{" "}
          <em>running</em>, then the result.
        </Text>
      </DocsSection>

      <DocsSection
        id="which-providers-support-it"
        title="Which providers support it"
      >
        <Text maxW="70ch">
          <strong>Finalizing is a Zenodo feature today.</strong> It exists to
          relieve a file-count ceiling, and Zenodo&apos;s cap of 100 files per
          record is the only one DataPipe has to work around.
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>Zenodo</strong> — supported. Batch archives and loose files
            are merged into one <Code>datapipe-final.zip</Code>.
          </Box>
          <Box as="li" mb={2}>
            <strong>Google Drive</strong> — not applicable. Drive imposes no
            file-count limit, so there is no ceiling to relieve; your folder can
            hold a session per file indefinitely, and it stores real folders, so
            the folder tree is already intact.
          </Box>
          <Box as="li" mb={2}>
            <strong>Dataverse</strong> — not applicable, for the same reason: no
            file-count cap that DataPipe enforces, and real folder support.
          </Box>
          <Box as="li" mb={2}>
            <strong>OSF</strong> — not applicable. OSF is legacy only and no new
            experiments can be created on it.
          </Box>
        </Box>
        <Text maxW="70ch">
          Clicking Finalize on an experiment that is not eligible does nothing
          destructive — the dashboard reports{" "}
          <em>&ldquo;This experiment can&apos;t be finalized&rdquo;</em> and
          your files are untouched. On Google Drive and Dataverse, switching the
          experiment off when you are done is the equivalent step.
        </Text>
        <GuidanceLine href="/docs/providers" linkText="Choosing a provider">
          The per-provider differences behind this are summarized here.
        </GuidanceLine>
      </DocsSection>

      <DocsSection
        id="queued-uploads-must-drain-first"
        title="Queued uploads must drain first"
      >
        <Text maxW="70ch">
          If any upload for the experiment is still queued or in flight,
          DataPipe refuses to start finalizing and tells you so:{" "}
          <em>&ldquo;Some uploads are still in flight.&rdquo;</em>
        </Text>
        <Text maxW="70ch">
          This is a protection, not an error. Finalizing merges what your storage
          provider currently holds, and a queued upload is by definition not
          there yet — sealing the record now would leave that participant&apos;s
          data outside the final archive permanently. Wait for the queued files
          panel to empty, then try again.
        </Text>
        <Text maxW="70ch">
          If an upload does get queued in the narrow window between that check
          and the merge completing, it is not silently dropped: it is marked
          failed with a message telling you the experiment was finalized while
          it was queued, and{" "}
          <strong>
            the file stays downloadable from the queued files panel until seven
            days after it was queued
          </strong>
          . Download it and add it to your Zenodo deposition by hand.
        </Text>
        <GuidanceLine href="/docs/data/failures" linkText="When an upload fails">
          The queue, its retries and the download controls are covered here.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="it-cannot-be-undone" title="It cannot be undone">
        <Box borderWidth="1px" borderColor="border" bg="bg.muted" rounded="md" p={4} maxW="70ch">
          <Text fontSize="sm">
            <strong>Finalizing is permanent.</strong> There is no un-finalize,
            in the dashboard or anywhere else, and the loose files that went
            into the archive are deleted from your provider once the archive is
            verified.
          </Text>
        </Box>
        <Text maxW="70ch">Once an experiment is finalized:</Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            Every submission is rejected with{" "}
            <Code>EXPERIMENT_FINALIZED</Code>, whether or not the experiment is
            still switched on. That check runs ahead of the active switch, so
            turning the experiment back on does not reopen it.
          </Box>
          <Box as="li" mb={2}>
            Base64 submissions are rejected on the same grounds.
          </Box>
          <Box as="li" mb={2}>
            Condition assignment keeps working: a finalized experiment still
            hands out condition numbers if something calls the endpoint.
          </Box>
        </Box>
        <Text maxW="70ch">
          If you might collect more data later, do not finalize. Switch the
          experiment off instead: that stops new submissions and leaves every
          option open.
        </Text>
      </DocsSection>

      <DocsSection
        id="publishing-is-still-your-call"
        title="Publishing is still your call"
      >
        <Text maxW="70ch">
          On Zenodo, finalizing prepares the deposition but does not publish it.
          Publishing the record, and with it issuing the DOI, stays your
          decision and happens on Zenodo itself.
        </Text>
        <Text maxW="70ch">
          The same holds everywhere else: DataPipe never publishes anything. A
          Dataverse dataset created through DataPipe stays a draft until you
          publish it, and a Drive folder stays as private as you left it.
          Nothing DataPipe does changes who can see your data.
        </Text>
        <GuidanceLine href="/docs/data#who-can-see-it" linkText="Who can see it">
          Visibility and sharing are covered here.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

FinishingAStudyPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
