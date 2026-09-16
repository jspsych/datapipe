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

// One storage provider: what it is, where the files land, and the limit that
// will eventually matter. Deliberately no "choose this if" steer -- which
// trade-off matters is the researcher's call, and the limits are the only
// part of it they cannot work out for themselves. Same list, same wording as
// pages/getting-started.js; keep the two in step. Everything else a provider
// does mid-study is #provider-specific-behavior below, so these rows stay
// short enough to compare at a glance on a phone.
function ProviderOption({ name, description, limits }) {
  return (
    <Box maxW="70ch">
      <Text>
        <Text as="span" fontWeight="semibold" color="fg">
          {name}
        </Text>
        {": "}
        {description}
      </Text>
      {limits && (
        <Text fontSize="sm" color="fg.muted" mt={1}>
          <Text as="span" fontWeight="semibold">
            Limits:
          </Text>{" "}
          {limits}
        </Text>
      )}
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
        purpose="Compare Google Drive, Dataverse, and Zenodo, and see how each one handles your files once data starts arriving."
      />

      <DocsSection id="comparison" title="Comparing the providers">
        <Text maxW="70ch">
          DataPipe writes each participant&apos;s data into your own account
          with one of the three storage providers below. The data is yours the
          whole way through. DataPipe only ever asks for permission to add
          files.
        </Text>
        <Stack gap={3} maxW="70ch">
          <ProviderOption
            name="Google Drive"
            description="your own Google Drive. Data lands in a folder in My Drive/DataPipe, or in a parent folder you pick."
            limits="free Google accounts share 15 GB across Drive, Gmail, and Photos. Uploads stop once that is full."
          />
          <ProviderOption
            name="Dataverse"
            description="institutional repositories run by universities and consortia (Harvard Dataverse, Borealis, DataverseNL, and others). Data lands in a draft dataset, in a collection you name."
            limits="your installation sets its own file size and storage limits. API tokens expire, often yearly, and DataPipe cannot renew them. Data stops arriving until you reconnect."
          />
          <ProviderOption
            name="Zenodo"
            description="an open repository run by CERN. Data lands in a deposition that stays private until you publish it, and publishing issues a DOI."
            limits="100 files and 50 GB per record. DataPipe merges completed sessions into archives so a long study stays under the file limit."
          />
        </Stack>
      </DocsSection>

      <DocsSection id="accounts-you-need" title="Accounts you need">
        <Text maxW="70ch">
          You&apos;ll need an account with whichever provider you choose:{" "}
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
          Once you have an account, the next step is giving DataPipe permission
          to write to it.
        </GuidanceLine>
      </DocsSection>

      <DocsSection
        id="one-provider-per-experiment"
        title="One provider per experiment"
      >
        <Text maxW="70ch">
          This choice isn&apos;t permanent. You can use a different provider
          for each experiment, and you can connect more than one provider to
          your account and pick between them whenever you create a new
          experiment.
        </Text>
        <Text maxW="70ch">
          What you can&apos;t do is change the provider of an experiment that
          already exists. Each experiment writes to the one Drive folder,
          Dataverse dataset, or Zenodo deposition that DataPipe created for it.
          To collect the same study somewhere else, create a new experiment on
          the other provider and point your experiment code at the new
          experiment ID. Data you already collected stays where it is.
        </Text>
      </DocsSection>

      <DocsSection
        id="provider-specific-behavior"
        title="Provider-specific behavior"
      >
        <Text maxW="70ch">
          The three providers behave differently once data is arriving. These
          are the differences you&apos;re likely to notice mid-study.
        </Text>

        <BehaviorRow name="Google Drive">
          <Text fontSize="sm" color="fg.muted">
            DataPipe creates one folder per experiment, named after the
            experiment, either under a parent folder you pick or under a folder
            called DataPipe in your Drive. It also creates{" "}
            <Text as="span" fontWeight="semibold">
              data
            </Text>{" "}
            and{" "}
            <Text as="span" fontWeight="semibold">
              data/raw
            </Text>{" "}
            inside it right away, so they&apos;re ready before the first
            participant submits.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            DataPipe sets no file count or file size limit on Drive. The real
            constraint is your account&apos;s own quota. Free Google accounts
            share 15 GB across Drive, Gmail, and Photos, and uploads stop when
            that is full.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Drive allows two files with the same name in the same folder and
            never reports a conflict. That means DataPipe&apos;s own filename
            record, its list of the names an experiment has already used, is
            the only thing preventing a duplicate. Drive stores a file under
            the last part of its name, so two submissions that differ only in
            their folder prefix count as the same name.
          </Text>
        </BehaviorRow>

        <BehaviorRow name="Dataverse">
          <Text fontSize="sm" color="fg.muted">
            DataPipe creates a draft dataset in the collection you name and
            never publishes it. Publishing is your decision.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Dataverse accepts only one write to a dataset at a time. If two
            participants submit at the same moment, Dataverse refuses the
            second write, so DataPipe queues that submission and retries it
            about a minute later instead of failing it.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Dataverse never rejects a duplicate filename. It quietly renames
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
            unless it&apos;s told not to. DataPipe tells it not to on every
            write, but installations older than Dataverse 5.11 ignore that
            instruction without any error. DataPipe checks your
            installation&apos;s version when you create an experiment and
            warns you on the form if it&apos;s too old. JSON data is unaffected
            either way.
          </Text>
        </BehaviorRow>

        <BehaviorRow name="Zenodo">
          <Text fontSize="sm" color="fg.muted">
            DataPipe creates an unpublished deposition and never publishes it.
            The link from your dashboard opens the deposit editor, not a public
            record, and no DOI is minted until you publish.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            A Zenodo record holds at most 100 files and 50 GB. No other
            provider caps the file count. That cap is why DataPipe merges
            completed sessions into archives on Zenodo as collection goes on,
            and why finalizing a study into one archive is a Zenodo-only
            feature.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Zenodo has no folders, so a record with metadata turned on shows
            flattened names rather than a folder tree.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Writing a file that already exists on Zenodo replaces it, with no
            error. DataPipe&apos;s filename record is the only thing standing
            between a repeated filename and a lost session.
          </Text>
        </BehaviorRow>

        <GuidanceLine
          href="/docs/data/files"
          linkText="Filenames, archives and your storage"
        >
          How DataPipe keeps filenames unique, what your files end up named,
          and what the archives in your storage are.
        </GuidanceLine>
      </DocsSection>

    </>
  );
}

ChoosingAProviderPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
