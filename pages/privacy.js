import {
  Box,
  List,
  Stack,
  Text,
  Code,
  Link as ChakraLink,
} from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../components/ui/PageHeader";
import DocsSection from "../components/docs/DocsSection";

// DRAFT — GitHub issue #53 ("Add IRB-relevant information").
//
// This page is quasi-legal content that researchers will paste into IRB
// protocols and hand to institutional security reviewers, so every sentence
// here is meant to be traceable to code. Sections and the facts behind them:
//
//   pass-through flow ......... functions/src/api-data.ts, firebase.json rewrites
//   transient copy ............ functions/src/persist-pending.ts
//   queued copy + 7 days ...... functions/src/queue-upload.ts,
//                               functions/src/scheduled-upload-retry.ts (SEVEN_DAYS_MS)
//   payload encryption ........ functions/src/payload-crypto.ts (AES-256-GCM)
//   token encryption .......... functions/src/crypto-utils.ts (AES-256-GCM)
//   metadata `levels` ......... functions/src/metadata-production.ts,
//                               functions/src/metadata-update.ts,
//                               functions/metadata/dist/index.js updateFields()
//   logs ...................... functions/src/write-log.ts
//   bucket/db access .......... storage.rules, firestore.rules
//   account deletion .......... functions/src/purge-user-data.ts
//   drive.file scope .......... functions/src/providers/gdrive.ts
//   https-only providers ...... functions/src/connect-provider.ts
//
// DESIGN.md: 560px single-subject column (§4, same measure contact.js uses,
// ~70ch at the 16px body size), DocsSection for anchored h2s (§3), prose links
// green with a persistent underline (§5).

// Reviewers cite dated versions of a policy page, and researchers are told by
// their own institutions to monitor a vendor's terms for changes. A date is
// the cheapest way to make that possible.
const LAST_UPDATED = "24 August 2026";

