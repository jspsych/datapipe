import {
  Stack,
  Heading,
  Text,
  Link,
  Box,
  HStack,
  VStack,
  Collapsible,
  Button,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight, Shield } from "lucide-react";
import { useState } from "react";
import { osfSunsetLabel } from "../lib/osf-sunset";

// Which Zenodo this deployment points at -- "" on production, "sandbox." on
// the test site. Same reasoning as lib/provider-config.js: the test
// deployment must not send researchers to sign up on the live service.
const ZENODO_HOST = `https://${process.env.NEXT_PUBLIC_ZENODO_ENV ?? ""}zenodo.org`;

function StepNumber({ number }) {
  return (
    <Box
      flexShrink={0}
      w="36px"
      h="36px"
      borderRadius="full"
      bg="brandGreen.solid"
      color="brandGreen.contrast"
      display="flex"
      alignItems="center"
      justifyContent="center"
      fontWeight="bold"
      fontSize="lg"
    >
      {number}
    </Box>
  );
}

function StepCard({ number, title, children }) {
  return (
    <Box
      // Was bg="black" -- a Card per DESIGN.md §1's own bucket ("Cards,
      // dialogs, menus" -> bg.panel). Dark's bg.panel is #1C1F22, identical
      // to the page body, so the border is now the only edge (per DESIGN.md:
      // "panels must carry a border" -- page<->panel separation is 1.07:1
      // by design in both modes).
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius={12}
      p={[4, 6]}
      w="100%"
    >
      <HStack gap={3} mb={4} alignItems="center">
        <StepNumber number={number} />
        <Heading as="h2" fontSize="xl">
          {title}
        </Heading>
      </HStack>
      {/* 12 == 48px == StepNumber (36px) + the header HStack's gap={3}:
          the step body hangs off the title, not the number. Was the raw
          string "48px". */}
      <Stack gap={4} pl={[0, 12]}>
        {children}
      </Stack>
    </Box>
  );
}

function Callout({ children }) {
  return (
    <Box
      // Tinted callout: brandGreen.subtle + brandGreen.border. Text below has
      // no explicit color, so it inherits the page's neutral `fg` -- exactly
      // the caveat in DESIGN.md §1 ("body text on brandGreen.subtle must be
      // brandGreen.50 or neutral fg, never brandGreen.300").
      bg="brandGreen.subtle"
      border="1px solid"
      borderColor="brandGreen.border"
      borderRadius={8}
      px={4}
      py={4}
    >
      <HStack gap={2} alignItems="flex-start">
        <Shield size={18} style={{ flexShrink: 0, marginTop: "3px" }} />
        <Text fontSize="sm">{children}</Text>
      </HStack>
    </Box>
  );
}

