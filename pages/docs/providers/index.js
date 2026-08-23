import { Box, Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

// Which Zenodo this deployment points at -- "" on production, "sandbox." on
// the test site. Same reasoning as lib/provider-config.js and
// pages/getting-started.js: the test deployment must not send researchers to
// sign up on the live service.
const ZENODO_HOST = `https://${process.env.NEXT_PUBLIC_ZENODO_ENV ?? ""}zenodo.org`;

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

// One storage provider, in the terms a researcher choosing between them
// actually needs: whether it is the right fit, where the data physically ends
// up, how they connect, and the limit that will eventually matter. Moved from
// pages/getting-started.js, with its raw palette steps replaced by semantic
// tokens. The decision sentence leads because that is the only line someone
// skimming for "which one do I pick" needs to read. Plain rows rather than a
// comparison table so it stays readable on a phone.
function ProviderOption({ name, summary, landsIn, connect, limits }) {
  return (
    <Box borderWidth="1px" borderColor="border" borderRadius={8} p={4}>
      <Text fontWeight="semibold" color="fg" mb={1}>
        {name}
      </Text>
      <Text fontSize="sm" mb={3}>
        {summary}
      </Text>
      <Stack gap={1}>
        <Text fontSize="sm" color="fg.muted">
          <Text as="span" fontWeight="semibold">
            Data lands in:
          </Text>{" "}
          {landsIn}
        </Text>
        <Text fontSize="sm" color="fg.muted">
          <Text as="span" fontWeight="semibold">
            Connect with:
          </Text>{" "}
          {connect}
        </Text>
        <Text fontSize="sm" color="fg.muted">
          <Text as="span" fontWeight="semibold">
            Limits:
          </Text>{" "}
          {limits}
        </Text>
      </Stack>
    </Box>
  );
}

// One provider's behavior, in the terms that only show up after collection
// starts: what its own service does with a duplicate name, what it caps, and
// what DataPipe therefore has to do around it.
function BehaviorRow({ name, children }) {
  return (
    <Box maxW="70ch">
      <Text fontWeight="semibold" color="fg" mb={1}>
        {name}
      </Text>
      <Stack gap={2}>{children}</Stack>
    </Box>
  );
}

export default function ChoosingAProviderPage() {
  return (
    <>
      <PageHeader
        title="Choosing a provider"
        purpose="Compare Google Drive, Dataverse, and Zenodo, and see what each one does with your files once data starts arriving."
      />

      <DocsSection id="comparison" title="Comparing the providers">
        <Text maxW="70ch">
          DataPipe writes each participant&apos;s data into your own account
          with one of the three storage providers below. The data is yours
          throughout — DataPipe only ever asks for permission to add files.
        </Text>
        <Stack gap={3} maxW="70ch">
          <ProviderOption
            name="Google Drive"
            summary="Your own Google Drive. Choose this if you want the fewest steps and do not need a citable dataset."
            landsIn="a folder in My Drive/DataPipe, or in a parent folder you pick."
            connect="your Google account, in one click."
            limits="free Google accounts share 15 GB across Drive, Gmail, and Photos. Uploads stop once that is full."
          />
          <ProviderOption
            name="Dataverse"
            summary="Institutional repositories run by universities and consortia — Harvard Dataverse, Borealis, DataverseNL, and others. Choose this if your institution or funder expects data to live there."
            landsIn="a draft dataset, in a collection you name."
            connect="an API token from your institution's installation."
            limits="your installation sets its own file size and storage limits. API tokens expire, often yearly, and DataPipe cannot renew them — data stops arriving until you reconnect."
          />
          <ProviderOption
            name="Zenodo"
            summary="An open repository run by CERN that issues a DOI for every published record. Choose this if you want your data citable without an institutional repository."
            landsIn="a deposition that stays private until you publish it."
            connect="your Zenodo account, in one click."
            limits="100 files and 50 GB per record. DataPipe merges completed sessions into archives so a long study stays under the file limit."
          />
        </Stack>
      </DocsSection>

      <DocsSection id="accounts-you-need" title="Accounts you need">
        <Text maxW="70ch">
          You need an account with whichever provider you choose:{" "}
          <ProseLink href="https://drive.google.com" external>
            Google Drive
          </ProseLink>
          ,{" "}
          <ProseLink href="https://dataverse.org/institutions" external>
            your Dataverse installation
          </ProseLink>
          , or{" "}
          <ProseLink href={ZENODO_HOST} external>
            Zenodo
          </ProseLink>
          .
        </Text>
        <GuidanceLine
          href="/docs/providers/connecting"
          linkText="Connecting and reconnecting"
        >
          Once you have an account, DataPipe needs permission to write to it.
        </GuidanceLine>
      </DocsSection>

      <DocsSection
        id="one-provider-per-experiment"
        title="One provider per experiment"
      >
        <Text maxW="70ch">
          You can use a different provider for each experiment, so this choice
          is not permanent. You can also connect more than one provider to your
          account and pick between them each time you create an experiment.
        </Text>
        <Text maxW="70ch">
          What an experiment cannot do is change provider once it exists. Each
          experiment writes to the one Drive folder, Dataverse dataset, or
          Zenodo deposition DataPipe created for it. To collect the same study
          somewhere else, create a new experiment on the other provider and
          point the experiment your participants run at the new experiment ID —
          data already collected stays where it is.
        </Text>
      </DocsSection>

      <DocsSection
        id="provider-specific-behavior"
        title="Provider-specific behavior"
      >
        <Text maxW="70ch">
          The three providers are not interchangeable once data is arriving.
          These are the differences that show up mid-study.
        </Text>

        <BehaviorRow name="Google Drive">
          <Text fontSize="sm" color="fg.muted">
            DataPipe creates one folder per experiment, named after the
            experiment, either under a parent folder you pick or under a folder
            called DataPipe in your Drive. It creates{" "}
            <Text as="span" fontWeight="semibold">
              data
            </Text>{" "}
            and{" "}
            <Text as="span" fontWeight="semibold">
              data/raw
            </Text>{" "}
            inside it at the same time, so they are ready before the first
            participant submits.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            DataPipe sets no file count or file size limit on Drive. The real
            constraint is your account&apos;s own quota — free Google accounts
            share 15 GB across Drive, Gmail and Photos, and uploads stop when
            that is full.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Drive allows two files with the same name in the same folder and
            never reports a conflict, so DataPipe&apos;s filename record — its
            own list of the names an experiment has used — is the only thing
            preventing a duplicate. Drive stores the file under the last part
            of its name, so two submissions that differ only in their folder
            prefix count as the same name.
          </Text>
        </BehaviorRow>

        <BehaviorRow name="Dataverse">
          <Text fontSize="sm" color="fg.muted">
            DataPipe creates a draft dataset in the collection you name and
            never publishes it. Publishing stays your decision.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Dataverse accepts one write to a dataset at a time. When two
            participants submit at the same moment, the second write is
            refused, so DataPipe queues that submission and retries it about a
            minute later rather than failing it.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Dataverse never rejects a duplicate filename — it silently renames
            the new file instead, so a second{" "}
            <Text as="span" fontWeight="semibold">
              README.md
            </Text>{" "}
            arrives as{" "}
            <Text as="span" fontWeight="semibold">
              README-1.md
            </Text>
            .
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Dataverse converts uploaded CSVs into its own archival .tab format
            unless it is told not to. DataPipe tells it not to on every write,
            but installations older than Dataverse 5.11 ignore that instruction
            with no error. DataPipe checks your installation&apos;s version when
            you create an experiment and warns you on the form if it is too old.
            JSON data is unaffected either way.
          </Text>
        </BehaviorRow>

        <BehaviorRow name="Zenodo">
          <Text fontSize="sm" color="fg.muted">
            DataPipe creates an unpublished deposition and never publishes it.
            The link from your dashboard opens the deposit editor, not a public
            record, and no DOI is minted until you publish.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            A Zenodo record holds at most 100 files and 50 GB — the only
            file-count ceiling among the three providers. It is why DataPipe
            merges completed sessions into archives on Zenodo as collection
            goes on, and why finalizing a study into one archive is a Zenodo
            feature only.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Zenodo has no folders. A file named{" "}
            <Text as="span" fontWeight="semibold">
              data/raw/subject-1.json
            </Text>{" "}
            is stored as{" "}
            <Text as="span" fontWeight="semibold">
              data_raw_subject-1.json
            </Text>
            , so a record with metadata turned on shows flattened names rather
            than a folder tree.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Writing a file that already exists on Zenodo replaces it, with no
            error — DataPipe&apos;s filename record is the only thing standing
            between a repeated filename and a lost session.
          </Text>
        </BehaviorRow>

        <GuidanceLine
          href="/docs/data/files"
          linkText="Filenames, archives and your storage"
        >
          How DataPipe keeps filenames unique, and what the archives in your
          storage are.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="osf" title="OSF">
        <Text maxW="70ch">
          OSF is shutting down its projects feature, so DataPipe can no longer
          create new experiments there. Experiments already collecting on OSF
          keep running for now, and the data already there is untouched.
        </Text>
        <GuidanceLine href="/docs/providers/osf" linkText="Moving off OSF">
          What changes, when, and how to move a study to another provider.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

ChoosingAProviderPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
