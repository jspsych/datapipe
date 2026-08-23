import { Text, Code, Box, Table } from "@chakra-ui/react";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

export default function FilenamesArchivesAndYourStoragePage() {
  return (
    <>
      <PageHeader
        title="Filenames, archives and your storage"
        purpose="How DataPipe checks filenames, what happens if you edit your storage during collection, and why archives appear mid-study."
      />

      <DocsSection
        id="how-filenames-are-checked"
        title="How filenames are checked"
      >
        <Text maxW="70ch">
          Every file DataPipe stores must have a name no other submission has
          used. That is what stops a participant who submits twice — or a
          duplicate request from a flaky connection — from overwriting data you
          have already collected.
        </Text>
        <Text maxW="70ch">
          <strong>
            The check is DataPipe&apos;s, not your storage provider&apos;s.
          </strong>{" "}
          Most providers will happily accept the same name twice, each in its
          own way, so DataPipe keeps its own record of the names an experiment
          has used and consults that first.
        </Text>
        <Text maxW="70ch">
          The record does not contain your filenames. Each name is hashed with a
          per-experiment secret and only the hash is stored, so the list of
          names your participants&apos; files were given is not something
          DataPipe holds. Entries last 90 days from the submission that created
          them.
        </Text>
        <Text maxW="70ch">What your experiment sees:</Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>The name is already taken</strong> —{" "}
            <Code>400 OSF_FILE_EXISTS</Code>. Nothing is stored, and the
            participant&apos;s submission is rejected. Give each submission a
            name you know is unique, such as one built from a random ID.
          </Box>
          <Box as="li" mb={2}>
            <strong>The record is being rebuilt right now</strong> —{" "}
            <Code>202</Code>. Another request holds the rebuild lease, which
            lasts 60 seconds; the submission is queued and lands shortly after.
          </Box>
          <Box as="li" mb={2}>
            <strong>The record cannot be rebuilt</strong> — <Code>202</Code>.
            DataPipe could not list your container, usually because it was
            deleted or access was revoked. Rather than risk overwriting real
            data it queues the submission and retries.
          </Box>
        </Box>
        <Text maxW="70ch">
          A name reserved by a submission that never completed is released after
          fifteen minutes, so an interrupted request does not block that name
          forever.
        </Text>
      </DocsSection>

      <DocsSection
        id="dont-edit-your-storage-during-collection"
        title="Don't edit your storage during collection"
      >
        <Text maxW="70ch">
          Please don&apos;t. While an experiment is active, treat its storage
          location as belonging to DataPipe: let DataPipe write to it, and
          download from it as much as you like, but avoid uploading, renaming,
          or deleting files there yourself until collection is finished.
        </Text>
        <Text maxW="70ch">
          DataPipe keeps its own record of which filenames it has already used,
          so that a participant who submits twice cannot overwrite existing
          data. Files that appear without DataPipe writing them are missing from
          that record. Depending on the storage provider, the next submission
          that happens to use the same name may then be silently renamed or may
          overwrite what you added.
        </Text>
        <Text maxW="70ch">
          What that looks like differs by provider, and none of them is a clean
          error:
        </Text>
        <Box overflowX="auto" w="100%">
          <Table.Root variant="outline" size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader color="fg">Provider</Table.ColumnHeader>
                <Table.ColumnHeader color="fg">
                  What happens to a name DataPipe does not know about
                </Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Row>
                <Table.Cell>Google Drive</Table.Cell>
                <Table.Cell>
                  Both files are kept. Drive allows duplicate names in a folder
                  and never reports a conflict, so you are left with two files
                  with the same name and no indication which is which.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>Dataverse</Table.Cell>
                <Table.Cell>
                  The new file is silently renamed — <Code>README.md</Code>{" "}
                  becomes <Code>README-1.md</Code>. Nothing is lost, but the
                  stored name is no longer the one your experiment asked for.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>Zenodo</Table.Cell>
                <Table.Cell>
                  The existing file is overwritten. A Zenodo write replaces
                  whatever is at that key and reports no conflict, so the file
                  you added by hand is gone.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>OSF (legacy)</Table.Cell>
                <Table.Cell>
                  The write is refused with a real name conflict. OSF is the only
                  provider that reports one.
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Box>
        <Text maxW="70ch">
          Files you added by hand do become visible to DataPipe eventually: if
          its filename record ever has to be rebuilt from your container, it
          reads whatever is there and adopts those names as taken. That is not
          something you can trigger, so it is not a fix — it just means the
          window in which a hand-added file is invisible is bounded rather than
          permanent.
        </Text>
      </DocsSection>

      <DocsSection id="what-your-files-are-named" title="What your files are named">
        <Text maxW="70ch">
          Usually the name your experiment sent. Two rules can change it, and
          both are worth knowing before you go looking for a file.
        </Text>
        <Text maxW="70ch">
          <strong>Slashes in a filename do not create folders.</strong> When
          Psych-DS metadata is on, a name like{" "}
          <Code>condition-A/abc.json</Code> is flattened with hyphens before the
          path is built, so it is stored at{" "}
          <Code>data/raw/condition-A-abc.json</Code>. The prefix is kept rather
          than discarded, so two submissions with the same leaf name in
          different pseudo-folders still do not collide.
        </Text>
        <Text maxW="70ch">
          <strong>Zenodo cannot store a slash at all.</strong> Its keyspace is
          flat, so every remaining <Code>/</Code> becomes an underscore:{" "}
          <Code>data/raw/subject-1.json</Code> is stored as{" "}
          <Code>data_raw_subject-1.json</Code>. If you open a metadata-enabled
          Zenodo deposition mid-study and find a flat list of underscore names
          instead of a <Code>data/raw/</Code> tree, this is why — nothing has
          gone wrong. The real Psych-DS directory structure exists inside the
          archives described below, where DataPipe controls the paths.
        </Text>
        <Text maxW="70ch">
          One consequence on Google Drive: only the last segment of a slashed
          name is used, so <Code>condition-A/abc.json</Code> and{" "}
          <Code>condition-B/abc.json</Code> are treated as the same name. Give
          files distinct leaf names rather than distinct prefixes.
        </Text>
      </DocsSection>

      <DocsSection
        id="archives-during-collection"
        title="Archives during collection"
      >
        <Text maxW="70ch">
          If you open a Zenodo deposition partway through a study and find files
          named <Code>datapipe-batch-0001.zip</Code>, nothing has gone wrong and
          nothing has been lost. Your sessions are inside them.
        </Text>
        <Text maxW="70ch">
          Zenodo allows <strong>100 files per record</strong>. A study that
          writes several files per session would hit that ceiling long before it
          finished collecting, so once a record reaches{" "}
          <strong>80 of its 100 files</strong> DataPipe merges older sessions
          into a zip and removes the originals. The{" "}
          <strong>five most recent sessions are left loose</strong> so you can
          still open and spot-check recent data in Zenodo&apos;s own interface.
          Each archive holds at most 95 files or 150 MB, whichever comes first.
        </Text>
        <Text maxW="70ch">
          Two files are never archived:{" "}
          <Code>dataset_description.json</Code>, which is your dataset&apos;s
          Psych-DS descriptor and should stay visible on the record, and{" "}
          <Code>.psychds-ignore</Code>, which is rewritten on every submission
          anyway.
        </Text>
        <Text maxW="70ch">
          <strong>Nothing is deleted until the archive is verified.</strong>{" "}
          DataPipe uploads the zip, compares the checksum Zenodo reports back
          against the one it computed, records the names now held inside the
          archive, and only then deletes the originals. If the checksum cannot
          be verified, the originals stay where they are.
        </Text>
        <Text maxW="70ch">
          There is no schedule for this — a merge is triggered by your record
          growing, not by a timer, so it happens when it is needed rather than
          up to an interval late. While a merge is running, submissions are{" "}
          <strong>queued rather than rejected</strong>: your participants still
          get a success response, and the queued files land about a minute
          later.
        </Text>
        <Text maxW="70ch">
          The archives are ordinary zip files. Unzip one and you get the
          Psych-DS tree back, complete with the{" "}
          <Code>data/raw/</Code> paths that Zenodo itself cannot represent.
          Zenodo also previews zip contents on the record page, so you can see
          what is in an archive without downloading it.
        </Text>
        <GuidanceLine href="/docs/data/finalizing" linkText="Finishing a study">
          At the end of collection every batch is merged into one final
          archive.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="file-count-limits" title="File count limits">
        <Text maxW="70ch">
          On providers with a limit on how many files one project can hold —
          Zenodo allows 100 — DataPipe combines older sessions into archives to
          stay under it. Files added by hand count toward that limit, and can
          fill the project faster than DataPipe expects.
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>Zenodo</strong> — 100 files and 50 GB per record. This is
            the only file-count ceiling DataPipe works around, and the reason
            archives exist.
          </Box>
          <Box as="li" mb={2}>
            <strong>Google Drive</strong> — no file-count limit that matters
            here. The real constraint is your account&apos;s storage quota,
            which on a free Google account is 15 GB shared across Drive, Gmail
            and Photos.
          </Box>
          <Box as="li" mb={2}>
            <strong>Dataverse</strong> — file size and storage limits are set by
            the installation hosting your dataset, and are not readable through
            its API, so DataPipe does not enforce a number of its own.
          </Box>
        </Box>
        <Text maxW="70ch">
          <strong>If a Zenodo record does fill up completely</strong>, DataPipe
          needs one free slot to upload the archive that would relieve it. It
          takes that slot by temporarily removing{" "}
          <Code>.psychds-ignore</Code> — a file whose contents are a fixed
          constant — and writes it back afterwards. An experiment that is not
          producing Psych-DS metadata has no such file to give up, so in that
          case archiving stops and asks for a hand:{" "}
          <strong>remove one file from the record yourself</strong> and it will
          proceed on the next submission.
        </Text>
      </DocsSection>
    </>
  );
}

FilenamesArchivesAndYourStoragePage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
