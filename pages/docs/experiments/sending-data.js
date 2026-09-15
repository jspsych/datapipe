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
          The recommended route is the{" "}
          <ProseLink
            href="https://github.com/jspsych/jsPsych/tree/main/packages/extension-pipe"
            external
          >
            @jspsych/extension-pipe extension
          </ProseLink>
          . Register it when you set up jsPsych and it saves your data on its
          own — there is no save trial to add, and by default it sends each
          trial as it happens rather than waiting until the experiment ends.
          The panel below is the same one on your experiment dashboard, where{" "}
          <Code>YOUR_EXPERIMENT_ID</Code> is already replaced with the real
          value — copy from there when you are ready to run.
        </Text>
        <CodeHints expId="YOUR_EXPERIMENT_ID" />
        <Text maxW="70ch">
          The code is the same whichever storage provider you chose — your
          experiment never names a provider.
        </Text>
        <Text maxW="70ch" color="fg.muted" fontSize="sm">
          An experiment already built on the older{" "}
          <ProseLink
            href="https://github.com/jspsych/jspsych-contrib/tree/main/packages/plugin-pipe"
            external
          >
            jsPsychPipe plugin
          </ProseLink>{" "}
          and its save trial keeps working — it is not the recommendation for
          a new experiment, but nothing about it is broken.
        </Text>
      </DocsSection>

      <DocsSection id="plain-javascript" title="Plain JavaScript">
        <Text maxW="70ch">
          You do not need jsPsych, or any framework at all. The menu at the top
          right of the panel above switches every sample to plain JavaScript.
          Saving data, saving a file, and requesting a condition are each a
          single <Code>fetch</Code> to a DataPipe endpoint with a JSON body
          carrying your experiment ID, a filename, and the data as a string.
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

      <DocsSection id="saving-as-you-go" title="Saving as you go">
        <Text maxW="70ch">
          Without it, DataPipe sees a session&apos;s data exactly once, when
          the experiment finishes. If a participant closes the tab, loses
          their connection, or their browser crashes at trial 199 of 200,{" "}
          <strong>all 199 trials are lost</strong> — DataPipe never saw any of
          them. On an online panel that is not a rare event.
        </Text>
        <Text maxW="70ch">
          The <Code>@jspsych/extension-pipe</Code> extension sends each trial
          as it is produced, and it does this by default — registering it, as
          shown above, is the whole setup. Add{" "}
          <Code>stream: false</Code> to its <Code>params</Code> to turn
          streaming off and submit once at the end instead.
        </Text>
        <Text maxW="70ch">
          Plain JavaScript can stream too, through a small framework-neutral
          library, <Code>datapipe-client</Code> — something that was not
          possible before, because staging trials means writing to a database
          directly, not something to hand-roll from a <Code>fetch</Code> call.
          The <strong>Save as you go</strong> tab under JavaScript in the panel
          above has the code.
        </Text>
        <Text maxW="70ch">
          Three things to know before you rely on it:
        </Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            <strong>A completed session is unchanged.</strong> Whatever your
            experiment submits at the end — your whole dataset, in your chosen
            format, stored under the filename you gave it — is the file that
            lands in your storage. What DataPipe held during the session is
            deleted as soon as that submission lands.
          </List.Item>
          <List.Item>
            <strong>An abandoned session becomes a second kind of file.</strong>{" "}
            DataPipe assembles the trials it received and stores them as{" "}
            <Code>&lt;your filename&gt;-&lt;id&gt;.partial.json</Code> — JSON
            even if your experiment submits CSV, because it is rebuilt from
            individual trials rather than from the string your experiment would
            have sent. The short id keeps two participants who happened to use
            the same filename from colliding on the same recovered file. Plan
            for that in your analysis, and treat a partial file as a participant
            who did not finish. Partial sessions do not count toward your
            session limit.
          </List.Item>
          <List.Item>
            <strong>It cannot break your experiment.</strong> If a session
            cannot be started — the experiment is switched off, the participant
            is offline — the experiment runs and submits exactly as it would
            without it. The same is true of every individual trial write.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          While a study is running, your experiment&apos;s dashboard shows how
          many participants are part-way through and how long each has been
          going, updating as they start, finish, or lose their connection. A
          participant whose connection drops is shown as{" "}
          <strong>Connection lost — may resume</strong> for 10 minutes, then{" "}
          <strong>Stopped — being recovered</strong> once DataPipe begins turning
          what they did into a partial file.
        </Text>
        <GuidanceLine href="/docs/privacy#what-we-store" linkText="What DataPipe stores">
          Where staged trials live while a session is running, and how they
          differ from the copies DataPipe encrypts.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="streaming-limits" title="Limits">
        <Text maxW="70ch">
          Save as you go enforces the limits below on every request. None of
          them is configurable, and hitting one never breaks your
          experiment — streaming carries on and a completed submission is
          unaffected. What each one actually costs a participant is the
          partial-file safety net for someone who never finishes, not the
          data your experiment collects.
        </Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          {/* MAX_TRIAL_BYTES, functions/src/staging-assembly.ts (mirrored in
              database.rules.json's per-trial `.length` cap) */}
          <List.Item>
            <strong>16 KiB per trial.</strong> A trial larger than that is
            refused by the database — the write for that one trial fails, and
            streaming continues with the next one. A completed session still sends
            your whole dataset in its final submission, so that trial is only
            missing from the partial file DataPipe would recover if the
            participant never finished.
          </List.Item>
          {/* MAX_TRIALS_PER_SESSION, functions/src/staging-assembly.ts
              (mirrored in database.rules.json's `$seq` pattern) */}
          <List.Item>
            <strong>1,000 trials per session.</strong> The 1,001st trial and
            every one after it are refused the same way an oversized trial
            is. Again, only the partial-file safety net is affected — the
            final submission is not built from staged trials, so it is
            unaffected.
          </List.Item>
          {/* ABANDON_GRACE_MS and SESSION_TTL_MS,
              functions/src/staging-assembly.ts */}
          <List.Item>
            <strong>10 minutes to reconnect, 24 hours to finish.</strong> If a
            participant&apos;s connection drops and DataPipe sees no reconnect
            and no further trial from them for 10 minutes, the session is
            treated as abandoned and turned into a partial file the next time
            the sweep runs. Reconnecting — or getting even one more trial
            through — within that window keeps the session going as if
            nothing happened. Regardless of any of that, every session
            expires 24 hours after it started and is recovered the same way
            whether or not a disconnect was ever recorded.
          </List.Item>
          {/* MAX_DISCONNECTS, functions/src/staging-assembly.ts (mirrored in
              database.rules.json's 1..20 slot pattern) */}
          <List.Item>
            <strong>20 disconnects and 20 reconnects per session.</strong> A
            participant whose connection drops and recovers more than 20
            times stops having further drops recorded, so the 10-minute
            abandonment clock keeps being measured from the last drop that
            was recorded rather than the most recent real one. They are still
            recovered eventually — at the 24-hour expiry if nothing else —
            but the fast path may miss them.
          </List.Item>
          {/* MAX_OPEN_SESSIONS_PER_EXPERIMENT,
              functions/src/staging-assembly.ts */}
          <List.Item>
            <strong>500 sessions open per experiment at once.</strong> A
            participant who requests a session while 500 are already open for
            your experiment gets none — the same response as when
            incremental upload is switched off — and their experiment runs
            and submits exactly as it would without it. Nothing about their
            data is different.
          </List.Item>
          {/* MAX_ASSEMBLED_BYTES and MAX_FILENAME_LENGTH,
              functions/src/staging-assembly.ts */}
          <List.Item>
            <strong>24 MiB per recovered file, 200-character filenames.</strong>{" "}
            A recovered partial file stops growing at 24 MiB — trials beyond
            that point are left out of the file DataPipe assembles. The
            filename you give when starting a session is capped at 200
            characters, and is silently shortened past that when used to name
            a recovered file; it never affects the filename you submit on a
            clean completion.
          </List.Item>
        </List.Root>
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
            It has its own switch, which works independently of{" "}
            <strong>Accept new data</strong>. Turn on{" "}
            <strong>Accept base64 file uploads</strong> on the
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
          The extension and <Code>datapipe-client</Code> both compress request
          bodies with gzip before sending, as does version 0.6.0 or later of the
          older{" "}
          <ProseLink
            href="https://github.com/jspsych/jspsych-contrib/tree/main/packages/plugin-pipe"
            external
          >
            @jspsych-contrib/plugin-pipe
          </ProseLink>{" "}
          plugin. Text data (JSON, CSV) typically compresses by 2–10x, which
          effectively raises the upload limit to roughly 60–300 MB for most
          experiment data. Compression requires no configuration.
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
          and set the <Code>Content-Encoding: gzip</Code> header. The server
          will decompress the body automatically.
        </Text>
        <Text maxW="70ch">
          A request that is still over 32 MB never reaches DataPipe&apos;s own
          code — the hosting infrastructure rejects it before any endpoint runs.
          There is no DataPipe error response and nothing in your experiment
          dashboard to explain it; your <Code>fetch</Code> call gets back a
          bare <Code>500 Internal Error</Code> (or a plain network failure,
          depending on the client), and unlike a queued{" "}
          <Code>202</Code>, the data is not held anywhere for retry. If
          participants are hitting this, the fix is to shrink the payload —
          split large recordings into smaller files, lower a sampling rate, or
          send data more often instead of once at the end — not to retry the
          same request.
        </Text>
      </DocsSection>

      <DocsSection id="what-the-response-means" title="What the response means">
        <Text maxW="70ch">
          In normal operation every submission gets one of three answers, and
          only one of them means you should do something about it.
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
