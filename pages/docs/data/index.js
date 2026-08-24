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
        purpose="What DataPipe keeps, who can see it, what it logs, and how long any of it stays."
      />

      <DocsSection id="what-datapipe-stores" title="What DataPipe stores">
        <Text maxW="70ch">
          Under normal operation, nothing. DataPipe routes your data to the
          storage provider you connected but does not keep a copy. Data passes
          through DataPipe for optional validation and then goes straight to
          your Drive folder, Dataverse dataset, or Zenodo deposition.
        </Text>
        <Text maxW="70ch">
          There is one moment in every submission when DataPipe does hold the
          data: each participant&apos;s data is written to DataPipe&apos;s own
          storage before the write to your provider is attempted, so a crash or
          a timeout mid-request cannot lose it. That copy is deleted as soon as
          the provider write lands, which is normally the same second.
        </Text>
        <Text maxW="70ch">
          The other exception is when an upload fails — because your provider is
          briefly unavailable, or rate-limits DataPipe, or a name check cannot
          be completed. In that case DataPipe keeps the submission so it can
          retry the upload automatically, and so you can download it yourself
          from the dashboard in the meantime.
        </Text>
        <Text maxW="70ch">
          A queued upload is encrypted at rest with AES-256-GCM, lives in a
          private storage bucket no browser or client can read, and is deleted
          seven days after it was queued.
        </Text>
        <GuidanceLine
          href="/docs/data/failures"
          linkText="When an upload fails"
        >
          Retries, the queued files panel, and downloading a queued upload are
          covered here.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="who-can-see-it" title="Who can see it">
        <Text maxW="70ch">
          Your storage provider&apos;s own sharing settings decide, and DataPipe
          changes none of them. A Google Drive folder is private until you share
          it. A Zenodo deposition stays a private draft until you publish it. A
          Dataverse dataset stays a draft until you publish it, and its access is
          then set by your installation&apos;s policies. DataPipe never reads
          your data and never writes any of it to a log, so the only person who
          changes who can see your data is you.
        </Text>
      </DocsSection>

      <DocsSection id="what-we-log" title="What we log">
        <Text maxW="70ch">
          No participant data is ever written to a log. What DataPipe records
          per experiment is a small counter document: how many times each
          endpoint was called, and a list of errors.
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <Code>saveData</Code>, <Code>saveBase64Data</Code> and{" "}
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
          call is counted as soon as a request arrives carrying the required
          fields — before DataPipe checks whether the experiment exists, whether
          it is accepting data, whether the session limit is reached, or whether
          the data passes validation. So <Code>saveData</Code> will normally be
          higher than your completed-session count, and the gap is not a sign
          that data went missing. The session count on the dashboard is the
          number to trust.
        </Text>
        <Text maxW="70ch">
          <strong>
            An error entry can contain the filename your experiment chose
          </strong>{" "}
          — for example when a derived metadata file cannot be queued — along
          with the raw text your storage provider returned. Researchers commonly
          name files after a participant or subject ID, so if you treat that
          identifier as sensitive, keep it out of the filename and put it inside
          the data instead.
        </Text>
        <Text maxW="70ch">
          Only the account that owns an experiment can read its log, and log
          documents can never be edited or deleted through the app — the
          security rules allow reading and creating, and nothing else.
        </Text>
      </DocsSection>

      <DocsSection id="retention" title="Retention">
        <Text maxW="70ch">
          The only copy of your data DataPipe keeps for any length of time is a
          queued upload — a submission that could not reach your storage
          provider yet.
        </Text>
        <Text maxW="70ch">
          <strong>
            A queued upload is deleted seven days after it was queued
          </strong>
          , together with its queue entry. That clock starts when the upload was
          queued, not when the last retry ran, and it applies to permanently
          failed uploads exactly as it does to ones still waiting. So an upload
          that exhausts its retries after about 31 hours still stays downloadable
          from your dashboard for the rest of the seven days, and then it is
          gone.
        </Text>
        <Text maxW="70ch">
          The copy written before each provider write is deleted as soon as the
          submission is handled. Anything left behind by an interrupted request
          is picked up within about fifteen minutes and moved into the upload
          queue, where the seven-day clock starts.
        </Text>
        <Text maxW="70ch">
          Your experiment&apos;s configuration, its session count and its log
          stay for as long as the experiment does. Deleting your account removes
          all of it — and nothing at all from your storage provider.
        </Text>
        <GuidanceLine
          href="/docs/account#deleting-your-account"
          linkText="Deleting your account"
        >
          What account deletion removes, and what it leaves alone.
        </GuidanceLine>
        <GuidanceLine href="/privacy" linkText="Privacy & information for IRBs">
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
