import NextLink from "next/link";
import { useContext } from "react";
import { UserContext } from "../lib/context";
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Stack,
  Link,
} from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import TestEnvironmentWarning from "../components/TestEnvironmentWarning";
import CodeSpecimen from "../components/home/CodeSpecimen";
import ArrivalsPanel from "../components/home/ArrivalsPanel";
import { osfSunsetLabel } from "../lib/osf-sunset";

// Prose links carry a PERSISTENT underline. styles/globals.css strips
// underlines globally, and no color on this palette can carry a link by color
// alone in both modes -- against body text, light brandGreen.800 vs gray.700 is
// 2.04:1 and dark brandGreen.300 vs gray.300 is 1.36:1, both under WCAG F73's
// 3:1. The underline is what makes a link a link here; the color is secondary.
function ProseLink({ href, external, children }) {
  const style = {
    color: "brandGreen.fg",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    _hover: { textDecorationThickness: "2px" },
  };

  if (external) {
    return (
      <Link href={href} target="_blank" rel="noopener noreferrer" {...style}>
        {children}
      </Link>
    );
  }

  return (
    <Link asChild {...style}>
      <NextLink href={href}>{children}</NextLink>
    </Link>
  );
}

function StepItem({ number, children }) {
  return (
    <HStack gap={3} align="start">
      <Text fontWeight="bold" color="brandGreen.fg" flexShrink={0}>
        {number}.
      </Text>
      {/* The three steps are the argument for the product, not a hint under a
          field: body size, body color (DESIGN.md §3). */}
      <Text lineHeight="tall">{children}</Text>
    </HStack>
  );
}

function Feature({ title, children }) {
  return (
    <VStack align="start" gap={2} flex="1" minW="200px">
      <Heading as="h3" fontSize="lg" fontWeight="600">
        {title}
      </Heading>
      <Text color="fg.muted" lineHeight="tall">
        {children}
      </Text>
    </VStack>
  );
}

