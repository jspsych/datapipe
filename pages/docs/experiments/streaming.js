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

export default function SavingAsYouGoPage() {
  return (
    <>
      <PageHeader
        title="Saving as you go"
        purpose="Send each trial as it happens, so a participant who drops out partway through still leaves data behind."
      />

      <DocsSection id="why-save-as-you-go" title="Why save as you go">
        <Text maxW="70ch">
          Without saving as you go, DataPipe sees a session&apos;s data
          exactly once, when the experiment finishes. If a participant closes
          the tab, loses their connection, or their browser crashes at trial
          199 of 200, <strong>all 199 trials are lost</strong>. DataPipe never
          saw any of them. On an online panel, that happens often.
        </Text>
        <Text maxW="70ch">
          With it on, each trial is sent to DataPipe as it&apos;s produced.
          A participant who finishes is stored exactly as before. A
          participant who doesn&apos;t leaves behind a partial file with
          everything they did up to the point they stopped.
        </Text>
      </DocsSection>

      <DocsSection id="turning-it-on" title="Turning it on">
        <Text maxW="70ch">
          In jsPsych, the{" "}
          <ProseLink
            href="https://github.com/jspsych/jsPsych/tree/main/packages/extension-pipe"
            external
          >
            @jspsych/extension-pipe extension
          </ProseLink>{" "}
          does this by default. Registering it, as shown below, is the whole
          setup. To turn streaming off and submit once at the end instead, add{" "}
          <Code>stream: false</Code> to its <Code>params</Code>.
        </Text>
        <Text maxW="70ch">
          Plain JavaScript can stream too, with{" "}
          <ProseLink href="https://www.npmjs.com/package/datapipe-client" external>
            datapipe-client
          </ProseLink>
          &apos;s <Code>createSession</Code>. Unlike the extension, the
          library doesn&apos;t stream by default. Your experiment opts in by
          starting a session. The <strong>Save as you go</strong> tab under
          JavaScript in the panel below has the code.
        </Text>
        <CodeHints expId="YOUR_EXPERIMENT_ID" />
        <Text maxW="70ch">
          One thing to get right in plain JavaScript:{" "}
          <strong>
            call <Code>flush()</Code> before you read <Code>sessionId</Code>.
          </strong>{" "}
          A session starts in the background, and until it has, the ID is an
          empty string. If you submit without it, DataPipe can&apos;t match
          your file to the staged copy, so it recovers that copy separately
          and you end up with a stray <Code>.partial.json</Code> next to a
          complete file.
        </Text>
        <GuidanceLine href="/docs/experiments/sending-data" linkText="Sending data from your experiment">
          The rest of the code, for jsPsych and plain JavaScript, and what
          each response means.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="what-to-expect" title="What to expect">
        <Text maxW="70ch">Three things to know before you rely on it:</Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            <strong>A completed session is unchanged.</strong> Whatever your
            experiment submits at the end, your whole dataset in your chosen
            format under the filename you gave it, is the file that lands in
            your storage. What DataPipe held during the session is deleted as
            soon as that submission lands.
          </List.Item>
          <List.Item>
            <strong>An abandoned session becomes a second kind of file.</strong>{" "}
            DataPipe assembles the trials it received and stores them as{" "}
            <Code>&lt;your filename&gt;-&lt;id&gt;.partial.json</Code>. It&apos;s
            JSON even if your experiment submits CSV, because it&apos;s rebuilt
            from individual trials rather than from the string your experiment
            would have sent. The short ID keeps two participants who happened
            to use the same filename from colliding. Plan for these files in
            your analysis, and treat a partial file as a participant who
            didn&apos;t finish. Partial sessions don&apos;t count toward your
            session limit, and they skip your validation rules, since those
            run on completed submissions.
          </List.Item>
          <List.Item>
            <strong>It can&apos;t break your experiment.</strong> If a session
            can&apos;t be started, because the experiment is switched off or
            the participant is offline, the experiment runs and submits
            exactly as it would without it. The same goes for every
            individual trial write.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          While a study is running, your experiment&apos;s dashboard shows how
          many participants are partway through and how long each has been
          going, updating as they start, finish, or lose their connection. A
          participant whose connection drops is shown as{" "}
          <strong>Connection lost — may resume</strong> for 10 minutes, then{" "}
          <strong>Stopped — being recovered</strong> once DataPipe starts
          turning what they did into a partial file.
        </Text>
      </DocsSection>

      <DocsSection id="privacy" title="What it means for privacy">
        <Text maxW="70ch">
          Saving as you go changes what happens to a participant&apos;s data
          in ways your consent form and your IRB may care about. Four things
          are different from a study that submits once at the end:
        </Text>
        <List.Root maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <strong>Data leaves the browser during the session.</strong> Each
            trial is written straight from the participant&apos;s browser to a
            private database DataPipe operates, over a connection separate
            from the one that carries the final submission.
          </List.Item>
          <List.Item>
            <strong>Quitting no longer discards the data.</strong> A
            participant who closes the tab partway through leaves a partial
            file in your storage. DataPipe can&apos;t tell a withdrawal from a
            dropped connection. If your consent process treats closing the
            tab as withdrawal, say so in your protocol and plan to delete
            partial files, or turn saving as you go off.
          </List.Item>
          <List.Item>
            <strong>Staged trials aren&apos;t encrypted by DataPipe.</strong>{" "}
            The browser that writes them has no key. They&apos;re protected by
            Google&apos;s platform encryption at rest and by access rules that
            let no browser read them, and they&apos;re deleted the moment the
            participant&apos;s final submission arrives, or as soon as an
            abandoned session has been turned into a partial file.
          </List.Item>
          <List.Item>
            <strong>The filename you pass at session start is stored with
            the session</strong> until the session ends, so keep participant
            identifiers out of it.
          </List.Item>
        </List.Root>
        <Text maxW="70ch">
          A participant who finishes is unaffected. Their final submission is
          handled exactly as it would be without saving as you go.
        </Text>
        <GuidanceLine href="/docs/privacy#saving-as-you-go" linkText="If your experiment saves as it goes">
          The same differences in the privacy page&apos;s terms, with a
          sentence you can adapt for an IRB protocol.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="limits" title="Limits">
        <Text maxW="70ch">
          Saving as you go enforces the limits below on every request. None of
          them can be changed, and hitting one never breaks your experiment.
          Streaming carries on, and a completed submission is unaffected. What
          a limit costs is the partial-file safety net for a participant who
          never finishes, not the data your experiment collects.
        </Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          {/* MAX_TRIAL_BYTES, functions/src/staging-assembly.ts (mirrored in
              database.rules.json's per-trial `.length` cap) */}
          <List.Item>
            <strong>16 KiB per trial.</strong> The database refuses a trial
            larger than that. The write for that one trial fails, and
            streaming continues with the next one. A completed session still
            sends your whole dataset in its final submission, so the trial is
            only missing from the partial file DataPipe would recover if the
            participant never finished.
          </List.Item>
          {/* MAX_TRIALS_PER_SESSION, functions/src/staging-assembly.ts
              (mirrored in database.rules.json's `$seq` pattern) */}
          <List.Item>
            <strong>1,000 trials per session.</strong> The 1,001st trial and
            every one after it are refused the same way an oversized trial is.
            Again, only the partial-file safety net is affected. The final
            submission isn&apos;t built from staged trials.
          </List.Item>
          {/* ABANDON_GRACE_MS and SESSION_TTL_MS,
              functions/src/staging-assembly.ts */}
          <List.Item>
            <strong>10 minutes to reconnect, 24 hours to finish.</strong> If a
            participant&apos;s connection drops and DataPipe sees no reconnect
            and no further trial from them for 10 minutes, it treats the
            session as abandoned and turns it into a partial file the next time
            the sweep runs. Reconnecting, or getting even one more trial
            through, within that window keeps the session going as if nothing
            happened. Separately, every session expires 24 hours after it
            started and is recovered the same way, whether or not a disconnect
            was ever recorded.
          </List.Item>
          {/* MAX_DISCONNECTS, functions/src/staging-assembly.ts (mirrored in
              database.rules.json's 1..20 slot pattern) */}
          <List.Item>
            <strong>20 disconnects and 20 reconnects per session.</strong> After
            a participant&apos;s connection has dropped and recovered 20
            times, further drops aren&apos;t recorded. The 10-minute clock then
            runs from the last recorded drop rather than the most recent real
            one. The session is still recovered eventually, at the 24-hour
            expiry if nothing else, but the fast path may miss it.
          </List.Item>
          {/* MAX_OPEN_SESSIONS_PER_EXPERIMENT,
              functions/src/staging-assembly.ts */}
          <List.Item>
            <strong>500 sessions open per experiment at once.</strong> A
            participant who asks for a session while 500 are already open for
            your experiment doesn&apos;t get one. That&apos;s the same response
            as when incremental upload is switched off, and their experiment
            runs and submits exactly as it would without it. Nothing about
            their data is different.
          </List.Item>
          {/* MAX_ASSEMBLED_BYTES and MAX_FILENAME_LENGTH,
              functions/src/staging-assembly.ts */}
          <List.Item>
            <strong>24 MiB per recovered file, 200-character filenames.</strong>{" "}
            A recovered partial file stops growing at 24 MiB. Trials beyond
            that point are left out of the file DataPipe assembles. The
            filename you give when starting a session is capped at 200
            characters and is quietly shortened past that when it&apos;s used
            to name a recovered file. It never affects the filename you submit
            on a clean completion.
          </List.Item>
        </List.Root>
        <GuidanceLine href="/docs/api#start-session" linkText="Start an incremental session">
          The endpoint behind this, for anyone writing their own client.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

SavingAsYouGoPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