function CollapsibleSection({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Collapsible.Trigger asChild>
        <Button
          variant="ghost"
          color="fg.muted"
          size="sm"
          px={0}
          _hover={{ color: "fg", bg: "transparent" }}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {title}
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        {/* Decorative hairline inside an already-grouped (collapsed)
            region, not the section's own boundary -- border.subtle. */}
        <Stack gap={3} pt={2} pb={4} pl={4} borderLeft="1px solid" borderColor="border.subtle">
          {children}
        </Stack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function FeatureItem({ name, children }) {
  return (
    <Box>
      <Text>
        <Text as="span" fontWeight="semibold" color="brandOrange.fg">{name}</Text>
        {" "}{children}
      </Text>
    </Box>
  );
}

// One storage provider, in the terms a researcher choosing between them
// actually needs: whether it is the right fit, where the data physically ends
// up, how they connect, and the limit that will eventually matter. The
// decision sentence leads because that is the only line someone skimming for
// "which one do I pick" needs to read. Plain rows rather than a comparison
// table so it stays readable on a phone.
function ProviderOption({ name, summary, landsIn, connect, limits }) {
  return (
    // Sole visual boundary of the row (WCAG 1.4.11 "panel edge"), so this
    // uses `border` (gray.500, 4.50 light / 3.43 dark) rather than
    // `border.subtle`, which DESIGN.md bans as a lone grouping device.
    <Box borderWidth="1px" borderColor="border" borderRadius={8} p={4}>
      <Text fontWeight="semibold" color="brandOrange.fg" mb={2}>
        {name}
      </Text>
      <Text fontSize="sm" mb={3}>
        {summary}
      </Text>
      <Stack gap={2}>
        <Text fontSize="sm" color="fg.muted">
          <Text as="span" fontWeight="semibold">Data lands in:</Text> {landsIn}
        </Text>
        <Text fontSize="sm" color="fg.muted">
          <Text as="span" fontWeight="semibold">Connect with:</Text> {connect}
        </Text>
        <Text fontSize="sm" color="fg.muted">
          <Text as="span" fontWeight="semibold">Limits:</Text> {limits}
        </Text>
      </Stack>
    </Box>
  );
}

export default function GettingStarted() {
  const osfDeadline = osfSunsetLabel();
  // Consequence first (PRODUCT.md principle 2): what stops working, then why.
  // Both sentences degrade gracefully when no cutoff has been announced --
  // lib/osf-sunset.js tolerates a null date and so must every reader of it.
  const osfStops = osfDeadline
    ? `DataPipe will stop writing to OSF after ${osfDeadline}.`
    : "DataPipe is winding down its support for OSF.";
  const osfUntil = osfDeadline
    ? "Experiments already collecting keep running until that date."
    : "Experiments already collecting keep running for now.";

  return (
    // 960 is one of the stray measures DESIGN.md §4 names for consolidation;
    // this is a public docs page with cards, code blocks and a provider grid,
    // so it takes the 1100px measure. `py={4}` is gone: the navbar gap and
    // the footer gap are set once in _app.js for every page.
    <Stack w="100%" maxW="1100px" gap={8}>
      <VStack gap={2} align="start">
        <Heading as="h1" size="2xl">
          Getting Started
        </Heading>
        <Text color="fg.muted" fontSize="lg">
          DataPipe sends data from your experiment straight to storage you
          control — Google Drive, Dataverse, or Zenodo. This guide sets up one
          experiment end to end, from choosing a provider to your first test
          run.
        </Text>
      </VStack>

      <StepCard number={1} title="Choose where your data goes">
        <Text>
          DataPipe writes each participant&apos;s data into your own account
          with one of the three storage providers below. The data is yours
          throughout — DataPipe only ever asks for permission to add files.
          You can use a different provider for each experiment, so this choice
          is not permanent.
        </Text>
        <Stack gap={3}>
          <ProviderOption
            name="Google Drive"
            summary="Your own Google Drive. Choose this if you want the fewest steps and do not need a citable dataset."
            landsIn="a folder in My Drive/DataPipe, or in a parent folder you pick."
            connect="your Google account, in one click."
            limits="free Google accounts share 15 GB across Drive, Gmail, and Photos. Uploads stop once that is full."
          />
          <ProviderOption
            name="Dataverse"
            summary="Institutional repositories run by universities and consortia — Harvard Dataverse, Borealis, DataverseNL, and others. Choose this if your institution or funder expects data to live there."
            landsIn="a draft dataset, in a collection you name."
            connect="an API token from your institution's installation."
            limits="your installation sets its own file size and storage limits. API tokens expire, often yearly, and DataPipe cannot renew them — data stops arriving until you reconnect."
          />
          <ProviderOption
            name="Zenodo"
            summary="An open repository run by CERN that issues a DOI for every published record. Choose this if you want your data citable without an institutional repository."
            landsIn="a deposition that stays private until you publish it."
            connect="your Zenodo account, in one click."
            limits="100 files and 50 GB per record. DataPipe merges completed sessions into archives so a long study stays under the file limit."
          />
        </Stack>
        <Text>
          You need an account with whichever provider you choose:{" "}
          <Link href="https://drive.google.com" target="_blank" rel="noopener noreferrer" color="brandOrange.fg">
            Google Drive
          </Link>
          ,{" "}
          <Link href="https://dataverse.org/institutions" target="_blank" rel="noopener noreferrer" color="brandOrange.fg">
            your Dataverse installation
          </Link>
          , or{" "}
          <Link href={ZENODO_HOST} target="_blank" rel="noopener noreferrer" color="brandOrange.fg">
            Zenodo
          </Link>
          .
        </Text>
        <CollapsibleSection title="Already collecting data on OSF?">
          <Text>
            {osfStops} OSF is shutting down its projects feature, so DataPipe
            can no longer create new experiments there. {osfUntil}
          </Text>
          <Text>
            Data already on OSF is unaffected and stays in your OSF account. To
            keep collecting past that point, connect one of the providers
            above, create a new experiment on it, and point your experiment
            code at the new experiment ID.
          </Text>
        </CollapsibleSection>
      </StepCard>

      <StepCard number={2} title="Connect your storage provider">
        <Text>
          Go to your{" "}
          <Link href="/admin/account" color="brandOrange.fg">
            Account Settings
          </Link>
          {" "}and find the <strong>Storage Providers</strong> section. Click{" "}
          <strong>Connect</strong> next to the provider you chose. A green{" "}
          <strong>Connected</strong> label confirms it worked.
        </Text>
        <Text>
          <strong>Google Drive</strong> and <strong>Zenodo</strong> hand you
          to their own sign-in page to authorize DataPipe, then bring you
          straight back.
        </Text>
        <Text>
          <strong>Dataverse</strong> opens a short form instead. It needs the
          full address of your institution&apos;s installation — for
          example, <em>https://dataverse.harvard.edu</em> — and an API token,
          which you create under the <strong>API Token</strong> tab of your
          Dataverse account.
        </Text>
        <Text color="fg.muted" fontSize="sm">
          You can connect more than one provider, and disconnect any of them
          from the same screen. Disconnecting stops new data from reaching
          that provider. It never removes data already stored there.
        </Text>
      </StepCard>

      <StepCard number={3} title="Create a DataPipe experiment">
        <Text>
          Click <strong>New Experiment</strong> in the navigation bar. Pick
          your storage provider at the top of the form and give the experiment
          a <strong>Title</strong>. The rest of the form changes with the
          provider:
        </Text>
        <Stack gap={2} pl={4}>
          <Text>
            <Text as="span" fontWeight="semibold">Google Drive</Text> — nothing
            else is required. To keep the data somewhere specific,
            click <strong>Choose Drive folder</strong> and pick a parent
            folder. Otherwise DataPipe creates the folder
            in <em>My Drive/DataPipe</em>.
          </Text>
          <Text>
            <Text as="span" fontWeight="semibold">Dataverse</Text> — the{" "}
            <strong>collection alias</strong>, which is the short name from
            your collection&apos;s URL, plus the author name, contact email,
            and description that Dataverse requires for every dataset. Subject
            is optional.
          </Text>
          <Text>
            <Text as="span" fontWeight="semibold">Zenodo</Text> — the{" "}
            <strong>creator name</strong> and a <strong>description</strong>{" "}
            for the deposition. Affiliation is optional.
          </Text>
        </Stack>
        <Text>
          Click <strong>Create</strong>. DataPipe makes the folder, dataset,
          or deposition for you and opens the experiment dashboard, which
          links straight to it.
        </Text>
      </StepCard>

      <StepCard number={4} title="Configure the experiment">
        <Text>
          The experiment dashboard has several optional features you can enable:
        </Text>
        <Stack gap={3}>
          <FeatureItem name="Condition assignment">
            — request the next sequential condition number. DataPipe cycles
            through conditions (0, 1, 2, ... back to 0).
          </FeatureItem>
          <FeatureItem name="Data validation">
            — check that incoming data is valid JSON or CSV. You can also
            specify required fields. This helps prevent malicious submissions.
          </FeatureItem>
          <FeatureItem name="Session limit">
            — cap how many data files DataPipe will accept. You can raise the
            limit later.
          </FeatureItem>
          <FeatureItem name="Psych-DS metadata">
            — automatically produce metadata adhering to{" "}
            <Link href="https://psychds-docs.readthedocs.io/en/latest/" target="_blank" rel="noopener noreferrer" color="brandOrange.fg">
              Psych-DS
            </Link>
            , updated after each session. See{" "}
            <Link href="/faq#item-11" color="brandOrange.fg">how it works</Link>
            {" "}in the FAQ.
          </FeatureItem>
        </Stack>
        <Callout>
          Only activate the features you need, and only during active data
          collection. DataPipe creates an open path into your storage provider
          — validation and session limits reduce the risk of unwanted
          submissions.
        </Callout>
      </StepCard>

      <StepCard number={5} title="Add code to your experiment">
        <Text>
          Add code to send data from your experiment to DataPipe. If you use
          jsPsych, the easiest option is the{" "}
          <Link href="https://github.com/jspsych/jspsych-contrib/tree/main/packages/plugin-pipe" target="_blank" rel="noopener noreferrer" color="brandOrange.fg">
            jsPsychPipe plugin
          </Link>
          . Otherwise, you can use the DataPipe API directly with fetch requests.
        </Text>
        <Text>
          The code is the same whichever storage provider you chose — your
          experiment sends data to DataPipe, and DataPipe handles the rest.
          Your experiment dashboard has ready-to-use snippets for both jsPsych
          and plain JavaScript. Go to{" "}
          <Link href="/admin" color="brandOrange.fg">My Experiments</Link>,
          select your experiment, and copy the code from the{" "}
          <strong>Code Samples</strong> panel.
        </Text>
      </StepCard>

      <StepCard number={6} title="Publish your experiment online">
        <Text>
          Host your experiment on any web server — university hosting, GitHub
          Pages, Netlify, etc. Below is a quick guide for GitHub Pages.
        </Text>
        <CollapsibleSection title="GitHub Pages setup instructions">
          <Text>
            1. Create a GitHub account at{" "}
            <Link href="https://www.github.com" target="_blank" rel="noopener noreferrer" color="brandOrange.fg">
              github.com
            </Link>
            {" "}and{" "}
            <Link href="https://www.github.com/new" target="_blank" rel="noopener noreferrer" color="brandOrange.fg">
              create a new repository
            </Link>
            . The repo name becomes part of your experiment URL, so avoid
            names that reveal information to participants. Check the box
            to add a README file.
          </Text>
          <Text>
            2. Go to <strong>Settings &rarr; Pages</strong> in your
            repository. Set the source to <strong>Deploy from a branch</strong> and
            select <strong>main</strong>. Click <strong>Save</strong>.
          </Text>
          <Text>
            3. Click <strong>Add Files &rarr; Upload Files</strong> and upload
            your experiment files. Click <strong>Commit Changes</strong>.
          </Text>
          <Text>
            Your experiment will be available
            at <em>https://[username].github.io/[repo-name]</em>. If your
            HTML file is not named <em>index.html</em>, append the filename to
            the URL. It may take a few minutes for the site to become
            available after uploading.
          </Text>
        </CollapsibleSection>
      </StepCard>

      <StepCard number={7} title="Activate and test">
        <Text>
          Back on the experiment dashboard, turn on the features you need:
        </Text>
        <Stack gap={2} pl={4}>
          <Text>
            <Text as="span" fontWeight="semibold">Enable data collection</Text> — for
            sending text files (JSON, CSV).
          </Text>
          <Text>
            <Text as="span" fontWeight="semibold">Enable base64 data collection</Text> — for
            binary data like audio, video, or images.
          </Text>
          <Text>
            <Text as="span" fontWeight="semibold">Enable condition assignment</Text> — for
            automated condition cycling.
          </Text>
        </Stack>
        <Text>
          Run through your experiment once to check that the data arrives. The
          experiment dashboard links straight to your Drive folder, Dataverse
          dataset, or Zenodo deposition — your file should appear there
          shortly after you finish.
        </Text>
      </StepCard>

      {/* mt={8} over the stack's gap={8} = 64px. Eight steps at an
          identical 32px told the reader nothing about which one is
          different; this last one is the irreversible one (finalizing
          cannot be undone), so it gets the break DESIGN.md §4 reserves for
          a consequential section. */}
      <Box mt={8}>
        <StepCard number={8} title="When data collection ends">
        <Text>
          When your study is finished, <strong>finalize</strong> the
          experiment from its dashboard. DataPipe merges every remaining data
          file into a single archive on your storage provider and stops
          accepting new submissions, which makes the dataset easier to share
          and cite. Finalizing cannot be undone, so do it only when you are
          certain no more data is coming.
        </Text>
        <Text color="fg.muted" fontSize="sm">
          On Zenodo, finalizing prepares the deposition but does not publish
          it. Publishing the record, and with it issuing the DOI, stays your
          decision and happens on Zenodo itself.
        </Text>
        </StepCard>
      </Box>
    </Stack>
  );
}
