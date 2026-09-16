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
        When your study is done, you can <strong>finalize</strong> the
        experiment from its dashboard. DataPipe merges every remaining data
        file into a single archive on your storage provider and stops
        accepting new submissions, which makes the dataset easier to share
        and cite. Finalizing can&apos;t be undone, so only do it when
        you&apos;re certain no more data is coming.
      </Text>
      <Text maxW="70ch" mt={4}>
        Finalizing is optional, and right now it applies to Zenodo experiments
        only. An experiment you simply stop using keeps its files exactly as
        they are. Finalizing is for turning a finished collection into one
        tidy, citable object.
      </Text>

      <DocsSection id="what-finalizing-does" title="What finalizing does">
        <Text maxW="70ch">
          Finalizing merges <strong>everything</strong>, every archive created
          during collection plus every file still sitting loose, into one file
          called <Code>datapipe-final.zip</Code>. When it finishes, that
          archive is the only file in your Zenodo deposition.
        </Text>
        <Text maxW="70ch">
          Inside it is the complete folder tree the Psych-DS standard expects,
          with the <Code>data/raw/</Code> paths intact,{" "}
          <Code>dataset_description.json</Code> at the root, and{" "}
          <Code>.psychds-ignore</Code> alongside it. That&apos;s the whole
          point. Zenodo can&apos;t store a slash in a filename, so a Zenodo
          record can&apos;t hold a Psych-DS dataset directly, but a zip can.
          The archive is a valid dataset even though the record around it
          could never have been one.
        </Text>
        <Text maxW="70ch">
          It&apos;s an ordinary zip. Unzip it and you have the dataset. Zenodo
          also previews zip contents on the record page, so a visitor can see
          what&apos;s inside without downloading it.
        </Text>
        <Text maxW="70ch">
          Merging a whole study streams every file through DataPipe and back
          out to your provider, so clicking Finalize starts a background job
          rather than making you wait. The dashboard shows <em>queued</em>,
          then <em>running</em>, then the result.
        </Text>
      </DocsSection>

      <DocsSection
        id="which-providers-support-it"
        title="Which providers support it"
      >
        <Text maxW="70ch">
          <strong>Finalizing is a Zenodo feature today.</strong> It exists to
          work around a limit on how many files a record can hold, and
          Zenodo&apos;s cap of 100 files per record is the only such limit
          DataPipe has to deal with.
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>Zenodo</strong>: supported. Batch archives and loose files
            are merged into one <Code>datapipe-final.zip</Code>.
          </Box>
          <Box as="li" mb={2}>
            <strong>Google Drive</strong>: not needed. Drive has no file-count
            limit, so your folder can hold one file per session indefinitely,
            and it has real folders, so the folder tree is already intact.
          </Box>
          <Box as="li" mb={2}>
            <strong>Dataverse</strong>: not needed, for the same reasons. No
            file-count cap that DataPipe enforces, and real folder support.
          </Box>
          <Box as="li" mb={2}>
            <strong>OSF</strong>: not available. OSF is legacy only, and no new
            experiments can be created on it.
          </Box>
        </Box>
        <Text maxW="70ch">
          The dashboard offers finalizing only where it applies. On Google
          Drive, Dataverse, and OSF experiments, the Finalize section
          isn&apos;t shown at all. When you&apos;re done with one of those,
          just switch the experiment off.
        </Text>
        <GuidanceLine href="/docs/providers" linkText="Choosing a provider">
          The provider differences behind this.
        </GuidanceLine>
      </DocsSection>

      <DocsSection
        id="queued-uploads-must-drain-first"
        title="Queued uploads must drain first"
      >
        <Text maxW="70ch">
          If any upload for the experiment is still queued or in flight,
          DataPipe won&apos;t start finalizing and tells you why:{" "}
          <em>&ldquo;Some uploads are still in flight.&rdquo;</em>
        </Text>
        <Text maxW="70ch">
          This protects your data. Finalizing merges what your storage
          provider holds right now, and a queued upload isn&apos;t there yet.
          Sealing the record now would leave that participant&apos;s data
          outside the final archive for good. Wait for the queued files panel
          to empty, then try again.
        </Text>
        <Text maxW="70ch">
          If an upload gets queued in the brief window between that check and
          the merge finishing, it isn&apos;t dropped. It&apos;s marked failed
          with a message saying the experiment was finalized while it was
          queued, and{" "}
          <strong>
            the file stays downloadable from the queued files panel until its
            retention window ends
          </strong>
          . Download it and add it to your Zenodo deposition by hand.
        </Text>
        <GuidanceLine href="/docs/data/failures" linkText="When an upload fails">
          The queue, its retries, the download controls, and how long a
          queued file is kept.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="it-cannot-be-undone" title="It cannot be undone">
        <Box borderWidth="1px" borderColor="border" bg="bg.muted" rounded="md" p={4} maxW="70ch">
          <Text fontSize="sm">
            <strong>Finalizing is permanent.</strong> There is no
            un-finalize, in the dashboard or anywhere else, and the loose
            files that went into the archive are deleted from your provider
            once the archive is verified.
          </Text>
        </Box>
        <Text maxW="70ch">Once an experiment is finalized:</Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            Data collection is switched off for you. Finalizing turns{" "}
            <em>Accept new data</em> and <em>Accept base64 file uploads</em>{" "}
            off in the same write that seals the record, and the dashboard
            locks both switches from then on.
          </Box>
          <Box as="li" mb={2}>
            Every submission is rejected with{" "}
            <Code>EXPERIMENT_FINALIZED</Code>, no matter what. That check runs
            ahead of the active switch, so the experiment stays closed even if
            something outside the dashboard turns those flags back on.
          </Box>
          <Box as="li" mb={2}>
            Base64 submissions are rejected for the same reason.
          </Box>
          <Box as="li" mb={2}>
            Condition assignment keeps working. A finalized experiment still
            hands out condition numbers if something calls the endpoint.
          </Box>
        </Box>
        <Text maxW="70ch">
          If there&apos;s any chance you&apos;ll collect more data later,
          don&apos;t finalize. Switch the experiment off instead. That stops
          new submissions and leaves every option open.
        </Text>
      </DocsSection>

      <DocsSection
        id="publishing-is-still-your-call"
        title="Publishing is still your call"
      >
        <Text maxW="70ch">
          On Zenodo, finalizing prepares the deposition but doesn&apos;t
          publish it. Publishing the record, and issuing the DOI that comes
          with it, is your decision and happens on Zenodo itself.
        </Text>
        <Text maxW="70ch">
          The same is true everywhere else. DataPipe never publishes anything.
          A Dataverse dataset created through DataPipe stays a draft until you
          publish it, and a Drive folder stays as private as you left it.
          Nothing DataPipe does changes who can see your data.
        </Text>
        <GuidanceLine href="/docs/data#who-can-see-it" linkText="Who can see it">
          Visibility and sharing.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

FinishingAStudyPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
