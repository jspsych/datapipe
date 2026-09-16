import { Text, Code, Box } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

export default function WhatDataPipeStoresPage() {
  return (
    <>
      <PageHeader
        title="What DataPipe stores"
        purpose="What DataPipe keeps, who can see it, what it logs, and how long any of it stays around."
      />

      <DocsSection id="what-datapipe-stores" title="What DataPipe stores">
        <Text maxW="70ch">
          Normally, nothing. DataPipe passes your data to the storage provider
          you connected and keeps no copy. Data goes through DataPipe for
          optional validation and then straight on to your Drive folder,
          Dataverse dataset, or Zenodo deposition.
        </Text>
        <Text maxW="70ch">
          There is one moment in every submission when DataPipe does hold the
          data. Each participant&apos;s data is written to DataPipe&apos;s own
          storage before the write to your provider is attempted, so a crash
          or a timeout mid-request can&apos;t lose it. That copy is deleted as
          soon as the provider write lands, which is normally within the same
          second.
        </Text>
        <Text maxW="70ch">
          The other exception is an upload that fails, because your provider
          is briefly unavailable, is rate-limiting DataPipe, or because a
          filename check couldn&apos;t be completed. In that case DataPipe
          keeps the submission so it can retry the upload automatically, and
          so you can download it yourself from the dashboard in the meantime.
        </Text>
        <Text maxW="70ch">
          A queued upload is encrypted at rest with AES-256-GCM, lives in a
          private storage bucket that no browser or client can read, and is
          deleted at the end of its retention window, described below.
        </Text>
        <GuidanceLine
          href="/docs/data/failures"
          linkText="When an upload fails"
        >
          Retries, the queued files panel, and downloading a queued upload.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="who-can-see-it" title="Who can see it">
        <Text maxW="70ch">
          That&apos;s up to your storage provider&apos;s sharing settings, and
          DataPipe changes none of them. A Google Drive folder is private until
          you share it. A Zenodo deposition stays a private draft until you
          publish it. A Dataverse dataset stays a draft until you publish it,
          and then your installation&apos;s policies decide who can see it.
          DataPipe never reads your data for its own purposes and never writes
          any of it to a log, so the only person who changes who can see your
          data is you.
        </Text>
      </DocsSection>

      <DocsSection id="what-we-log" title="What we log">
        <Text maxW="70ch">
          No participant data is ever written to a log. What DataPipe records
          for each experiment is a small counter document: how many times each
          endpoint was called, and a list of errors.
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <Code>saveData</Code>, <Code>saveBase64Data</Code>, and{" "}
            <Code>getCondition</Code> count calls to the three endpoints your
            experiment uses, and <Code>logError</Code> counts errors.
          </Box>
          <Box as="li" mb={2}>
            An <Code>errors</Code> array holds one entry per error, with a
            timestamp.
          </Box>
        </Box>
        <Text maxW="70ch">
          <strong>The counters count attempts, not stored sessions.</strong> A
          call is counted as soon as a request arrives with the required
          fields, before DataPipe checks whether the experiment exists,
          whether it&apos;s accepting data, whether the session limit is
          reached, or whether the data passes validation. So{" "}
          <Code>saveData</Code> will normally be higher than your
          completed-session count, and the gap doesn&apos;t mean data went
          missing. The session count on the dashboard is the number to trust.
        </Text>
        <Text maxW="70ch">
          <strong>
            An error entry can contain the filename your experiment chose
          </strong>{" "}
          (for example, when a derived metadata file can&apos;t be queued),
          along with the raw text your storage provider returned. Researchers
          often name files after a participant or subject ID. If you treat
          that identifier as sensitive, keep it out of the filename and put it
          inside the data instead.
        </Text>
        <Text maxW="70ch">
          Only the account that owns an experiment can read its log, and log
          documents can never be edited or deleted through the app. The
          security rules allow reading and creating, and nothing else.
        </Text>
      </DocsSection>

      <DocsSection id="retention" title="Retention">
        <Text maxW="70ch">
          The only copy of your data that DataPipe keeps for any length of
          time is a queued upload: a submission that couldn&apos;t reach your
          storage provider yet.
        </Text>
        <Text maxW="70ch">
          <strong>
            A queued upload is kept for seven days after it was queued
          </strong>
          , then deleted along with its queue entry. If DataPipe couldn&apos;t
          deliver the failure notification about it, the window stretches to
          at most fourteen days. The clock starts when the upload was queued,
          not when the last retry ran, and it applies to permanently failed
          uploads exactly as it does to ones still waiting. So an upload that
          runs out of retries after about 31 hours stays downloadable from
          your dashboard for the rest of that week, and then it&apos;s gone.
          Every other mention of a &quot;retention window&quot; in these docs
          means this one.
        </Text>
        <Text maxW="70ch">
          The copy written before each provider write is deleted as soon as
          the submission is handled. Anything left behind by an interrupted
          request is picked up within about fifteen minutes and moved into the
          upload queue, where the seven-day clock starts.
        </Text>
        <Text maxW="70ch">
          Your experiment&apos;s configuration, its session count, and its log
          stay for as long as the experiment does. Deleting your account
          removes all of it, and nothing at all from your storage provider.
        </Text>
        <GuidanceLine
          href="/docs/account#deleting-your-account"
          linkText="Deleting your account"
        >
          What account deletion removes, and what it leaves alone.
        </GuidanceLine>
        <GuidanceLine href="/docs/privacy" linkText="Privacy & information for IRBs">
          Everything on this page plus encryption, jurisdiction, and access,
          written for an IRB protocol.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

WhatDataPipeStoresPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
