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
function SubHeading({ id, children }) {
  return (
    <Heading
      as="h3"
      id={id}
      fontSize="md"
      fontWeight="600"
      color="fg"
      mt={2}
      // Same offset DocsSection gives its own headings, so a link to a
      // sub-topic does not land underneath the sticky navbar.
      scrollMarginTop="24"
    >
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
        purpose="DataPipe had a large update in September 2026. This page explains what changed and why, from the largest change to the smallest."
      />

      {/* THE ORDER IS THE ARGUMENT. One fact drives this release -- OSF is
          closing the feature DataPipe was built on -- and the sections follow
          from it in order of size: where data goes, how it gets there, what
          gets written, then the dashboard, accounts, and last the small API
          changes that fall out of all that. Those small changes are the ones
          that can break existing code, so the callout below and the checklist
          at the end make sure a reader in a hurry still finds them. */}
      <Text maxW="70ch">
        DataPipe was built to do one thing: send experiment data to the Open
        Science Framework. OSF is shutting down the feature DataPipe depends
        on, so DataPipe now sends data to other places too. Most of what is
        new follows from that.
      </Text>
      <Text maxW="70ch">
        An experiment that is already collecting data keeps collecting. Its
        ID, its storage, and the way it sends data are unchanged.
      </Text>
      <Box borderWidth="1px" borderColor="border" bg="bg.muted" rounded="md" p={4} maxW="70ch">
        <Text fontSize="sm">
          <strong>Short on time?</strong> Go to{" "}
          <ProseLink href="#what-you-may-need-to-do">
            What you may need to do
          </ProseLink>
          . If your code reads DataPipe&apos;s responses, read{" "}
          <ProseLink href="#changes-to-the-api">Changes to the API</ProseLink>{" "}
          as well.
        </Text>
      </Box>

      <DocsSection id="where-your-data-goes" title="Where your data goes">
        <SubHeading id="osf">OSF is closing to new experiments</SubHeading>
        <Text maxW="70ch">
          OSF is shutting down its projects feature, so DataPipe can no
          longer create new experiments there.{" "}
          {osfDeadline
            ? `DataPipe will stop writing to OSF after ${osfDeadline}.`
            : "DataPipe is winding down its support for OSF."}{" "}
          An experiment already collecting on OSF keeps collecting until
          then.
        </Text>
        <GuidanceLine href="/docs/providers/osf" linkText="Moving off OSF">
          What changes, what happens to data you already collected, and how
          to move to another provider.
        </GuidanceLine>

        <SubHeading id="providers">Three new storage providers</SubHeading>
        <Text maxW="70ch">
          DataPipe can now send data to three more places.
        </Text>
        <Text maxW="70ch">
          <strong>Google Drive.</strong> Your own Drive, in a folder DataPipe
          creates. It is the quickest to connect.
        </Text>
        <Text maxW="70ch">
          <strong>Dataverse.</strong> Institutional repositories run by
          universities and consortia, such as Harvard Dataverse or Borealis.
          Choose it when your institution runs one and your data should stay
          under its terms.
        </Text>
        <Text maxW="70ch">
          <strong>Zenodo.</strong> An open repository run by CERN. Choose it
          for a study you plan to publish and cite: publishing a record
          issues a DOI.
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

      <DocsSection id="how-your-data-gets-there" title="How your data gets there">
        <SubHeading id="saving-as-it-runs">
          Saving data as the experiment runs
        </SubHeading>
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
          When a participant closes the tab or loses their connection partway
          through, you keep the trials they finished. DataPipe assembles them
          into a partial file, usually about fifteen minutes after the
          participant leaves. While a study runs, the experiment&apos;s
          dashboard shows <strong>Sessions in progress</strong>: how many
          participants are partway through, and how long each has been going.
        </Text>
        <Text maxW="70ch">
          An experiment that saves once at the end with the older jsPsychPipe
          plugin keeps working as it does now.
        </Text>
        <GuidanceLine href="/docs/experiments/streaming" linkText="Saving as you go">
          What to expect, what it means for privacy, and the limits it runs
          under.
        </GuidanceLine>

        <SubHeading id="when-an-upload-fails">When an upload fails</SubHeading>
        <Text maxW="70ch">
          When your storage provider can&apos;t take a submission, DataPipe
          now keeps a copy and retries: up to five attempts over about 31
          hours. The experiment&apos;s dashboard lists every file that is
          waiting or being retried. You can download any of them, or all of
          them as one ZIP, without waiting for a retry to succeed.
        </Text>
        <Text maxW="70ch">
          DataPipe sends one email when an experiment&apos;s uploads start
          failing, not one per file, and no more until the problem clears. It
          keeps a queued file for seven days, or up to fourteen if that email
          could not be delivered.
        </Text>
        <GuidanceLine href="/docs/data/failures" linkText="When an upload fails">
          The retry schedule, what each status on the panel means, and how to
          download a queued file.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="what-datapipe-writes" title="What DataPipe writes">
        <SubHeading id="psych-ds-metadata">Psych-DS metadata</SubHeading>
        <Text maxW="70ch">
          With Psych-DS metadata turned on, DataPipe now writes a{" "}
          <Code>dataset_description.json</Code>, a data table per session, and
          a sidecar table for any column that held nested values (survey
          responses, mouse-tracking samples). The tables go in{" "}
          <Code>data/</Code>. Your original submission is kept, byte for
          byte, in <Code>data/raw/</Code>.
        </Text>
        <Text maxW="70ch">
          <strong>Decide before you start collecting.</strong> You can change
          the setting until the first submission arrives. After that it locks
          for the life of the experiment. To change it later, create a new
          experiment.
        </Text>
        <GuidanceLine href="/docs/experiments/metadata" linkText="Psych-DS metadata">
          What gets written, where the variable descriptions come from, and
          why the setting locks.
        </GuidanceLine>

        <SubHeading id="finalizing">Finalizing a dataset</SubHeading>
        <Text maxW="70ch">
          When a Zenodo study is done, you can finalize the experiment from
          its dashboard. DataPipe merges everything into a single archive and
          permanently stops accepting submissions. Finalizing can&apos;t be
          undone, so do it only when you are certain no more data is coming.
        </Text>
        <Text maxW="70ch">
          During collection, DataPipe also bundles files into archives by
          itself when a Zenodo record nears its 100-file limit. Nothing is
          lost: your sessions are inside the archives.
        </Text>
        <GuidanceLine href="/docs/data/finalizing" linkText="Finishing a study">
          What finalizing does, which providers support it, and why it
          can&apos;t be undone.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="your-dashboard" title="Your dashboard">
        <SubHeading id="rejected-submissions">Rejected submissions</SubHeading>
        <Text maxW="70ch">
          Each experiment&apos;s dashboard now lists the submissions DataPipe
          refused, with the reason and the time of each. Before, a refusal
          left nothing you could see.
        </Text>
        <Text maxW="70ch">
          Use <strong>Clear this list</strong> once you have dealt with the
          entries. Later refusals appear as they happen.
        </Text>
        <GuidanceLine
          href="/docs/experiments/validation#rejected-data-is-gone"
          linkText="Rejected data is gone"
        >
          Why a rejected submission can&apos;t be recovered, and how to test
          your validation rules before participants arrive.
        </GuidanceLine>

        <SubHeading id="a-new-look">A new look</SubHeading>
        <Text maxW="70ch">
          The dashboard and the documentation have been redesigned, and
          DataPipe now uses a dark theme throughout.
        </Text>
      </DocsSection>

      <DocsSection id="your-account" title="Your account">
        <SubHeading id="signing-in">More ways to sign in</SubHeading>
        <Text maxW="70ch">
          You can sign in to DataPipe with Google, ORCID, GitHub, or an email
          address and password, and add more than one to the same account.
          OSF sign-in is being retired along with the rest of OSF support.
        </Text>
        <Text maxW="70ch">
          Deleting your account removes every experiment you own and
          everything DataPipe holds about them. Files already in your storage
          provider stay where they are.
        </Text>
        <GuidanceLine href="/docs/account" linkText="Account and security">
          Sign-in methods, how credentials are stored, and what account
          deletion removes.
        </GuidanceLine>

        <SubHeading id="contact-email">A contact email for every account</SubHeading>
        <Text maxW="70ch">
          If your account has no contact email address, DataPipe asks for one
          the next time you sign in, before it shows your experiments. It
          uses the address for one thing: telling you when uploads for one of
          your experiments start failing. Your experiments keep collecting
          whether or not you have signed in.
        </Text>
        <Text maxW="70ch">
          DataPipe notifies an unconfirmed address too, but it can&apos;t know
          the message arrives. You can change or confirm the address at any
          time in <ProseLink href="/admin/account">account settings</ProseLink>.
        </Text>

        <SubHeading id="privacy">Privacy and data handling</SubHeading>
        <Text maxW="70ch">
          DataPipe now has a privacy page written for IRB protocols and
          institutional security reviews: what it processes, what it stores,
          encryption, and where data is processed.
        </Text>
        <Text maxW="70ch">
          A submission held for retry is encrypted (AES-256-GCM) for as long
          as DataPipe holds it. Disconnecting Google Drive from your account
          settings deletes DataPipe&apos;s stored token and asks Google to
          revoke DataPipe&apos;s authorization.
        </Text>
        <GuidanceLine href="/docs/privacy" linkText="Privacy & information for IRBs">
          A paragraph you can adapt for a protocol, plus retention, access,
          and what DataPipe does not do with your data.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="changes-to-the-api" title="Changes to the API">
        <Text maxW="70ch">
          Two small changes can affect code you have already written. The way
          you send data, and every HTTP status code, are unchanged.
        </Text>

        <SubHeading id="error-codes">Three error codes were renamed</SubHeading>
        <Text maxW="70ch">
          Three error codes lost their OSF prefix, because every storage
          provider returns them: <Code>OSF_FILE_EXISTS</Code> is now{" "}
          <Code>FILE_EXISTS</Code>, <Code>OSF_UPLOAD_ERROR</Code> is now{" "}
          <Code>UPLOAD_ERROR</Code>, and <Code>OSF_UPLOAD_EXCEPTION</Code> is
          now <Code>UPLOAD_EXCEPTION</Code>.
        </Text>
        <Text maxW="70ch">
          This matters only to code that compares the <Code>error</Code>{" "}
          field of a response with one of the old names. Code that picks a new
          filename and retries after <Code>OSF_FILE_EXISTS</Code> is the usual
          case. That comparison now fails without an error.
        </Text>
        <GuidanceLine href="/docs/api#error-codes" linkText="Error codes">
          The full table, with what each one means and what status it comes
          back with.
        </GuidanceLine>

        <SubHeading id="metadata-options">
          The metadataOptions parameter was removed
        </SubHeading>
        <Text maxW="70ch">
          The data-saving endpoint no longer reads a{" "}
          <Code>metadataOptions</Code> field in the request body. The field
          was never documented, and it let any participant&apos;s submission
          set the name, author, or license in your dataset&apos;s description.
          If your code sends it, DataPipe ignores it.
        </Text>
      </DocsSection>

      <DocsSection id="what-you-may-need-to-do" title="What you may need to do">
        <Text maxW="70ch">
          Check this list against your own setup. An item applies only if
          its first sentence describes you.
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>Your code compares the error field with an old name.</strong>{" "}
            Change it to the new name, or test for both names until every
            experiment is updated. See{" "}
            <ProseLink href="#error-codes">Three error codes were renamed</ProseLink>.
          </Box>
          <Box as="li" mb={2}>
            <strong>Your code sends metadataOptions.</strong> Remove it. See{" "}
            <ProseLink href="#metadata-options">
              The metadataOptions parameter was removed
            </ProseLink>
            .
          </Box>
          <Box as="li" mb={2}>
            <strong>You have experiments on OSF.</strong> If your account
            settings ask you to re-authorize OSF, do it, so those experiments
            can keep saving. For a new study, connect Google Drive, Dataverse,
            or Zenodo. See{" "}
            <ProseLink href="#osf">OSF is closing to new experiments</ProseLink>.
          </Box>
          <Box as="li" mb={2}>
            <strong>OSF is your only way to sign in.</strong> Link another
            sign-in method in your account settings. Without one, you can lose
            access to the account that owns your experiments. See{" "}
            <ProseLink href="#signing-in">More ways to sign in</ProseLink>.
          </Box>
          <Box as="li" mb={2}>
            <strong>DataPipe asks you for a contact email.</strong> Enter an
            address, then confirm it from the email DataPipe sends. See{" "}
            <ProseLink href="#contact-email">
              A contact email for every account
            </ProseLink>
            .
          </Box>
        </Box>
      </DocsSection>

      <DocsSection id="questions" title="Questions">
        <Text maxW="70ch">
          If something on this page doesn&apos;t match what you see, or you
          hit a problem after the update, open an issue on{" "}
          <ProseLink href="https://github.com/jspsych/datapipe/issues" external>
            GitHub
          </ProseLink>{" "}
          or write to the address on the{" "}
          <ProseLink href="/contact">contact page</ProseLink>.
        </Text>
      </DocsSection>
    </>
  );
}

WhatsChangedPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
