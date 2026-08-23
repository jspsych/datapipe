import { Code, Link as ChakraLink, List, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";
import CodeHints from "../../../components/dashboard/CodeHints";

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

export default function SendingDataPage() {
  return (
    <>
      <PageHeader
        title="Sending data from your experiment"
        purpose="Send data from a jsPsych experiment or plain JavaScript, and know what each response means."
      />

      {/* One <CodeHints> instance, not one per section (docs IA plan §2.4
          says "both rendered by reusing CodeHints verbatim"): the component
          is a single panel whose own menu switches between jsPsych and plain
          JavaScript, and a second instance would render an identical widget
          on the same default tab. Reusing the dashboard's component -- rather
          than pasting its snippets here -- is the point: it takes the
          experiment id as a prop (CodeHints.js:15), so these samples and the
          ones on the dashboard cannot drift apart. */}
      <DocsSection id="jspsych" title="jsPsych">
        <Text maxW="70ch">
          The quickest route is the{" "}
          <ProseLink
            href="https://github.com/jspsych/jspsych-contrib/tree/main/packages/plugin-pipe"
            external
          >
            jsPsychPipe plugin
          </ProseLink>
          : load it, generate a unique filename, and add a save trial to your
          timeline. The panel below is the same one on your experiment
          dashboard, where{" "}
          <Code>YOUR_EXPERIMENT_ID</Code> is already replaced with the real
          value — copy from there when you are ready to run.
        </Text>
        <CodeHints expId="YOUR_EXPERIMENT_ID" />
        <Text maxW="70ch">
          The code is the same whichever storage provider you chose — your
          experiment never names a provider.
        </Text>
      </DocsSection>

      <DocsSection id="plain-javascript" title="Plain JavaScript">
        <Text maxW="70ch">
          You do not need jsPsych, or any library at all. The menu at the top
          right of the panel above switches every sample to plain JavaScript:
          each one is a single <Code>fetch</Code> to a DataPipe endpoint with a
          JSON body carrying your experiment ID, a filename, and the data as a
          string.
        </Text>
        <Text maxW="70ch">
          Send whatever your experiment produces — the data string is stored
          byte for byte, under the filename you give it.
        </Text>
        <GuidanceLine href="/docs/api" linkText="API reference">
          Every field, response code, and error code, for all three participant
          endpoints.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="filenames-must-be-unique" title="Filenames must be unique">
        <Text maxW="70ch">
          Two submissions to the same experiment can never share a filename:
          the second one is rejected with{" "}
          <Code>OSF_FILE_EXISTS</Code> and is not stored. That code name is
          historical — the rule applies on every storage provider. Generate a
          fresh random ID per participant and build the filename from it, as the
          samples above do. Do not use a counter your experiment maintains, and
          do not reuse a name after a failed attempt.
        </Text>
        <GuidanceLine href="/docs/data/files" linkText="Filenames, archives and your storage">
          DataPipe, not your storage provider, is what enforces this — and what
          happens to a duplicate differs by provider.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="media-and-binary-files" title="Media and binary files">
        <Text maxW="70ch">
          Base64 data collection lets you send binary files — like audio
          recordings, video, or images — encoded as base64 strings. DataPipe
          decodes the string and stores the resulting file alongside the rest of
          your experiment&apos;s data. Each request sends one file at a time.
        </Text>
        <Text maxW="70ch">Three things to know before you rely on it:</Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            It has its own switch, which works independently of the other one.
            Turn on <strong>Accept base64 file uploads</strong> on the
            dashboard, or these requests are rejected with{" "}
            <Code>BASE64DATA_COLLECTION_NOT_ACTIVE</Code> — and equally, this
            switch keeps accepting files after you have turned off{" "}
            <strong>Accept new data</strong>. Turn both off when a study ends.
          </List.Item>
          <List.Item>
            Your validation rules do not apply to it. DataPipe checks only that
            the string really is base64; it cannot tell what the decoded file
            contains, which is why the switch exists separately and why it is
            worth turning off outside active collection.
          </List.Item>
          <List.Item>
            It does not count toward your session limit, and it is not blocked
            by one. A file upload can still arrive after an experiment has hit
            its cap on data submissions.
          </List.Item>
        </List.Root>
        <GuidanceLine href="/docs/experiments/validation#session-limits" linkText="Session limits">
          What the session cap does and does not cover.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="request-size-limits" title="Request size limits">
        <Text maxW="70ch">
          {/* "Yes." dropped from the front of this sentence: it answered the
              FAQ question "Is there a limit on how much data I can send?",
              which is now a section heading rather than a question. Nothing
              else in the four paragraphs is changed. */}
          DataPipe has a <strong>32 MB limit</strong> on the size of a
          single request. This limit is enforced by the server infrastructure
          and cannot be increased. Most experiment data is well under this limit
          — a typical jsPsych dataset is 50 KB to 5 MB.
        </Text>
        <Text maxW="70ch">
          If you are using version 0.6.0 or later of the{" "}
          <ProseLink
            href="https://github.com/jspsych/jspsych-contrib/tree/main/packages/plugin-pipe"
            external
          >
            @jspsych-contrib/plugin-pipe
          </ProseLink>{" "}
          plugin, request bodies are automatically compressed with gzip before
          sending. Text data (JSON, CSV) typically compresses by 2–10x, which
          effectively raises the upload limit to roughly 60–300 MB for most
          experiment data. Compression is enabled by default and requires no
          configuration.
        </Text>
        <Text maxW="70ch">
          Compression is less effective for binary data sent to the base64
          endpoint — video or audio recordings — because binary data does not
          compress as well as text. If you need to send individual files
          larger than about 25 MB through the base64 endpoint, they may still
          exceed the limit even after compression.
        </Text>
        <Text maxW="70ch">
          If you are sending data without the plugin — calling{" "}
          <Code>fetch</Code> yourself — you can compress the request body with
          the browser&apos;s{" "}
          <ProseLink
            href="https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream"
            external
          >
            CompressionStream API
          </ProseLink>{" "}
          and setting the <Code>Content-Encoding: gzip</Code> header. The server
          will decompress the body automatically.
        </Text>
      </DocsSection>

      <DocsSection id="what-the-response-means" title="What the response means">
        <Text maxW="70ch">
          Every submission gets one of three answers, and only one of them means
          you should do something about it.
        </Text>
        <List.Root maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              201
            </Text>{" "}
            — stored. The file is in your storage provider.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              202
            </Text>{" "}
            — accepted, not delivered yet. DataPipe is holding the data and will
            keep trying your provider on its own.{" "}
            <strong>Do not resubmit</strong>: the session is already counted,
            and a second submission under the same filename would be rejected as
            a duplicate.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              400
            </Text>{" "}
            — rejected, and nothing was stored. The <Code>error</Code> field in
            the response body names the reason: data collection switched off,
            the session limit reached, a duplicate filename, or data that failed
            validation.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          Responses from the data endpoint also carry a{" "}
          <Code>metadataMessage</Code> field. It reports what DataPipe did with
          your Psych-DS metadata; it never decides whether a submission is
          accepted.
        </Text>
        <GuidanceLine href="/docs/api#responses" linkText="Responses">
          The full status table, with every error code and what to do about it.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

SendingDataPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
