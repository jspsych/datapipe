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

function StepNumber({ number }) {
  return (
    <Box
      flexShrink={0}
      w="36px"
      h="36px"
      borderRadius="full"
      bg="brandTeal.600"
      color="white"
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
      bg="black"
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
      <Stack gap={4} pl={[0, "48px"]}>
        {children}
      </Stack>
    </Box>
  );
}

function Callout({ children }) {
  return (
    <Box
      bg="brandTeal.900"
      border="1px solid"
      borderColor="brandTeal.700"
      borderRadius={8}
      px={4}
      py={3}
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
          color="gray.400"
          size="sm"
          px={0}
          _hover={{ color: "white", bg: "transparent" }}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {title}
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Stack gap={3} pt={2} pl={4} borderLeft="1px solid" borderColor="gray.700">
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
        <Text as="span" fontWeight="semibold" color="brandOrange.300">{name}</Text>
        {" "}{children}
      </Text>
    </Box>
  );
}

export default function GettingStarted() {
  return (
    <Stack w={["95%", 960]} gap={8} py={4}>
      <VStack gap={2} align="start">
        <Heading as="h1" size="2xl">
          Getting Started
        </Heading>
        <Text color="gray.400" fontSize="lg">
          Set up DataPipe to send experiment data directly to the OSF. This
          guide covers a typical online experiment using free tools.
        </Text>
      </VStack>

      <StepCard number={1} title="Create an OSF project">
        <Text>
          Create a project at{" "}
          <Link href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io`} target="_blank" rel="noopener noreferrer" color="brandOrange.300">
            osf.io
          </Link>
          {" "}to store your experiment data. You will need an OSF account
          — create one if you do not have one already.
        </Text>
        <Text>
          Once you have an account, click <strong>Create Project</strong> and
          give it any name you like. Your OSF account can also be used to
          sign in to DataPipe directly.
        </Text>
      </StepCard>

      <StepCard number={2} title="Link your OSF account to DataPipe">
        <Text>
          DataPipe needs authorization to create files in your OSF projects.
          If you signed up for DataPipe using your OSF account, this is
          already done.
        </Text>
        <Text>
          Otherwise, go to your{" "}
          <Link href="/admin/account" color="brandOrange.300">
            Account Settings
          </Link>
          , switch to one-click authentication if not already enabled, and
          click <strong>Link OSF Account</strong>. You will be redirected to
          OSF to authorize DataPipe, then sent back automatically.
        </Text>
        <CollapsibleSection title="Using a personal access token instead (legacy)">
          <Text>
            Go to your DataPipe Account Settings and switch to &quot;Personal
            access token&quot; mode. Then on OSF, go to your account settings,
            click the <strong>Personal Access Tokens</strong> tab, and create
            a new token with the <strong>osf.full_write</strong> scope.
          </Text>
          <Text>
            Copy the token value and paste it into your DataPipe Account
            Settings. A green checkmark will confirm the token is valid.
          </Text>
        </CollapsibleSection>
      </StepCard>

      <StepCard number={3} title="Create a DataPipe experiment">
        <Text>
          Click <strong>New Experiment</strong> in the navigation bar. You will
          need to provide:
        </Text>
        <Stack gap={2} pl={4}>
          <Text>
            <Text as="span" fontWeight="semibold">Title</Text> — a name for
            your experiment.
          </Text>
          <Text>
            <Text as="span" fontWeight="semibold">OSF Project ID</Text> — the
            short code from your OSF project URL. For example, if your project
            is at <em>osf.io/abcde</em>, the ID is <strong>abcde</strong>.
          </Text>
          <Text>
            <Text as="span" fontWeight="semibold">Data Component Name</Text> — DataPipe
            will create a new component with this name inside your OSF project
            to store all data files.
          </Text>
        </Stack>
        <Text>
          Click <strong>Create</strong> and you will be taken to the experiment
          dashboard.
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
            — cap the number of data files that can be sent to your OSF
            project. You can increase this later.
          </FeatureItem>
          <FeatureItem name="Psych-DS metadata">
            — automatically produce metadata adhering to{" "}
            <Link href="https://github.com/psych-ds/psych-DS" target="_blank" rel="noopener noreferrer" color="brandOrange.300">
              Psych-DS
            </Link>
            , updated after each session.
          </FeatureItem>
        </Stack>
        <Callout>
          Only activate the features you need, and only during active data
          collection. DataPipe creates an open path to your OSF project —
          validation and session limits reduce the risk of unwanted submissions.
        </Callout>
      </StepCard>

      <StepCard number={5} title="Add code to your experiment">
        <Text>
          Add code to send data from your experiment to DataPipe. If you use
          jsPsych, the easiest option is the{" "}
          <Link href="https://github.com/jspsych/jspsych-contrib/tree/main/packages/plugin-pipe" target="_blank" rel="noopener noreferrer" color="brandOrange.300">
            jsPsychPipe plugin
          </Link>
          . Otherwise, you can use the DataPipe API directly with fetch requests.
        </Text>
        <Text>
          Your experiment dashboard has ready-to-use code snippets for both
          jsPsych and plain JavaScript. Go to{" "}
          <Link href="/admin" color="brandOrange.300">My Experiments</Link>,
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
            <Link href="https://www.github.com" target="_blank" rel="noopener noreferrer" color="brandOrange.300">
              github.com
            </Link>
            {" "}and{" "}
            <Link href="https://www.github.com/new" target="_blank" rel="noopener noreferrer" color="brandOrange.300">
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
            sending text files (JSON, CSV) to OSF.
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
          Run through your experiment once to verify data files appear in
          your OSF data component. You should see them immediately after
          completing the experiment.
        </Text>
      </StepCard>
    </Stack>
  );
}
