import { Text, Code, Box, Heading, Table } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

export default function WhenAnUploadFailsPage() {
  return (
    <>
      <PageHeader
        title="When an upload fails"
        purpose="What a failed upload means, how DataPipe retries it, and where to find it while it's waiting."
      />

      <Text maxW="70ch">
        <strong>Your file is not lost.</strong> If your storage provider is
        temporarily unavailable or returns an error, DataPipe holds each
        participant&apos;s data, retries the upload automatically, and lets you
        download the file straight from your experiment dashboard at any time in
        the meantime.
      </Text>
      <Text maxW="70ch" mt={4}>
        Your experiment dashboard shows how many uploads are waiting to be
        stored, and the queued files panel lists each one with its status, the
        reason it has not landed yet, and how long DataPipe will keep it.
      </Text>

      <DocsSection id="what-202-means" title="What a 202 means">
        <Text maxW="70ch">
          A submission that DataPipe has accepted but not yet written to your
          storage provider gets HTTP <Code>202</Code> instead of{" "}
          <Code>201</Code>. The body carries <Code>error: null</Code>.
        </Text>
        <Text maxW="70ch">
          <strong>Treat a 202 as success and do not resubmit.</strong> DataPipe
          already has the data and the retry is scheduled; sending it again
          would store the participant&apos;s data twice, under two filenames, or
          fail the second time on a duplicate name. If your experiment code
          retries on non-201 responses, change it to treat any 2xx as success.
        </Text>
        <Text maxW="70ch">
          There are four situations that produce a 202 on{" "}
          <Code>/api/data</Code>:
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>The provider write failed.</strong> The most common case: an
            outage, a rate limit, an expired credential, or a full record.
          </Box>
          <Box as="li" mb={2}>
            <strong>DataPipe could not check the filename.</strong> Its record
            of which filenames are already used could not be rebuilt — usually
            because the container is missing or access was revoked. Rather than
            risk overwriting existing data, the submission is queued.
          </Box>
          <Box as="li" mb={2}>
            <strong>That filename record was being rebuilt.</strong> Another
            request held the rebuild lease, which lasts 60 seconds.
          </Box>
          <Box as="li" mb={2}>
            <strong>An archive merge was in progress.</strong> Compaction is
            rearranging the record right now, so writes are held back rather
            than rejected. These entries carry the code{" "}
            <Code>CONTENTION</Code> and drain in about a minute.
          </Box>
        </Box>
        <Text maxW="70ch">
          A queued submission still counts toward your session limit — it is a
          real session, just not stored yet.
        </Text>
      </DocsSection>

      <DocsSection id="the-retry-schedule" title="The retry schedule">
        <Text maxW="70ch">
          A background worker wakes up <strong>every five minutes</strong> and
          takes up to <strong>25 queued uploads</strong> whose next attempt is
          due, oldest first. It interleaves them across accounts, one per
          account per pass, so one researcher&apos;s broken connection cannot
          hold up everybody else&apos;s data.
        </Text>
        <Text maxW="70ch">
          Each queued upload gets <strong>five attempts</strong>. The wait
          doubles after each failure, starting at one hour:
        </Text>
        <Box overflowX="auto" w="100%">
          <Table.Root variant="outline" size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader color="fg">Attempt</Table.ColumnHeader>
                <Table.ColumnHeader color="fg">Wait before it</Table.ColumnHeader>
                <Table.ColumnHeader color="fg">
                  Time since queueing
                </Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Row>
                <Table.Cell>1</Table.Cell>
                <Table.Cell>1 hour</Table.Cell>
                <Table.Cell>1 hour</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>2</Table.Cell>
                <Table.Cell>2 hours</Table.Cell>
                <Table.Cell>3 hours</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>3</Table.Cell>
                <Table.Cell>4 hours</Table.Cell>
                <Table.Cell>7 hours</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>4</Table.Cell>
                <Table.Cell>8 hours</Table.Cell>
                <Table.Cell>15 hours</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>5</Table.Cell>
                <Table.Cell>16 hours</Table.Cell>
                <Table.Cell>31 hours</Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Box>
        <Text maxW="70ch">
          So an upload that keeps failing runs out of attempts{" "}
          <strong>about 31 hours</strong> after it was queued. The doubling is
          capped at 24 hours, and if your provider sends a{" "}
          <Code>Retry-After</Code> header DataPipe honours it instead, clamped to
          the same 24 hours.
        </Text>
        <Text maxW="70ch">
          <strong>
            Running out of retries is not the same as losing the file.
          </strong>{" "}
          DataPipe keeps the payload for seven days from the moment it was
          queued, so a permanently failed upload stays downloadable from your
          dashboard for roughly five and a half more days after the last attempt.
        </Text>

        <Heading as="h3" fontSize="md" fontWeight="600" color="fg" mt={2}>
          Failures that are handled faster
        </Heading>
        <Text maxW="70ch">
          Two kinds of failure clear far sooner than an outage does, so they get
          their own schedules.
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>Write contention</strong> (<Code>CONTENTION</Code>) — another
            write to the same container is already in flight, which clears in
            seconds. The first attempt is 60 seconds out and the waits are 2, 4,
            8, 16 and 30 minutes, so all five attempts happen inside about 31
            minutes.
          </Box>
          <Box as="li" mb={2}>
            <strong>Expired credentials and provider blips</strong> (
            <Code>AUTH_EXPIRED</Code>, <Code>UNAVAILABLE</Code>) — these cannot
            be told apart from something that has already healed itself, so
            DataPipe takes one look after 60 seconds instead of waiting an hour.
            If that look fails it goes back to the hourly chain above, giving
            five attempts across about 30 hours.
          </Box>
        </Box>
        <Text maxW="70ch">
          Because the worker runs every five minutes, a 60-second wait means the
          attempt lands at the next five-minute tick.
        </Text>
        <Text maxW="70ch">
          One case costs nothing at all: if an archive merge is running on your
          record when the retry comes due, the upload is rescheduled 60 seconds
          later <strong>without using up an attempt</strong>.
        </Text>

        <Heading as="h3" fontSize="md" fontWeight="600" color="fg" mt={2}>
          Uploads that never reported back
        </Heading>
        <Text maxW="70ch">
          If a request is cut off before it can finish — a server restart, a
          memory limit on a very large submission — the participant&apos;s data
          has already been written to DataPipe&apos;s storage, so it is still
          there. A recovery sweep runs <strong>every fifteen minutes</strong>,
          picks up anything that has been sitting for more than fifteen minutes,
          and moves it into the upload queue, where it appears in your dashboard
          and retries like any other queued file.
        </Text>
        <Text maxW="70ch">
          One limitation is worth knowing: a recovered session gets its raw data
          file, but Psych-DS metadata and derived tables are not regenerated for
          it. The raw file is the source of truth, and the next live submission
          re-merges the dataset description.
        </Text>
      </DocsSection>

      <DocsSection id="the-queued-files-panel" title="The queued files panel">
        <Text maxW="70ch">
          Whenever an experiment has uploads waiting, its dashboard shows a
          status line reading{" "}
          <em>&ldquo;N uploads waiting to be stored&rdquo;</em> — as a warning
          while every one of them is still retrying, and as an error as soon as
          any one of them has used up its attempts. The panel below it lists the
          files.
        </Text>
        <Text maxW="70ch">Each row tells you:</Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>Filename</strong> — the name the submission would be stored
            under.
          </Box>
          <Box as="li" mb={2}>
            <strong>Status</strong> — waiting, being uploaded right now, or
            failed, plus when the next retry is due.
          </Box>
          <Box as="li" mb={2}>
            <strong>Reason</strong> — a plain-language description of what went
            wrong.
          </Box>
          <Box as="li" mb={2}>
            <strong>Stored for</strong> — how much of the seven days is left.
          </Box>
        </Box>
        <Text maxW="70ch">
          The panel also has a &ldquo;Why did these uploads fail?&rdquo; section
          listing the common causes, and the download controls described below.
        </Text>
      </DocsSection>

      <DocsSection id="downloading-queued-files" title="Downloading queued files">
        <Text maxW="70ch">
          You never have to wait for a retry to succeed to get your data. Every
          row in the queued files panel has a download button that gives you
          that one file, decrypted, under the filename it was submitted with.
          Text files come back as CSV or JSON; base64 submissions are decoded
          back to the original binary.
        </Text>
        <Text maxW="70ch">
          <strong>Download all as ZIP</strong> collects every queued, in-flight
          and failed file for the experiment into a single archive named after
          the experiment ID. Use it as soon as you see a red status: it costs
          nothing, and it means you hold a copy regardless of what the retries
          do.
        </Text>
        <Text maxW="70ch">
          If a download fails, nothing has been lost — DataPipe still holds the
          file for the rest of its seven days. Try the single-file buttons if
          the ZIP will not build.
        </Text>
        <GuidanceLine href="/docs/api#queue-status" linkText="the API reference">
          The endpoint behind these buttons is documented, if you want to
          script it.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="when-retries-run-out" title="When retries run out">
        <Text maxW="70ch">
          After the fifth failed attempt the upload is marked failed and is not
          tried again. Download it from the dashboard and add it to your{" "}
          Drive folder, Dataverse dataset, or Zenodo deposition by hand. It is
          worth doing promptly: <strong>the file is deleted seven days after
          it was queued</strong>, failed or not.
        </Text>
        <Text maxW="70ch">
          Some failures are permanent immediately, because retrying could never
          help. DataPipe marks these failed on the first pass rather than
          spending five attempts on them:
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>The experiment was finalized while the upload was queued.</strong>{" "}
            Finalizing seals the record permanently, so the file cannot be added
            to it. The data is not lost — download it from the queue panel.
          </Box>
          <Box as="li" mb={2}>
            <strong>The experiment or the owning account no longer exists.</strong>
          </Box>
          <Box as="li" mb={2}>
            <strong>The stored copy could not be read.</strong> Rare, and it
            still appears in the panel with a reason rather than disappearing
            silently.
          </Box>
        </Box>
        <Text maxW="70ch">
          If uploads are failing on every submission rather than occasionally,
          the cause is usually the connection to your storage provider rather
          than the provider being down.
        </Text>
        <GuidanceLine
          href="/docs/providers/connecting#when-a-token-expires"
          linkText="Connecting and reconnecting"
        >
          Expired credentials, and how to restore them, are covered here.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

WhenAnUploadFailsPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