export default function Home() {
  const { user } = useContext(UserContext);
  // Read from lib/osf-sunset.js, like the FAQ and the getting-started guide, so
  // the three surfaces can never disagree about the date. Tolerates a null date
  // the same way they do.
  const osfDeadline = osfSunsetLabel();

  const primaryHref = user ? "/admin" : "/signup";
  const primaryLabel = user ? "Go to dashboard" : "Get started";

  return (
    <Box w="100%">
      {/* Hero */}
      <Box px={[4, 8, 12]} pt={[12, 16]} pb={[12, 16]} maxW="1100px" mx="auto">
        <Stack
          direction={["column", "column", "row"]}
          gap={[12, 12, 16]}
          align="start"
        >
          <VStack gap={6} align="start" flex="1" maxW="640px">
            {/* No accent word. The only saturated pixels above the fold are the
                primary button and the code specimen, which is what "plain and
                trustworthy" looks like as a decision rather than an absence.
                The retired orange accent was also 1.81:1 on the light page. */}
            <Heading
              as="h1"
              fontSize={["3xl", "4xl", "5xl"]}
              fontWeight="700"
              lineHeight="1.15"
            >
              Experiment data, straight to storage you control.
            </Heading>
            <Text fontSize={["md", "lg"]} color="fg.muted" lineHeight="tall">
              DataPipe is a free, open-source service that sends data from any
              online experiment to your own Google Drive, Dataverse, or Zenodo
              account. No server to set up, no download step.
            </Text>
            <Text lineHeight="tall">
              The account stays yours throughout: DataPipe only ever asks for
              permission to add files.
            </Text>
            {/* TODO(owner): retention claim -- needs a decision on what DataPipe
                retains and for how long */}
            <HStack gap={4} pt={2} flexWrap="wrap">
              {/* asChild, not <Link><Button> -- that rendered <a><button></a>:
                  invalid HTML, two tab stops for one control, and a focus ring
                  on the element that is not focused. */}
              <Button asChild colorPalette="brandGreen" size="lg">
                <NextLink href={primaryHref}>
                  {primaryLabel} <ArrowRight size={18} />
                </NextLink>
              </Button>
              {/* One primary action per screen (DESIGN.md §5). The secondary
                  action is a neutral ghost and takes its colors from the recipe
                  rather than naming them. */}
              <Button asChild variant="ghost" size="lg">
                <NextLink href="/getting-started">How it works</NextLink>
              </Button>
            </HStack>
            <Text fontSize="sm" color="fg.muted">
              Built by the{" "}
              <ProseLink href="https://www.jspsych.org" external>
                jsPsych
              </ProseLink>{" "}
              team
            </Text>
          </VStack>

          {/* The specimen: what you send, then what you get. It renders at every
              breakpoint now -- it is the page's proof, and hiding it below 768px
              meant most first visits (a link in a paper, a message from a
              labmate) never saw it. */}
          <VStack
            gap={6}
            align="stretch"
            flex="1"
            w="100%"
            maxW={["100%", "100%", "480px"]}
          >
            <Box as="figure" m={0}>
              <CodeSpecimen />
              <Text as="figcaption" fontSize="sm" color="fg.muted" mt={3}>
                The code is the same whichever provider you chose. Full details
                are in the{" "}
                <ProseLink href="/api-docs">API reference</ProseLink>.
              </Text>
            </Box>
            <Box as="figure" m={0}>
              <ArrivalsPanel />
              <Text as="figcaption" fontSize="sm" color="fg.muted" mt={3}>
                Illustration. Each session arrives as its own file in the
                folder, dataset, or deposition you connected.
              </Text>
            </Box>
          </VStack>
        </Stack>
      </Box>

      {/* How it works. No band: #000 was 1.27:1 against the page and
          unsalvageable in light mode, and spacing carries the grouping
          (DESIGN.md §4). No eyebrow: §8 ban 1. */}
      <Box px={[4, 8, 12]} py={[12, 16]}>
        <Box maxW="1100px" mx="auto">
          <Stack direction={["column", "column", "row"]} gap={[8, 8, 16]}>
            <Box flex="1">
              <Heading as="h2" fontSize={["xl", "2xl"]} fontWeight="700">
                Three steps to start collecting data
              </Heading>
            </Box>
            <VStack align="start" gap={4} flex="1.5" maxW="70ch">
              <StepItem number="1">
                Connect a storage provider — Google Drive, Dataverse, or Zenodo
                — to your DataPipe account.
              </StepItem>
              <StepItem number="2">
                Create an experiment on DataPipe and add a few lines of code to
                your study to send data through the API.
              </StepItem>
              <StepItem number="3">
                Turn on data collection. Each participant&apos;s data goes
                straight to your folder, dataset, or deposition — no downloads,
                no manual transfers.
              </StepItem>
            </VStack>
          </Stack>
        </Box>
      </Box>

      {/* What DataPipe does */}
      <Box px={[4, 8, 12]} py={[12, 16]}>
        <Box maxW="1100px" mx="auto">
          <Heading as="h2" fontSize={["xl", "2xl"]} fontWeight="700" mb={8}>
            What DataPipe does
          </Heading>

          <Box mb={[8, 8, 12]} maxW="70ch">
            <Heading as="h3" fontSize="lg" fontWeight="600" mb={2}>
              Born-open data collection
            </Heading>
            <Text color="fg.muted" lineHeight="tall">
              DataPipe sends experiment data to your storage as it is collected,
              so openness is the default rather than an afterthought. The
              rationale and design are described in{" "}
              <ProseLink href="https://doi.org/10.3758/s13428-023-02161-x" external>
                <em>Behavior Research Methods</em>
              </ProseLink>
              . If you use DataPipe in your research, we&apos;d appreciate a
              citation.
            </Text>
          </Box>

          {/* No icons above the cards. Database / Shield / Zap were decoration
              at the same size as the headings they sat on, and one of them meant
              nothing at all. */}
          <Stack direction={["column", "column", "row"]} gap={[8, 8, 12]}>
            <Feature title="Multiple data formats">
              Send CSV, JSON, or base64-encoded files such as audio and video
              recordings. DataPipe decodes them and stores them for you.
            </Feature>
            <Feature title="Built-in safeguards">
              Data validation, session limits, and required-field checks protect
              your storage from malformed or malicious submissions.
            </Feature>
            <Feature title="Condition assignment">
              DataPipe hands out condition numbers in sequence, so assignment
              stays balanced as data arrives. No server-side code required.
            </Feature>
          </Stack>
        </Box>
      </Box>

      {/* A door at the end, for the reader who got this far. Same action as the
          hero, not a second competing one. */}
      <Box px={[4, 8, 12]} pt={16} pb={[12, 16]}>
        <VStack maxW="1100px" mx="auto" align="start" gap={6}>
          <Heading as="h2" fontSize={["xl", "2xl"]} fontWeight="700">
            Set up your first experiment
          </Heading>
          <Text maxW="70ch" lineHeight="tall">
            Pick a provider, connect it, and paste a few lines of code into your
            study. The{" "}
            <ProseLink href="/getting-started">getting started guide</ProseLink>{" "}
            walks through all of it, end to end.
          </Text>
          <Button asChild colorPalette="brandGreen" size="lg">
            <NextLink href={primaryHref}>
              {primaryLabel} <ArrowRight size={18} />
            </NextLink>
          </Button>
          <Text fontSize="sm" color="fg.muted" maxW="70ch">
            The <ProseLink href="/faq">FAQ</ProseLink> covers what DataPipe
            stores, what it costs to run, and what happens when an upload fails.
          </Text>
          <Text fontSize="sm" color="fg.muted" maxW="70ch">
            Already collecting on OSF?{" "}
            {osfDeadline
              ? `DataPipe will stop writing to OSF after ${osfDeadline}.`
              : "DataPipe is winding down its support for OSF."}{" "}
            Data already there stays in your OSF account —{" "}
            <ProseLink href="/faq#item-0b">what to do next</ProseLink>.
          </Text>
        </VStack>
      </Box>
    </Box>
  );
}

Home.getLayout = function getLayout(page) {
  return (
    <Box minH="100vh" display="flex" flexDirection="column">
      <Navbar />
      <Box flexGrow={1}>{page}</Box>
      <Footer />
      {/* Truthy, not `!== ""`: NEXT_PUBLIC_OSF_ENV is undefined in production,
          and `undefined !== ""` put a red "OSF Environment:" banner on the
          public homepage. pages/_app.js:38 still has the original test and is
          owned elsewhere. */}
      {Boolean(process.env.NEXT_PUBLIC_OSF_ENV) && <TestEnvironmentWarning />}
    </Box>
  );
};
