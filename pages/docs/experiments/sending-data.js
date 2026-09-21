import { Code, Link as ChakraLink, List, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";
import CodeHints from "../../../components/dashboard/CodeHints";
import CodeBlock from "../../../components/CodeBlock";

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
        purpose="The code that sends data from a jsPsych experiment or plain JavaScript, and what each response means."
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
          Use the{" "}
          <ProseLink
            href="https://github.com/jspsych/jsPsych/tree/main/packages/extension-pipe"
            external
          >
            @jspsych/extension-pipe extension
          </ProseLink>
          . Register it when you set up jsPsych and it saves your data on its
          own. There&apos;s no save trial to add, and by default it sends each
          trial as it happens rather than waiting until the experiment ends.
          The panel below is the same one on your experiment dashboard, where{" "}
          <Code>YOUR_EXPERIMENT_ID</Code> is already filled in. Copy from there
          when you&apos;re ready to run.
        </Text>
        <CodeHints expId="YOUR_EXPERIMENT_ID" />
        <Text maxW="70ch">
          The code is the same whichever storage provider you chose. Your
          experiment never has to name a provider.
        </Text>
        <GuidanceLine href="/docs/experiments/streaming" linkText="Saving as you go">
          What sending each trial as it happens does for a participant who
          drops out, and the limits it runs under.
        </GuidanceLine>
        <Text maxW="70ch" color="fg.muted" fontSize="sm">
          If you built an experiment on the older{" "}
          <ProseLink
            href="https://github.com/jspsych/jspsych-contrib/tree/main/packages/plugin-pipe"
            external
          >
            jsPsychPipe plugin
          </ProseLink>{" "}
          and its save trial, it still works. We don&apos;t recommend it for
          new experiments, but nothing about it is broken.
        </Text>
      </DocsSection>

      <DocsSection id="plain-javascript" title="Plain JavaScript">
        <Text maxW="70ch">
          You don&apos;t need jsPsych, or any framework at all. Use{" "}
          <ProseLink href="https://www.npmjs.com/package/datapipe-client" external>
            datapipe-client
          </ProseLink>
          , a small library with no jsPsych in it. The menu at the top right
          of the panel above switches every sample to it.
        </Text>
        <CodeBlock language="html">
          {`<script src="https://unpkg.com/datapipe-client"></script>`}
        </CodeBlock>
        <Text maxW="70ch">
          That gives you a <Code>DataPipe</Code> global. If you use a bundler,{" "}
          <Code>npm install datapipe-client</Code> instead. Either way you get
          one function for each JavaScript tab in the panel:{" "}
          <Code>saveData</Code>, <Code>createSession</Code>,{" "}
          <Code>saveBase64Data</Code>, and <Code>getCondition</Code>.
        </Text>
        <Text maxW="70ch">
          Send whatever your experiment produces. The data string is stored
          byte for byte under the filename you give it.
        </Text>
        <Text maxW="70ch">
          One thing to know about the library before you read the reference,
          because it&apos;s easy to get wrong and doesn&apos;t fail loudly:{" "}
          <strong>
            <Code>getCondition</Code> throws, and nothing else does.
          </strong>{" "}
          Saving fails quietly on purpose, because a failed upload is retried
          and the data is still in the browser. A condition is different. It
          usually decides which timeline a participant runs, so there&apos;s
          no sensible fallback. Catch the error and decide what the
          participant sees, rather than letting them run the wrong condition.
        </Text>
        <Text maxW="70ch">
          The library is a thin layer over DataPipe&apos;s HTTP API, and you
          can call that API yourself instead. Saving data, saving a file, and
          requesting a condition are each one <Code>POST</Code> with a JSON
          body carrying your experiment ID, a filename, and the data as a
          string. You give up two things. Compression becomes your job (see{" "}
          <ProseLink href="#request-size-limits">Request size limits</ProseLink>
          ), and{" "}
          <ProseLink href="/docs/experiments/streaming">saving as you go</ProseLink>{" "}
          is impractical, because it writes each trial to a database rather
          than posting it to DataPipe.
        </Text>
        <GuidanceLine
          href="https://github.com/jspsych/datapipe/tree/main/packages/client"
          linkText="datapipe-client reference"
          external
        >
          Every function, its options, and what it returns.
        </GuidanceLine>
        <GuidanceLine href="/docs/api" linkText="API reference">
          Every field, response code, and error code for all three participant
          endpoints.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="filenames-must-be-unique" title="Filenames must be unique">
        <Text maxW="70ch">
          Two submissions to the same experiment can never share a filename.
          The second one is rejected with <Code>FILE_EXISTS</Code> and
          isn&apos;t stored. Generate a fresh random ID per participant and
          build the filename from it, as the samples above do. (This code was
          called <Code>OSF_FILE_EXISTS</Code> before September 2026. See{" "}
          <ProseLink href="/docs/whats-changed#error-codes">What&apos;s changed</ProseLink>.)
        </Text>
        <GuidanceLine href="/docs/data/files" linkText="Filenames, archives and your storage">
          How the check works, and what each provider does with a duplicate.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="media-and-binary-files" title="Media and binary files">
        <Text maxW="70ch">
          Base64 data collection lets you send binary files (audio recordings,
          video, or images) encoded as base64 strings. DataPipe decodes the
          string and stores the resulting file alongside the rest of your
          experiment&apos;s data. Each request sends one file.
        </Text>
        <Text maxW="70ch">Three things to know before you rely on it:</Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            It has its own switch, independent of{" "}
            <strong>Accept new data</strong>. Turn on{" "}
            <strong>Accept base64 file uploads</strong> on the dashboard, or
            these requests are rejected with{" "}
            <Code>BASE64DATA_COLLECTION_NOT_ACTIVE</Code>. The flip side is
            that this switch keeps accepting files after you&apos;ve turned
            off <strong>Accept new data</strong>. Turn both off when a study
            ends.
          </List.Item>
          <List.Item>
            Your validation rules don&apos;t apply to it. DataPipe checks only
            that the string really is base64. It can&apos;t tell what the
            decoded file contains, which is why the switch is separate and why
            it&apos;s worth turning off outside active collection.
          </List.Item>
          <List.Item>
            It doesn&apos;t count toward your session limit, and it isn&apos;t
            blocked by one. A file upload can still arrive after an experiment
            has hit its cap on data submissions.
          </List.Item>
        </List.Root>
        <GuidanceLine href="/docs/experiments/validation#session-limits" linkText="Session limits">
          What the session cap does and doesn&apos;t cover.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="request-size-limits" title="Request size limits">
        <Text maxW="70ch">
          A single request to DataPipe can be at most <strong>32 MB</strong>.
          The server infrastructure enforces this limit, and it can&apos;t be
          raised. Most experiment data is well under it. A typical jsPsych
          dataset is 50 KB to 5 MB.
        </Text>
        <Text maxW="70ch">
          The extension and <Code>datapipe-client</Code> both compress request
          bodies with gzip before sending, and so does version 0.6.0 or later
          of the older{" "}
          <ProseLink
            href="https://github.com/jspsych/jspsych-contrib/tree/main/packages/plugin-pipe"
            external
          >
            @jspsych-contrib/plugin-pipe
          </ProseLink>{" "}
          plugin. Text data (JSON, CSV) typically shrinks by 2–10x, which in
          practice raises the ceiling to roughly 60–300 MB for most experiment
          data. Compression needs no setup.
        </Text>
        <Text maxW="70ch">
          Compression helps less with binary data sent to the base64 endpoint,
          such as video or audio recordings, because binary data doesn&apos;t
          compress as well as text. Individual files larger than about 25 MB
          may still exceed the limit even after compression.
        </Text>
        <Text maxW="70ch">
          If you call the API yourself rather than through the extension or{" "}
          <Code>datapipe-client</Code>, you can compress the request body with
          the browser&apos;s{" "}
          <ProseLink
            href="https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream"
            external
          >
            CompressionStream API
          </ProseLink>{" "}
          and set the <Code>Content-Encoding: gzip</Code> header. The server
          decompresses it automatically.
        </Text>
        <Text maxW="70ch">
          A request that is still over 32 MB never reaches DataPipe&apos;s own
          code. The hosting infrastructure rejects it before any endpoint runs,
          so DataPipe can&apos;t give you an error response and nothing on
          your dashboard explains it. Your request gets back a bare{" "}
          <Code>500 Internal Error</Code>, or a plain network failure
          depending on the client, and unlike a queued <Code>202</Code>, the
          data isn&apos;t held anywhere for retry. If participants are hitting
          this, shrink the payload: split large recordings into smaller files,
          lower a sampling rate, or send data more often instead of once at the
          end. Retrying the same request won&apos;t help.
        </Text>
      </DocsSection>

      <DocsSection id="what-the-response-means" title="What the response means">
        <Text maxW="70ch">
          In normal operation, every submission gets one of three answers, and
          only one of them means you need to do something.
        </Text>
        <List.Root maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              201
            </Text>:{" "}
            stored. The file is in your storage provider.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              202
            </Text>:{" "}
            accepted, not delivered yet. DataPipe is holding the data and will
            keep trying your provider on its own.{" "}
            <strong>Treat it as success and don&apos;t resubmit.</strong>
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              400
            </Text>:{" "}
            rejected, and nothing was stored. The <Code>error</Code> field in
            the response body says why: data collection switched off, the
            session limit reached, a duplicate filename, or data that failed
            validation.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          Responses from the data endpoint also carry a{" "}
          <Code>metadataMessage</Code> field. It reports what DataPipe did with
          your Psych-DS metadata. It never decides whether a submission is
          accepted.
        </Text>
        <GuidanceLine href="/docs/data/failures" linkText="When an upload fails">
          What a 202 means for your data, and where to find the file while it
          waits.
        </GuidanceLine>
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
