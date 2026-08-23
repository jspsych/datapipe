import { Box, Code, Link as ChakraLink, List, Text } from "@chakra-ui/react";
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

// A file or folder in the Psych-DS layout, as it appears inside the container
// DataPipe created for the experiment. Monospace name, prose explanation --
// a two-column table would not survive a phone, and the layout is short
// enough to read as a list.
function LayoutRow({ path, children }) {
  return (
    <List.Item>
      <Code>{path}</Code>
      <Text mt={1}>{children}</Text>
    </List.Item>
  );
}

export default function PsychDsMetadataPage() {
  return (
    <>
      <PageHeader
        title="Psych-DS metadata"
        purpose="Turn on Psych-DS metadata production and know what it writes, where it comes from, and what it does not affect."
      />

      <DocsSection id="what-gets-written" title="What gets written">
        <Text maxW="70ch">
          When enabled, DataPipe generates a dataset_description.json file
          alongside your data that describes the dataset and its variables
          according to the Psych-DS specification. The file is updated
          automatically as new sessions are uploaded.
        </Text>
        <Text maxW="70ch">
          Metadata production is recommended when you plan to share or publish
          your data because it makes the dataset easier to understand and reuse.
          You can enable it from your experiment dashboard, or read the{" "}
          <ProseLink href="https://psychds-docs.readthedocs.io/en/latest/" external>
            Psych-DS documentation
          </ProseLink>{" "}
          to learn more.
        </Text>
        <Text maxW="70ch">
          Turning it on changes where your files land. Instead of one file per
          session at the top of your folder, dataset or deposition, each session
          produces:
        </Text>
        <List.Root maxW="70ch" gap={3} ps={6}>
          <LayoutRow path="data/raw/<your filename>">
            The submission exactly as your experiment sent it, byte for byte.
            This is the file that matters; everything else is derived from it.
          </LayoutRow>
          <LayoutRow path="data/<name>_data.csv">
            The session&apos;s main data table. A CSV submission keeps its
            original bytes here; a JSON submission is written out as a table.
          </LayoutRow>
          <LayoutRow path="data/<name>_measure-<column>_data.csv">
            One sidecar table per column that held nested objects or arrays —
            survey responses, mouse-tracking samples and the like — so the main
            table stays flat.
          </LayoutRow>
          <LayoutRow path="dataset_description.json">
            At the top of the container: the description of the dataset and
            every variable in it, rewritten after each session.
          </LayoutRow>
          <LayoutRow path=".psychds-ignore">
            At the top of the container: tells Psych-DS validators to skip{" "}
            <Code>data/raw/</Code>, which holds your originals rather than
            Psych-DS tables.
          </LayoutRow>
        </List.Root>
        <Text maxW="70ch">
          With metadata off, none of this happens: each submission is stored at
          the top of the container under the filename you sent, and no other
          files are created.
        </Text>
        <GuidanceLine href="/docs/data/files" linkText="Filenames, archives and your storage">
          Zenodo cannot store folders, so a Zenodo record shows these paths
          flattened into single names.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="folder-names-are-flattened" title="Folder names are flattened">
        <Text maxW="70ch">
          You will not get subfolders inside your dataset, whatever filenames
          you send. If a filename contains a folder — say{" "}
          <Code>condition-A/abc.json</Code> — DataPipe replaces the slash with a
          hyphen before building any path, so the file is stored as{" "}
          <Code>data/raw/condition-A-abc.json</Code> and its derived tables
          follow the same name.
        </Text>
        <Text maxW="70ch">
          This is deliberate: a Psych-DS dataset keeps a flat{" "}
          <Code>data/</Code> folder, and encoding the prefix rather than
          dropping it keeps two participants&apos; files from colliding when
          they share a leaf name in different folders.
        </Text>
      </DocsSection>

      <DocsSection id="where-descriptions-come-from" title="Where descriptions come from">
        <Box borderWidth="1px" borderColor="border" bg="bg.muted" rounded="md" p={4} maxW="70ch">
          <Text fontSize="sm">
            If your metadata says <Code>&quot;unknown&quot;</Code> where you
            expected a description of a variable, this section is almost
            certainly why.
          </Text>
        </Box>
        <Text maxW="70ch">
          For each variable, DataPipe records its data type and, when available,
          a human-readable description from the relevant jsPsych plugin
          documentation.
        </Text>
        <Text maxW="70ch">
          &ldquo;When available&rdquo; is doing real work in that sentence.
          DataPipe does not ship a table of descriptions. At the moment a
          session arrives, it fetches the source of the jsPsych plugin that
          produced each variable from{" "}
          <ProseLink href="https://unpkg.com" external>
            unpkg.com
          </ProseLink>{" "}
          and reads the descriptions out of that source&apos;s documentation
          comments. So descriptions exist only for plugins and extensions
          published to npm under the official jsPsych names.
        </Text>
        <Text maxW="70ch">Two consequences follow, and neither announces itself:</Text>
        <List.Root maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Custom, private, renamed and unpublished plugins have no source to
              fetch.
            </Text>{" "}
            Their variables are described as{" "}
            <Code>&quot;unknown&quot;</Code>. Your data is stored normally and
            the variables still appear in the metadata — only the prose
            descriptions are missing.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              An unpkg outage does the same thing, for that session only.
            </Text>{" "}
            The fetch is made while the submission is being handled; if it
            fails, that session&apos;s new variables come out as{" "}
            <Code>&quot;unknown&quot;</Code>. DataPipe does not go back later to
            fill them in, and a variable already described keeps its
            description.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          <Code>dataset_description.json</Code> is an ordinary file in your own
          storage, so you can write the missing descriptions in yourself. Do it{" "}
          <strong>after collection ends</strong>: DataPipe rewrites that file
          from its own copy of the metadata after every session, so an edit made
          mid-study is overwritten by the next participant.
        </Text>
      </DocsSection>

      <DocsSection id="how-it-merges-across-sessions" title="How it merges across sessions">
        <Text maxW="70ch">
          DataPipe also combines information across sessions, such as observed
          numeric ranges and categorical values. The description file is never
          rebuilt from just the newest session — each one is merged into what is
          already there:
        </Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            new values seen for a categorical variable are added to its list of
            levels;
          </List.Item>
          <List.Item>
            a numeric variable&apos;s minimum is lowered and its maximum raised
            to cover the new session;
          </List.Item>
          <List.Item>
            variables that appear for the first time are appended, so a
            condition that only some participants see is still described;
          </List.Item>
          <List.Item>
            variables already described are kept — nothing is dropped because a
            later session did not contain it.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          Four jsPsych bookkeeping variables — <Code>trial_type</Code>,{" "}
          <Code>trial_index</Code>, <Code>time_elapsed</Code> and{" "}
          <Code>internal_node_id</Code> — are written once and then left alone,
          since their meaning does not change from session to session.
        </Text>
      </DocsSection>

      <DocsSection id="metadata-never-blocks-your-data" title="Metadata never blocks your data">
        <Text maxW="70ch">
          Metadata is a description of your data, and DataPipe treats it that
          way. The derived tables and{" "}
          <Code>.psychds-ignore</Code> are uploaded after your raw file has
          landed, and if one of them fails it is queued and retried on its own
          while the submission still succeeds. The{" "}
          <Code>metadataMessage</Code> field on every data response reports what
          happened; it never decides whether a submission is accepted.
        </Text>
        <Text maxW="70ch">
          There is one case where metadata does affect the response. If DataPipe
          cannot produce metadata from a submission at all, that request comes
          back as a <Code>400</Code> with <Code>METADATA_ERROR</Code>. The usual
          cause is a payload that parses as JSON but is not an array of trials —
          metadata production needs the trial array jsPsych produces. Anything
          that does not parse as JSON is treated as CSV instead.
        </Text>
        <Text maxW="70ch">
          Even then the data itself is not lost. DataPipe keeps the copy it took
          when the submission arrived, and a scheduled sweep picks that copy up
          once it is more than fifteen minutes old and sends it to your storage
          provider. A session recovered this way arrives as the raw file only —
          no derived tables are generated for it — so it is worth fixing the
          shape of your data rather than relying on the sweep.
        </Text>
        <GuidanceLine href="/docs/data/failures" linkText="When an upload fails">
          What DataPipe does with a submission it has accepted but not yet
          delivered.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

PsychDsMetadataPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