// Same treatment as pages/docs/about.js's ProseLink: DESIGN.md §5 — links are
// brandGreen.fg with an underline, never signalled by color alone.
function ProseLink({ href, external, children }) {
  const style = {
    color: "brandGreen.fg",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  };

  if (external) {
    return (
      <ChakraLink
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...style}
      >
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

export default function PrivacyPage() {
  return (
    <Stack w="100%" maxW="560px">
      <PageHeader
        title="Privacy & information for IRBs"
        purpose="What DataPipe does with participant data, what it keeps, for how long, and who can reach it."
        mb={4}
      />

      <Text>
        This page exists so that you can answer an IRB protocol question or an
        institutional security review without having to read our source code. It
        describes how the service works, and it names the things DataPipe does
        not have. If you need a paragraph you can adapt for a protocol, there is
        one under{" "}
        <ProseLink href="#for-your-irb">For your IRB protocol</ProseLink>.
      </Text>

      <Text fontSize="sm" color="fg.muted">
        Last updated {LAST_UPDATED}. DataPipe is under active development; the
        full history of this page is in the{" "}
        <ProseLink
          href="https://github.com/jspsych/datapipe/commits/main/pages/privacy.js"
          external
        >
          repository
        </ProseLink>
        .
      </Text>

      <DocsSection id="what-datapipe-is" title="What DataPipe is">
        <Text>
          DataPipe is a free, open-source service run by the developers of
          jsPsych. It moves data out of a participant&apos;s browser and into a
          storage account that you already control. It is a pipe, not an
          archive: the storage provider you connect is where your data lives,
          and DataPipe is not the record of it.
        </Text>
        <Text>A submission takes one path:</Text>
        <List.Root as="ol" gap={2} ps={6}>
          <List.Item>
            The participant&apos;s browser sends the data over HTTPS to{" "}
            <Code>pipe.jspsych.org/api/data</Code>.
          </List.Item>
          <List.Item>
            A Google Cloud Function checks that the experiment exists and is
            accepting data, applies any validation rules you set, and — if you
            turned on Psych-DS metadata — parses the submission to derive column
            descriptions.
          </List.Item>
          <List.Item>
            The function writes the file into the storage location you connected
            (e.g., a Google Drive folder, a Dataverse dataset, or a Zenodo
            deposition), over HTTPS.
          </List.Item>
        </List.Root>
        <Text>
          Under normal operation all of that happens inside one request, and
          DataPipe keeps no copy afterwards. The exceptions — a transient copy
          held during the transfer, and a longer-lived copy when your provider
          is unreachable — are described below.
        </Text>
      </DocsSection>

      <DocsSection id="what-we-process" title="What DataPipe processes">
        <Text>
          DataPipe receives whatever your experiment chooses to send. It has no
          way to know whether that content is identifiable, and it never sees
          your consent form, your protocol, or your recruitment materials.
          Deciding what leaves a participant&apos;s browser is entirely yours.
        </Text>
        <Text>
          The submission is parsed in memory by the server, for two reasons
          only: to run the validation rules you configured, and to generate
          Psych-DS metadata if you enabled it. No person reads a submission in
          the ordinary course of running the service, and no part of a
          submission is written to DataPipe&apos;s logs.
        </Text>
        <Text>
          The condition-assignment endpoint (<Code>/api/condition</Code>)
          receives only an experiment ID. It returns a condition number and
          increments a counter; no participant data reaches it.
        </Text>
        <Text>
          <strong>IP addresses.</strong> DataPipe&apos;s own code never reads,
          stores, or forwards a participant&apos;s IP address or browser user
          agent, and neither is written to your experiment log or sent to your
          storage provider. Requests do pass through Google Cloud&apos;s hosting
          layer, which keeps its own platform request logs outside of
          DataPipe&apos;s application code; those are retained for 30 days (the
          Google Cloud default for the DataPipe project) and are not accessible
          to you through DataPipe. Data that transits an IP-logging hosting
          layer is normally described as de-identified or pseudonymous rather
          than anonymous.
        </Text>
      </DocsSection>

      <DocsSection id="what-we-store" title="What DataPipe stores">
        <List.Root as="ol" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              A transient copy of each submission.
            </Text>{" "}
            Before DataPipe attempts the write to your provider, it saves the
            submission to a private Google Cloud Storage bucket, so that a crash
            or a timeout mid-request cannot lose a participant&apos;s session.
            That copy is encrypted (see below) and is deleted as soon as the
            provider write succeeds — normally the same second.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Queued submissions.
            </Text>{" "}
            If your provider is unavailable, rate-limits DataPipe, or rejects
            the write, the submission is held in the same private bucket,
            encrypted, and retried on a schedule. You can download it from your
            dashboard in the meantime.{" "}
            <strong>
              A queued submission is deleted seven days after it was queued
            </strong>
            , whether or not the retries succeeded, along with its queue record.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Derived dataset metadata, if you enable Psych-DS metadata.
            </Text>{" "}
            The metadata document DataPipe keeps for an experiment describes
            each column in your data — and for columns that are not numeric it
            accumulates <Code>levels</Code>: the set of distinct values it has
            actually observed in that column. For numeric columns it keeps the
            minimum and maximum. There is no cap on how many distinct values are
            recorded. So if a column holds free text, an email address, or a
            participant identifier, those values are recorded in the metadata
            document, which persists for the life of the experiment rather than
            for seven days. Psych-DS metadata is off unless you switch it on per
            experiment.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Your experiment&apos;s configuration and its log.
            </Text>{" "}
            The log records how many times each endpoint was called, plus a list
            of errors with timestamps. No participant data is written to it. An
            error entry can, however, contain the filename your experiment chose
            and the raw text your storage provider returned.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Your researcher account.
            </Text>{" "}
            A sign-in record (your email address and the method you signed in
            with), the list of experiments you own, a notification email
            address, and your storage provider credentials. The record of each
            notification email DataPipe sends you exists to manage its delivery,
            and is deleted seven days after the email is sent.
          </List.Item>
        </List.Root>
        <Text>
          For providers with a hard file limit, DataPipe periodically merges
          older session files into a single archive inside your storage, and it
          can do the same on request when you finalize an experiment. Doing that
          means downloading your own files back out of your provider, combining
          them on DataPipe&apos;s server, and uploading the archive before
          deleting the originals. Those files are handled transiently and are
          not retained by DataPipe.
        </Text>
      </DocsSection>

      <DocsSection id="retention" title="Retention and deletion">
        <List.Root gap={2} ps={6}>
          <List.Item>
            Transient copy of a submission: deleted when the provider write
            lands. Anything left behind by an interrupted request is swept up
            within about fifteen minutes and moved into the upload queue.
          </List.Item>
          <List.Item>
            Queued submission: deleted seven days after it was queued.
          </List.Item>
          <List.Item>
            Psych-DS metadata document, experiment configuration, session count,
            and experiment log: kept for as long as the experiment exists.
          </List.Item>
          <List.Item>
            Notification email records: deleted seven days after delivery.
          </List.Item>
          <List.Item>
            Account record and stored provider credentials: kept until you
            delete your account.
          </List.Item>
        </List.Root>
        <Text>
          Deleting your account removes all of the above in one pass —
          experiments, metadata documents, logs, queued submissions and their
          stored files, filename records, notification records, and the account
          itself. It removes nothing from your storage provider; your data stays
          where you sent it.
        </Text>
        <Text>
          Deleting a single experiment removes its configuration, log, and
          metadata document. It likewise leaves your provider untouched.
        </Text>
      </DocsSection>

      <DocsSection id="encryption" title="Encryption">
        <Text>
          <strong>In transit.</strong> Requests to <Code>pipe.jspsych.org</Code>{" "}
          are served over HTTPS. Every call DataPipe makes to a storage provider
          is over HTTPS; for Dataverse, a server URL is rejected at connection
          time unless it is <Code>https</Code>.
        </Text>
        <Text>
          <strong>At rest, by DataPipe.</strong> The two copies of participant
          data DataPipe ever holds — the transient copy and a queued submission
          — are encrypted with AES-256-GCM before being written, using a key
          held only by DataPipe&apos;s server. Your storage provider credentials
          (OAuth access and refresh tokens, and any API token you supply) are
          encrypted with AES-256-GCM before being written to the database.
        </Text>
        <Text>
          <strong>At rest, by the platform.</strong> DataPipe runs on Google
          Cloud, which encrypts stored data at rest by default underneath
          everything above. See{" "}
          <ProseLink
            href="https://cloud.google.com/docs/security/encryption/default-encryption"
            external
          >
            Google Cloud&apos;s default encryption at rest
          </ProseLink>
          .
        </Text>
        <Text>
          <strong>Access rules.</strong> DataPipe&apos;s storage bucket denies
          all client reads and writes outright; it is reachable only by
          DataPipe&apos;s server code. In the database, an experiment, its log,
          its metadata, and its queued uploads can be read only by the account
          that owns the experiment.
        </Text>
        <Text>
          This is transport encryption plus encryption at rest. It is not
          end-to-end encryption: the server necessarily reads each submission in
          order to validate it and pass it on.
        </Text>
      </DocsSection>

      <DocsSection
        id="who-can-access"
        title="Who operates DataPipe, and who can reach your data"
      >
        <Text>
          DataPipe is operated by the developers of jsPsych and hosted on Google
          Cloud through Firebase. Google Cloud is DataPipe&apos;s infrastructure
          provider; Amazon SES is used to send notification email to
          researchers, and never to participants.
        </Text>
        <Text>
          <strong>
            A small number of project administrators hold credentials that can
            technically reach anything DataPipe stores
          </strong>{" "}
          — the transient and queued copies of submissions, metadata documents,
          experiment logs, and encrypted provider credentials. That access
          exists to operate and debug the service, and it is not used for
          research, analysis, or any other purpose. We would rather state this
          plainly than claim we cannot see your data.
        </Text>
        <Text>
          Once a file reaches your storage provider, DataPipe&apos;s access is
          only what you granted it. For Google Drive, DataPipe can only reach
          the files and folders it created or that you picked — not the rest of
          your Drive. For Dataverse, it uses an API token you issued and can
          revoke. For Zenodo, it uses the authorization you granted. You can
          disconnect any provider from your account settings at any time.
        </Text>
        <Text>
          Who can <em>see</em> the data at rest is set by your provider, and
          DataPipe changes none of those settings: a Drive folder is private
          until you share it, a Zenodo deposition is a private draft until you
          publish it, a Dataverse dataset is a draft until you publish it.
        </Text>
      </DocsSection>

      <DocsSection
        id="what-we-do-not-do"
        title="What DataPipe does not do with your data"
      >
        <List.Root gap={2} ps={6}>
          <List.Item>
            DataPipe does not sell, rent, license, or share participant data
            with any third party.
          </List.Item>
          <List.Item>
            DataPipe does not use participant data for research, analytics,
            product development, model training, or advertising.
          </List.Item>
          <List.Item>
            DataPipe claims no ownership of, and no rights over, the data that
            passes through it. It is yours and your institution&apos;s.
          </List.Item>
          <List.Item>
            DataPipe does not add tracking or analytics to the requests your
            experiment makes, and its API endpoints set no cookies.
          </List.Item>
          <List.Item>
            DataPipe never contacts participants. It holds no participant
            contact information unless your experiment put some into the data.
          </List.Item>
        </List.Root>
      </DocsSection>

      <DocsSection
        id="what-we-do-not-have"
        title="Certifications and agreements DataPipe does not have"
      >
        <Text>
          Institutional security reviews frequently ask for these, so here is a
          direct answer. DataPipe is a small, free, academic service. It holds{" "}
          <strong>no</strong> independent security certification: no SOC 2, no
          ISO 27001, no FedRAMP authorization, and no HITRUST. It has not been
          independently penetration tested. It is not HIPAA compliant and no
          business associate agreement is available, so DataPipe should not be
          used for protected health information.
        </Text>
        <Text>
          The underlying infrastructure carries its own certifications — see{" "}
          <ProseLink
            href="https://cloud.google.com/security/compliance/offerings"
            external
          >
            Google Cloud&apos;s compliance offerings
          </ProseLink>{" "}
          — but those belong to Google, not to DataPipe.
        </Text>
        <Text>
          If your protocol involves participants in the EU or UK, the ordinary
          reading is that you and your institution are the controller for
          participant data and DataPipe acts as a processor on your
          instructions; DataPipe is the controller only for your researcher
          account information. Whether that arrangement satisfies your
          institution is a question for your institution, not for us.
        </Text>
      </DocsSection>

      <DocsSection id="your-responsibilities" title="What is yours to decide">
        <Text>
          DataPipe has no view into your study design, so several protections
          can only be applied by you.
        </Text>
        <List.Root gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              What your experiment transmits.
            </Text>{" "}
            We strongly recommend not sending direct identifiers through
            DataPipe at all. If your study does not need a name, an email
            address, or an IP address, do not collect one.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Filenames.
            </Text>{" "}
            The filename your experiment chooses is visible in your storage
            provider and can appear in an error entry in your experiment log.
            Keep sensitive identifiers out of filenames and put them inside the
            data instead.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Whether to enable Psych-DS metadata.
            </Text>{" "}
            See the <ProseLink href="#what-we-store">levels</ProseLink> note
            above: with metadata on, observed values from non-numeric columns
            are recorded in a document that lives as long as the experiment.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              Where the data comes to rest, and who can see it there.
            </Text>{" "}
            Choosing a storage provider your institution permits, and setting
            that provider&apos;s sharing permissions, is yours alone.
          </List.Item>
        </List.Root>
        <Text>
          Your storage provider has its own privacy policy, and it governs the
          data once it arrives:{" "}
          <ProseLink href="https://policies.google.com/privacy" external>
            Google
          </ProseLink>
          ,{" "}
          <ProseLink href="https://about.zenodo.org/privacy-policy/" external>
            Zenodo
          </ProseLink>{" "}
          (hosted by CERN, in Switzerland), and — for Dataverse — the policy of
          the specific installation you use, since each is run by a different
          institution. Experiments still writing to the Open Science Framework
          are governed by the{" "}
          <ProseLink
            href="https://github.com/CenterForOpenScience/cos.io/blob/master/PRIVACY_POLICY.md"
            external
          >
            Center for Open Science privacy policy
          </ProseLink>
          ; DataPipe no longer accepts new OSF experiments.
        </Text>
      </DocsSection>

      <DocsSection id="jurisdiction" title="Where data is processed">
        <Text>
          DataPipe runs on Google Cloud Platform through Firebase. Its cloud
          functions run in Google Cloud&apos;s us-central1 region, and its
          database and storage bucket are in Google&apos;s US multi-region
          locations. All of it is inside the United States, and the service is
          operated from the United States.
        </Text>
        <Text>
          Your data does not stay there. It is written straight through to the
          storage provider you chose, which may be in a different jurisdiction
          entirely — Zenodo is hosted by CERN in Switzerland, a Dataverse
          installation is wherever its host institution runs it, and a Google
          Drive folder follows your own Google account. If data residency
          matters to your protocol, the provider you pick is the decision that
          settles it.
        </Text>
      </DocsSection>

      <DocsSection id="incidents" title="Security incidents">
        <Text>
          If you believe data handled by DataPipe has been exposed, or you have
          found a vulnerability, email Josh de Leeuw at jdeleeuw@vassar.edu
          rather than opening a public GitHub issue.
        </Text>
      </DocsSection>

      <DocsSection id="for-your-irb" title="For your IRB protocol">
        <Text>
          Adapt the paragraph below. Replace the bracketed parts, and delete
          anything that does not describe your study.
        </Text>
        <Box
          bg="bg.subtle"
          borderWidth="1px"
          borderColor="border.subtle"
          p={4}
          borderRadius="md"
        >
          <Text fontSize="sm">
            Data will be collected in the participant&apos;s web browser and
            transmitted over an encrypted (HTTPS) connection to DataPipe
            (pipe.jspsych.org), a free, open-source service operated by the
            developers of the jsPsych library and hosted on Google Cloud
            Platform. DataPipe functions as a pass-through: it validates each
            submission against rules set by the researcher and writes it
            directly into a [Google Drive folder / Dataverse dataset / Zenodo
            deposition] controlled by [the PI / the research team]. DataPipe
            does not retain a copy of the data in normal operation; a transient
            encrypted copy exists only for the duration of the transfer. If the
            storage provider is temporarily unreachable, the submission is held
            encrypted (AES-256-GCM) in a private, non-public cloud storage
            bucket for a maximum of seven days while delivery is retried, and is
            then deleted. DataPipe does not analyze, sell, share, or otherwise
            make use of the data, and claims no rights over it. The data will
            come to rest in [provider], where access is controlled by [the PI]
            under that provider&apos;s terms. DataPipe holds no independent
            security certification and is not HIPAA compliant; no protected
            health information will be transmitted through it.
          </Text>
        </Box>
      </DocsSection>

      <DocsSection id="questions" title="Questions">
        <Text>
          If something here does not answer your reviewer&apos;s question, ask —
          a question an IRB asks once tends to be a question this page should
          answer. Open an issue in the{" "}
          <ProseLink href="https://github.com/jspsych/datapipe/issues" external>
            GitHub repository
          </ProseLink>{" "}
          or use the address on the{" "}
          <ProseLink href="/contact">contact page</ProseLink>. Further detail on
          what DataPipe stores and logs is in the{" "}
          <ProseLink href="/docs/data">documentation</ProseLink>.
        </Text>
      </DocsSection>
    </Stack>
  );
}
