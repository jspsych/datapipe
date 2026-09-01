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

export default function ValidationAndSessionLimitsPage() {
  return (
    <>
      <PageHeader
        title="Validation and session limits"
        purpose="How DataPipe checks incoming data before storing it, and how to cap how many sessions an experiment accepts."
      />

      <DocsSection id="how-validation-works" title="How validation works">
        <Text maxW="70ch">
          Validation checks each submission before DataPipe sends it to your
          storage provider, and rejects anything that does not match the rules
          you set. You can require a file to be well-formed JSON or CSV, and you
          can list columns or fields it must contain.
        </Text>
        <Text maxW="70ch">
          <strong>Validation is on for every new experiment</strong>, with JSON
          and CSV both allowed and one required field:{" "}
          <Code>trial_type</Code>. That is the usual reason a first test
          submission comes back rejected — data that is not jsPsych output has
          no <Code>trial_type</Code> column, so it fails the check until you
          edit or clear the required fields on the dashboard.
        </Text>
        <Text maxW="70ch">
          A submission passes if it is well-formed in <em>either</em> of the
          formats you allow. A rejection is a <Code>400</Code> carrying{" "}
          <Code>INVALID_DATA</Code>: &ldquo;The data are not valid according to
          the validation parameters set for this experiment.&rdquo; DataPipe
          does not say which check failed, so test a real session yourself
          before you recruit.
        </Text>
      </DocsSection>

      <DocsSection id="required-fields" title="Required fields">
        <Text maxW="70ch">
          Required fields are matched against the top level of your data only. A
          field nested inside another object does not satisfy the requirement,
          however deep it is.
        </Text>
        <List.Root maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              JSON, as an array
            </Text>{" "}
            — the usual shape for jsPsych output. DataPipe collects the keys
            from every object in the array and requires each of your fields to
            appear in at least one of them. A field that only one trial carries
            still counts as present.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              JSON, as a single object
            </Text>{" "}
            — the required fields must be keys of that object.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              CSV
            </Text>{" "}
            — required fields are checked against the header row only, so a
            column that exists but is empty in every row still passes. CSV has
            one extra rule of its own: <strong>every row must have the same
            number of cells as the first row</strong>. A ragged file is rejected
            even when you have listed no required fields at all — an unquoted
            comma inside a response is the usual culprit.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          On the dashboard, type a name and press Enter or comma to add it, or
          paste a comma-separated list in one go. Each name becomes a chip
          showing exactly the text that will be matched, so a stray space or a
          pasted quote is visible before it costs you a session. Remove every
          chip and DataPipe checks only that the file is well-formed.
        </Text>
      </DocsSection>

      <DocsSection id="rejected-data-is-gone" title="Rejected data is gone">
        <Box borderWidth="1px" borderColor="border" bg="bg.muted" rounded="md" p={4} maxW="70ch">
          <Text fontSize="sm">
            <strong>Rejected data cannot be recovered.</strong> An invalid file
            never reaches your storage provider, never enters the upload queue,
            and never appears on your dashboard. There is nothing anywhere to
            restore it from, and the participant has already moved on.
          </Text>
        </Box>
        <Text maxW="70ch">
          The check runs before DataPipe takes its own copy of the submission,
          which is why nothing survives it. Validation exists to block malicious
          submissions, not to catch mistakes in legitimate data.
        </Text>
        <Text maxW="70ch">
          So set your validation rules deliberately, and test them once, end to
          end, with your real experiment — before the first participant, not
          after.
        </Text>
      </DocsSection>

      <DocsSection
        id="validation-with-no-formats-allowed"
        title="Validation with no formats allowed"
      >
        <Text maxW="70ch">
          Unchecking both <strong>Allow JSON</strong> and{" "}
          <strong>Allow CSV</strong> while validation is on{" "}
          <strong>stops your experiment collecting data entirely</strong>. There
          is no format left that a submission could be valid in, so every one of
          them is rejected with <Code>INVALID_DATA</Code> and destroyed.
        </Text>
        <Text maxW="70ch">
          Nothing in the dashboard prevents this combination, and nothing about
          it looks broken from the outside — the experiment still reports that
          it is accepting data. If submissions are being rejected and you cannot
          see why, check these two boxes first.
        </Text>
      </DocsSection>

      <DocsSection id="session-limits" title="Session limits">
        <Text maxW="70ch">
          A session limit stops an experiment from overrunning its recruitment
          target. Once the number of accepted submissions reaches the limit,
          every further submission is rejected with{" "}
          <Code>SESSION_LIMIT_REACHED</Code>. You can raise the limit at any
          time and collection resumes immediately. The field starts at 1, so set
          it when you turn the switch on.
        </Text>
        <Text maxW="70ch">Four details decide whether the cap does what you expect:</Text>
        <List.Root maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              A queued upload still counts.
            </Text>{" "}
            If DataPipe accepted the data but has not delivered it to your
            provider yet, it has already used one of your sessions. The count
            tracks what DataPipe accepted, not what has landed.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Only data submissions are counted.
            </Text>{" "}
            Condition requests and{" "}
            <ProseLink href="/docs/experiments/sending-data#media-and-binary-files">
              base64 file uploads
            </ProseLink>{" "}
            are neither counted nor blocked by the cap, so an experiment at its
            limit can still receive media files.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              A burst can overshoot slightly.
            </Text>{" "}
            The count is read when a submission arrives and written when it is
            accepted. Several participants who submit in the same instant can
            each pass the check before any of them is counted, so a cap of 50
            can end up with a little more than 50 sessions.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              A rejected submission does not count.
            </Text>{" "}
            Data that fails validation, arrives with a duplicate filename, or
            hits a switched-off experiment never reaches the counter.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          Because of the last two points, treat the limit as a guard rail rather
          than as an exact quota. If exactly n complete datasets matter, check
          the count on your dashboard before you close recruitment.
        </Text>
      </DocsSection>

      <DocsSection id="security-posture" title="Security posture">
        <Box borderWidth="1px" borderColor="border" bg="bg.muted" rounded="md" p={4} maxW="70ch">
          <Text fontSize="sm">
            Only activate the features you need, and only during active data
            collection. DataPipe creates an open path into your storage provider
            — validation and session limits reduce the risk of unwanted
            submissions.
          </Text>
        </Box>
        <Text maxW="70ch">
          Anyone who reads the code of your experiment can see its experiment
          ID, and that ID is all it takes to submit. That is the trade DataPipe
          makes so participants need no accounts and you need no server.
          Validation, the session limit, and turning off data collection when a
          study ends are the three controls that bound it.
        </Text>
        <GuidanceLine href="/docs/data" linkText="What DataPipe stores">
          What reaches DataPipe, how long it is kept, and who can read it.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

ValidationAndSessionLimitsPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
