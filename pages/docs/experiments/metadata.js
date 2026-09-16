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
        purpose="What turning on Psych-DS metadata writes, where the descriptions come from, and what it doesn't affect."
      />

      <DocsSection id="what-gets-written" title="What gets written">
        <Box borderWidth="1px" borderColor="border" bg="bg.muted" rounded="md" p={4} maxW="70ch">
          <Text fontSize="sm">
            <strong>Decide before you start collecting.</strong> You can turn
            metadata on or off freely until the first submission arrives.
            After that it&apos;s locked for the life of the experiment. If you
            need to change it later, create a new experiment with the setting
            you want.
          </Text>
        </Box>
        <Text maxW="70ch">
          With metadata on, DataPipe writes a{" "}
          <Code>dataset_description.json</Code> file alongside your data. It
          describes the dataset and every variable in it, in the{" "}
          <ProseLink href="https://psychds-docs.readthedocs.io/en/latest/" external>
            Psych-DS
          </ProseLink>{" "}
          format, and DataPipe rewrites it after each session. Turn it on
          from your experiment dashboard if you plan to share or publish your
          data. It makes the dataset much easier for someone else to read and
          reuse.
        </Text>
        <Text maxW="70ch">
          Turning it on also changes where your files land. Instead of one
          file per session at the top of your Drive folder, Dataverse dataset,
          or Zenodo deposition, each session produces:
        </Text>
        <List.Root maxW="70ch" gap={3} ps={6}>
          <LayoutRow path="data/raw/<your filename>">
            The submission exactly as your experiment sent it, byte for byte.
            This is the file that matters. Everything else is derived from it.
          </LayoutRow>
          <LayoutRow path="data/<name>_data.csv">
            The session&apos;s main data table. A CSV submission keeps its
            original bytes here. A JSON submission is written out as a table.
          </LayoutRow>
          <LayoutRow path="data/<name>_measure-<column>_data.csv">
            One extra table for each column that held nested objects or arrays
            (survey responses, mouse-tracking samples, and the like), so the
            main table stays flat.
          </LayoutRow>
          <LayoutRow path="dataset_description.json">
            At the top level. The description of the dataset and every
            variable in it, rewritten after each session.
          </LayoutRow>
          <LayoutRow path=".psychds-ignore">
            At the top level. Tells Psych-DS validators to skip{" "}
            <Code>data/raw/</Code>, which holds your originals rather than
            Psych-DS tables.
          </LayoutRow>
        </List.Root>
        <Text maxW="70ch">
          With metadata off, none of this happens. DataPipe stores each
          submission at the top level under the filename you sent, and creates
          no other files.
        </Text>
        <Text maxW="70ch">
          That difference in where files land is why the setting locks after
          the first submission. Changing it partway through would leave the
          sessions you already collected in one place and every later session
          in another, and DataPipe&apos;s duplicate detection would no longer
          recognize the earlier files.
        </Text>
        <Text maxW="70ch">
          You won&apos;t get subfolders inside your dataset, whatever
          filenames you send. A Psych-DS dataset keeps a flat{" "}
          <Code>data/</Code> folder, so a filename with a slash in it is
          flattened before the path is built, and Zenodo flattens the{" "}
          <Code>data/raw/</Code> path itself because it has no folders at all.
        </Text>
        <GuidanceLine href="/docs/data/files#what-your-files-are-named" linkText="What your files are named">
          Exactly how a name is flattened, and why a short code is added to
          it.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="where-descriptions-come-from" title="Where descriptions come from">
        <Box borderWidth="1px" borderColor="border" bg="bg.muted" rounded="md" p={4} maxW="70ch">
          <Text fontSize="sm">
            If your metadata says <Code>&quot;unknown&quot;</Code> where you
            expected a description of a variable, this section explains why.
          </Text>
        </Box>
        <Text maxW="70ch">
          For each variable, DataPipe records its data type and, when it can,
          a human-readable description taken from the documentation of the
          jsPsych plugin that produced it.
        </Text>
        <Text maxW="70ch">
          &ldquo;When it can&rdquo; is the important part. DataPipe
          doesn&apos;t ship with a table of descriptions. When a session
          arrives, it fetches the source of each jsPsych plugin from{" "}
          <ProseLink href="https://unpkg.com" external>
            unpkg.com
          </ProseLink>{" "}
          and reads the descriptions out of that source&apos;s documentation
          comments. So descriptions exist only for plugins and extensions
          published to npm under the official jsPsych names.
        </Text>
        <Text maxW="70ch">
          Two things follow from that, and neither one announces itself:
        </Text>
        <List.Root maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Custom, private, renamed, and unpublished plugins have no source
              to fetch.
            </Text>{" "}
            DataPipe describes their variables as{" "}
            <Code>&quot;unknown&quot;</Code> but stores your data normally.
            The variables still appear in the metadata. Only the prose
            descriptions are missing.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              An unpkg outage does the same thing, for that session only.
            </Text>{" "}
            DataPipe makes the fetch while it handles the submission. If the
            fetch fails, that session&apos;s new variables come out as{" "}
            <Code>&quot;unknown&quot;</Code>. DataPipe doesn&apos;t go back
            later to fill them in, but a variable that was already described
            keeps its description.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          <Code>dataset_description.json</Code> is an ordinary file in your
          own storage, so you can write the missing descriptions in yourself.
          Do it <strong>after collection ends</strong>. DataPipe rewrites that
          file from its own copy of the metadata after every session, so the
          next submission would overwrite any edit you made mid-study.
        </Text>
      </DocsSection>

      <DocsSection id="how-it-merges-across-sessions" title="How it merges across sessions">
        <Text maxW="70ch">
          DataPipe also combines information across sessions, such as the
          numeric ranges and categorical values it has seen. The description
          file is never rebuilt from just the newest session. Instead, DataPipe
          merges each session into what&apos;s already there:
        </Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            new values seen for a categorical variable are added to its list of
            levels;
          </List.Item>
          <List.Item>
            a numeric variable&apos;s minimum and maximum widen to cover the
            new session;
          </List.Item>
          <List.Item>
            variables that appear for the first time are added, so a condition
            that only some participants see is still described;
          </List.Item>
          <List.Item>
            variables already described are kept, and nothing is dropped just
            because a later session didn&apos;t contain it.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          Four jsPsych bookkeeping variables (<Code>trial_type</Code>,{" "}
          <Code>trial_index</Code>, <Code>time_elapsed</Code>, and{" "}
          <Code>internal_node_id</Code>) are written once and then left alone,
          since their meaning doesn&apos;t change from session to session.
        </Text>
      </DocsSection>

      <DocsSection id="metadata-never-blocks-your-data" title="Metadata never blocks your data">
        <Text maxW="70ch">
          Metadata is a description of your data, and DataPipe treats it that
          way. The derived tables and <Code>.psychds-ignore</Code> are
          uploaded after your raw file has landed. If one of them fails,
          DataPipe queues and retries it on its own, and the submission still
          succeeds. The <Code>metadataMessage</Code> field on every data
          response reports what happened. It never decides whether a
          submission is accepted.
        </Text>
        <Text maxW="70ch">
          There is one case where metadata affects the response. If DataPipe
          can&apos;t produce metadata from a submission at all, that request
          comes back as a <Code>400</Code> with <Code>METADATA_ERROR</Code>.
          The usual cause is a submission that parses as JSON but isn&apos;t
          an array of trials, because metadata needs the trial array that
          jsPsych produces. Anything that doesn&apos;t parse as JSON is
          treated as CSV instead.
        </Text>
        <Text maxW="70ch">
          Even then, the data itself isn&apos;t lost. DataPipe keeps the copy
          it took when the submission arrived, and a scheduled sweep picks
          that copy up once it&apos;s more than fifteen minutes old and sends
          it to your storage provider. A session recovered this way arrives as
          the raw file only, with no derived tables, so fix the shape of your
          data rather than relying on the sweep.
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
