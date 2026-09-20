import { Box, Code, Heading, Link as ChakraLink, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../components/ui/PageHeader";
import GuidanceLine from "../../components/ui/GuidanceLine";
import DocsLayout from "../../components/docs/DocsLayout";
import DocsSection from "../../components/docs/DocsSection";
import { osfSunsetLabel } from "../../lib/osf-sunset";

// Prose link, per DESIGN.md §5: brandGreen.fg with a persistent underline, so
// a link is never signalled by color alone. Local to this page for the same
// reason every other /docs page keeps its own -- there is no shared
// prose-link primitive yet, and this package owns only page files.
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

// A sub-topic heading inside a DocsSection, same shape as the "Failures that
// are handled faster" / "Uploads that never reported back" headings in
// pages/docs/data/failures.js.
function SubHeading({ children }) {
  return (
    <Heading as="h3" fontSize="md" fontWeight="600" color="fg" mt={2}>
      {children}
    </Heading>
  );
}

export default function WhatsChangedPage() {
  // Same source pages/docs/providers/osf.js and OsfSunsetBanner.js read from,
  // so this page can never state a different OSF date than they do.
  const osfDeadline = osfSunsetLabel();

  return (
    <>
      <PageHeader
        title="What's changed"
        purpose="A large update went out in September 2026. Here's what's different, starting with what might need a change on your side."
      />

      <Text maxW="70ch">
        DataPipe had a large update in September 2026. If you have an
        experiment already collecting data, it keeps working exactly as
        before — nothing here breaks a study in progress. The rest of this
        page covers what changed, in the order it matters: things that can
        affect code you already wrote, then what's new.
      </Text>

      <DocsSection
        id="changes-that-can-affect-your-code"
        title="Changes that can affect your code"
      >
        <Box borderWidth="1px" borderColor="border" bg="bg.muted" rounded="md" p={4} maxW="70ch">
          <Text fontSize="sm">
            <strong>Read this section first</strong> if you wrote code that
            reads a DataPipe response, or if you have an experiment still
            collecting on OSF.
          </Text>
        </Box>

        <SubHeading>Error codes lost their OSF prefix</SubHeading>
        <Text maxW="70ch">
          Three error codes were renamed in September 2026, because they were
          never OSF-specific: <Code>OSF_FILE_EXISTS</Code> is now{" "}
          <Code>FILE_EXISTS</Code>, <Code>OSF_UPLOAD_ERROR</Code> is now{" "}
          <Code>UPLOAD_ERROR</Code>, and <Code>OSF_UPLOAD_EXCEPTION</Code> is
          now <Code>UPLOAD_EXCEPTION</Code>. They&apos;re returned for every
          storage provider, not only OSF.
        </Text>
        <Text maxW="70ch">
          <strong>What to do:</strong> this only matters if your experiment
          code compares the <Code>error</Code> field in a response against one
          of the old names — for example, generating a new filename and
          retrying after <Code>OSF_FILE_EXISTS</Code>. If it does, that
          comparison silently stops matching. Update it to the new names, or
          check for both while you roll your experiments over. HTTP status
          codes didn&apos;t change.
        </Text>
        <GuidanceLine href="/docs/api#error-codes" linkText="Error codes">
          The full table, with what each one means and what status it comes
          back with.
        </GuidanceLine>

        <SubHeading>A body parameter was removed</SubHeading>
        <Text maxW="70ch">
          The data-saving endpoint no longer accepts a{" "}
          <Code>metadataOptions</Code> field in the request body. It was never
          documented, and it let a participant&apos;s own submission set the
          name, author, or license written into your dataset&apos;s
          description. If your code was sending it, it&apos;s now silently
          ignored rather than applied.
        </Text>

        <SubHeading>OSF: no new experiments</SubHeading>
        <Text maxW="70ch">
          OSF is shutting down its projects feature, so DataPipe can no
          longer create new experiments there.{" "}
          {osfDeadline
            ? `DataPipe will stop writing to OSF after ${osfDeadline}.`
            : "DataPipe is winding down its support for OSF."}{" "}
          An experiment that&apos;s already collecting on OSF keeps working
          until then.
        </Text>
        <Text maxW="70ch">
          <strong>What to do:</strong> if your account signs in through OSF
          rather than owning your experiments some other way, watch for a
          re-authorize prompt in your account settings. For any new study,
          connect Google Drive, Dataverse, or Zenodo instead of OSF.
        </Text>
        <GuidanceLine href="/docs/providers/osf" linkText="Moving off OSF">
          What changes, what happens to data you already collected, and how
          to move to another provider.
        </GuidanceLine>

        <SubHeading>Accounts now need a confirmed contact email</SubHeading>
        <Text maxW="70ch">
          A new account needs a contact email address before it can create an
          experiment. DataPipe uses it for one thing: telling you if uploads
          for one of your experiments start failing.
        </Text>
        <Text maxW="70ch">
          <strong>What to do:</strong> if your address isn&apos;t confirmed,
          DataPipe still sends that notification — it just can&apos;t be sure
          it reaches you. Confirm it from{" "}
          <ProseLink href="/admin/account">account settings</ProseLink>.
        </Text>
      </DocsSection>

      <DocsSection id="new-places-to-send-data" title="New places to send data">
        <Text maxW="70ch">
          DataPipe now writes to three storage providers, on top of OSF:
        </Text>
        <Text maxW="70ch">
          <strong>Google Drive.</strong> Your own Drive, in a folder DataPipe
          creates. The fastest to connect — one click, and you&apos;re done.
        </Text>
        <Text maxW="70ch">
          <strong>Dataverse.</strong> Institutional repositories run by
          universities and consortia, such as Harvard Dataverse or Borealis.
          Good if your institution runs one and your data should live there
          under its own terms.
        </Text>
        <Text maxW="70ch">
          <strong>Zenodo.</strong> An open repository run by CERN. Good for a
          study you plan to publish and cite — publishing issues a DOI.
        </Text>
        <GuidanceLine href="/docs/providers" linkText="Choosing a provider">
          A full comparison, including each provider&apos;s limits and what
          it does with a duplicate filename.
        </GuidanceLine>
        <GuidanceLine
          href="/docs/providers/connecting"
          linkText="Connecting and reconnecting"
        >
          How to connect one, and what to do when a credential expires.
        </GuidanceLine>
      </DocsSection>

      <DocsSection
        id="saving-data-as-it-runs"
        title="Saving data as the experiment runs"
      >
        <Text maxW="70ch">
          An experiment can now send each trial to DataPipe as it happens,
          instead of only once at the end. In jsPsych, register the{" "}
          <ProseLink
            href="https://github.com/jspsych/jsPsych/tree/main/packages/extension-pipe"
            external
          >
            @jspsych/extension-pipe extension
          </ProseLink>{" "}
          and it streams by default. Outside jsPsych, the framework-neutral{" "}
          <ProseLink href="https://www.npmjs.com/package/datapipe-client" external>
            datapipe-client
          </ProseLink>{" "}
          library does the same when your experiment starts a session with
          it.
        </Text>
        <Text maxW="70ch">
          A participant who closes the tab or loses their connection partway
          through isn&apos;t a total loss anymore. DataPipe assembles what it
          received into a partial file, usually about fifteen minutes after
          the participant leaves. While a study is running, your
          experiment&apos;s dashboard shows a live{" "}
          <strong>Sessions in progress</strong> view — how many participants
          are partway through, and how long each has been going.
        </Text>
        <Text maxW="70ch">
          If your experiment already saves once at the end with the older
          jsPsychPipe plugin, nothing changes for you. It still works.
        </Text>
        <GuidanceLine href="/docs/experiments/streaming" linkText="Saving as you go">
          What to expect, what it means for privacy, and the limits it runs
          under.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="when-an-upload-fails" title="When an upload fails">
        <Text maxW="70ch">
          If your storage provider can&apos;t take a submission right away,
          DataPipe now keeps a copy and retries it automatically — up to five
          attempts over about 31 hours. Your experiment&apos;s dashboard shows
          a queued-files panel that lists what&apos;s waiting or retrying, and
          lets you download any file, or all of them as one ZIP, without
          waiting for a retry to succeed.
        </Text>
        <Text maxW="70ch">
          You get one email if uploads for an experiment start failing — not
          one per file — and not another one until the problem clears.
          DataPipe keeps a queued file for seven days after it was queued, or
          up to fourteen if it couldn&apos;t deliver that email to you.
        </Text>
        <GuidanceLine href="/docs/data/failures" linkText="When an upload fails">
          The retry schedule, what each status on the panel means, and how to
          download a queued file.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="rejected-submissions" title="Rejected submissions">
        <Text maxW="70ch">
          Each experiment&apos;s dashboard now lists the submissions DataPipe
          refused, with a plain-language reason for each one and when it
          happened. DataPipe was never storing this data — a rejected
          submission was always gone — but there was nowhere to see that it
          had happened at all.
        </Text>
        <Text maxW="70ch">
          <strong>Clear this list</strong> once you&apos;ve dealt with
          what&apos;s there. Clearing empties the visible list; it doesn&apos;t
          touch the lifetime count DataPipe keeps behind it.
        </Text>
        <GuidanceLine
          href="/docs/experiments/validation#rejected-data-is-gone"
          linkText="Rejected data is gone"
        >
          Why a rejected submission can&apos;t be recovered, and how to test
          your validation rules before participants arrive.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="psych-ds-metadata" title="Psych-DS metadata">
        <Text maxW="70ch">
          With Psych-DS metadata turned on, DataPipe now writes a{" "}
          <Code>dataset_description.json</Code>, a data table per session, and
          a sidecar table for any column that held nested values (survey
          responses, mouse-tracking samples). Files land under a{" "}
          <Code>data/</Code> and <Code>data/raw/</Code> layout, and your
          original submission is always kept byte for byte in{" "}
          <Code>data/raw/</Code>.
        </Text>
        <Text maxW="70ch">
          <strong>Decide before you start collecting.</strong> You can turn
          the setting on or off freely until the first submission arrives,
          and it locks for the life of the experiment after that. To change
          it later, create a new experiment with the setting you want.
        </Text>
        <GuidanceLine href="/docs/experiments/metadata" linkText="Psych-DS metadata">
          What gets written, where the variable descriptions come from, and
          why the setting locks.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="finalizing-a-dataset" title="Finalizing a dataset">
        <Text maxW="70ch">
          When a Zenodo study is done, you can finalize the experiment from
          its dashboard. DataPipe merges everything into a single archive and
          permanently stops accepting new submissions. There&apos;s no undo,
          so only do it once you&apos;re certain no more data is coming.
        </Text>
        <Text maxW="70ch">
          DataPipe also bundles files into archives automatically during
          collection, before you finalize anything, once a Zenodo record
          approaches its 100-file limit. Nothing is lost — your sessions are
          inside the archive.
        </Text>
        <GuidanceLine href="/docs/data/finalizing" linkText="Finishing a study">
          What finalizing does, which providers support it, and why it
          can&apos;t be undone.
        </GuidanceLine>
      </DocsSection>

      <DocsSection
        id="signing-in-and-your-account"
        title="Signing in and your account"
      >
        <Text maxW="70ch">
          You can sign in to DataPipe with Google, ORCID, GitHub, or an email
          address and password, and add more than one to the same account.
        </Text>
        <Text maxW="70ch">
          <strong>What to do:</strong> OSF sign-in is being retired. If
          it&apos;s currently your only way into DataPipe, link another
          sign-in method from your account settings — otherwise you risk
          losing access to an account that still owns your experiments.
        </Text>
        <Text maxW="70ch">
          Deleting your account removes every experiment you own and
          everything DataPipe holds about them. It doesn&apos;t touch
          anything already in your storage provider.
        </Text>
        <GuidanceLine href="/docs/account" linkText="Account and security">
          Sign-in methods, how credentials are stored, and what account
          deletion removes.
        </GuidanceLine>
      </DocsSection>

      <DocsSection
        id="privacy-and-data-handling"
        title="Privacy and data handling"
      >
        <Text maxW="70ch">
          DataPipe now has a privacy page written for IRB protocols and
          institutional security reviews: what it processes, what it stores,
          encryption, and where data is processed.
        </Text>
        <Text maxW="70ch">
          A submission DataPipe is holding for retry is encrypted
          (AES-256-GCM) the whole time it&apos;s in the queue. Disconnecting
          Google Drive from your account settings deletes DataPipe&apos;s
          stored token and asks Google to revoke DataPipe&apos;s
          authorization.
        </Text>
        <GuidanceLine href="/docs/privacy" linkText="Privacy & information for IRBs">
          A paragraph you can adapt for a protocol, plus retention, access,
          and what DataPipe does not do with your data.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="a-new-look" title="A new look">
        <Text maxW="70ch">
          The dashboard and documentation have been redesigned. DataPipe is
          dark-only now — a light/dark toggle shipped briefly and was
          retired.
        </Text>
      </DocsSection>

      <DocsSection id="questions" title="Questions">
        <Text maxW="70ch">
          Something on this page doesn&apos;t match what you&apos;re seeing,
          or you ran into a problem after this update? Open an issue on{" "}
          <ProseLink href="https://github.com/jspsych/datapipe/issues" external>
            GitHub
          </ProseLink>{" "}
          or use the address on the{" "}
          <ProseLink href="/contact">contact page</ProseLink>.
        </Text>
      </DocsSection>
    </>
  );
}

WhatsChangedPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
