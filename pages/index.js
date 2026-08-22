import Link from "next/link";
import { useContext, useState, useEffect } from "react";
import { UserContext } from "../lib/context";
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Stack,
} from "@chakra-ui/react";
import { ArrowRight, Database, Shield, Zap, BookOpen } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import TestEnvironmentWarning from "../components/TestEnvironmentWarning";


function FeatureCard({ icon, title, children }) {
  return (
    <VStack
      align="start"
      gap={3}
      flex="1"
      minW="200px"
    >
      <Box
        color="brandOrange.400"
      >
        {icon}
      </Box>
      <Text fontWeight="bold" fontSize="lg">
        {title}
      </Text>
      <Text color="gray.400" fontSize="sm" lineHeight="tall">
        {children}
      </Text>
    </VStack>
  );
}

function StepItem({ number, children }) {
  return (
    <HStack gap={3} align="start">
      <Text
        fontWeight="bold"
        fontSize="sm"
        color="brandGreen.400"
        flexShrink={0}
        mt="1px"
      >
        {number}.
      </Text>
      <Text color="gray.300" fontSize="sm">
        {children}
      </Text>
    </HStack>
  );
}

const snippets = [
  {
    label: "jsPsych",
    filename: "experiment.html",
    caption: "Using jsPsych? One trial saves all your data.",
    lines: [
      { color: "gray.500", text: "// Save data with the jsPsych pipe plugin\n" },
      { color: "gray.300", text: "const " },
      { color: "brandOrange.300", text: "save_data" },
      { color: "gray.300", text: " = {\n" },
      { color: "gray.300", text: "  type: " },
      { color: "brandGreen.300", text: "jsPsychPipe" },
      { color: "gray.300", text: ",\n" },
      { color: "gray.300", text: '  action: ' },
      { color: "brandOrange.300", text: '"save"' },
      { color: "gray.300", text: ",\n" },
      { color: "gray.300", text: "  experiment_id: " },
      { color: "brandOrange.300", text: '"your_id"' },
      { color: "gray.300", text: ",\n" },
      { color: "gray.300", text: "  filename: " },
      { color: "brandOrange.300", text: "filename" },
      { color: "gray.300", text: ",\n" },
      { color: "gray.300", text: "  data_string: " },
      { color: "gray.400", text: "() =>\n" },
      { color: "gray.300", text: "    jsPsych.data.get()." },
      { color: "brandGreen.300", text: "csv" },
      { color: "gray.300", text: "()\n" },
      { color: "gray.300", text: "};" },
    ],
  },
  {
    label: "JavaScript",
    filename: "experiment.js",
    caption: "Not using jsPsych? A single fetch call is all you need.",
    lines: [
      { color: "gray.500", text: "// Send data with a fetch request\n" },
      { color: "brandGreen.300", text: "fetch" },
      { color: "gray.300", text: "(url, {\n" },
      { color: "gray.300", text: "  method: " },
      { color: "brandOrange.300", text: '"POST"' },
      { color: "gray.300", text: ",\n" },
      { color: "gray.300", text: "  headers: {\n" },
      { color: "gray.300", text: "    " },
      { color: "brandOrange.300", text: '"Content-Type"' },
      { color: "gray.300", text: ": " },
      { color: "brandOrange.300", text: '"application/json"' },
      { color: "gray.300", text: "\n  },\n" },
      { color: "gray.300", text: "  body: JSON." },
      { color: "brandGreen.300", text: "stringify" },
      { color: "gray.300", text: "({\n" },
      { color: "gray.300", text: "    experimentID: " },
      { color: "brandOrange.300", text: '"your_id"' },
      { color: "gray.300", text: ",\n" },
      { color: "gray.300", text: "    filename: " },
      { color: "brandOrange.300", text: '"subject01.csv"' },
      { color: "gray.300", text: ",\n" },
      { color: "gray.300", text: "    data: " },
      { color: "brandOrange.300", text: "dataAsString" },
      { color: "gray.300", text: "\n  })\n});" },
    ],
  },
];

function HeroCodeSnippet() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setActiveIndex((i) => (i + 1) % snippets.length);
        setFading(false);
      }, 300);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const snippet = snippets[activeIndex];

  return (
    <Box
      display={["none", "none", "block"]}
      flex="1"
      maxW="440px"
    >
      <Box
        bg="gray.950"
        borderRadius={12}
        border="1px solid"
        borderColor="gray.700"
        overflow="hidden"
      >
        <HStack
          px={4}
          py={2}
          bg="gray.900"
          borderBottom="1px solid"
          borderColor="gray.800"
          justifyContent="space-between"
        >
          <HStack gap={2}>
            <Box w="10px" h="10px" borderRadius="full" bg="gray.700" />
            <Box w="10px" h="10px" borderRadius="full" bg="gray.700" />
            <Box w="10px" h="10px" borderRadius="full" bg="gray.700" />
            <Text fontSize="xs" color="gray.500" ml={2}>{snippet.filename}</Text>
          </HStack>
          <HStack gap={0}>
            {snippets.map((s, i) => (
              <Button
                key={s.label}
                variant="ghost"
                size="xs"
                px={2}
                h="24px"
                fontSize="xs"
                color={i === activeIndex ? "white" : "gray.600"}
                bg={i === activeIndex ? "gray.800" : "transparent"}
                borderRadius={4}
                _hover={{ color: "white", bg: "gray.800" }}
                onClick={() => {
                  setFading(true);
                  setTimeout(() => {
                    setActiveIndex(i);
                    setFading(false);
                  }, 200);
                }}
              >
                {s.label}
              </Button>
            ))}
          </HStack>
        </HStack>
        <Box position="relative">
          {snippets.map((s, idx) => (
            <Box
              key={s.label}
              as="pre"
              p={5}
              fontSize="sm"
              fontFamily="monospace"
              lineHeight="1.7"
              whiteSpace="pre"
              opacity={idx === activeIndex && !fading ? 1 : 0}
              transition="opacity 0.3s ease"
              position={idx === 1 ? "relative" : "absolute"}
              top={idx === 1 ? undefined : 0}
              left={idx === 1 ? undefined : 0}
              right={idx === 1 ? undefined : 0}
            >
              {s.lines.map((line, i) => (
                <Text as="span" color={line.color} key={`${idx}-${i}`}>
                  {line.text}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
      <Text
        fontSize="xs"
        color="gray.400"
        mt={3}
        textAlign="center"
        minH="1.2em"
        opacity={fading ? 0 : 1}
        transition="opacity 0.3s ease"
      >
        {snippet.caption}
      </Text>
    </Box>
  );
}

export default function Home() {
  const { user } = useContext(UserContext);

  return (
    <Box w="100%">
      {/* Hero */}
      <Box
        px={[4, 8, 12]}
        pt={[12, 20]}
        pb={[16, 24]}
        maxW="1100px"
        mx="auto"
      >
        <Stack
          direction={["column", "column", "row"]}
          gap={[10, 10, 16]}
          align={["start", "start", "center"]}
        >
          <VStack gap={6} align="start" flex="1">
            <Heading
              as="h1"
              fontSize={["3xl", "5xl", "6xl"]}
              fontWeight="800"
              lineHeight="1.1"
              letterSpacing="-0.02em"
            >
              Experiment data,{" "}
              <Text as="span" color="brandOrange.400">
                straight to OSF.
              </Text>
            </Heading>
            <Text
              fontSize={["md", "lg"]}
              color="gray.400"
              maxW="540px"
              lineHeight="tall"
            >
              A free, open-source service that sends data from any online
              experiment directly to the Open Science Framework. No server
              setup, no download step.
            </Text>
            <HStack gap={4} pt={2} flexWrap="wrap">
              {user ? (
                <Link href="/admin">
                  <Button
                    colorPalette="brandGreen"
                    size="lg"
                  >
                    Go to Dashboard <ArrowRight size={18} />
                  </Button>
                </Link>
              ) : (
                <Link href="/signup">
                  <Button
                    colorPalette="brandGreen"
                    size="lg"
                  >
                    Get started <ArrowRight size={18} />
                  </Button>
                </Link>
              )}
              <Link href="/getting-started">
                <Button
                  variant="ghost"
                  color="gray.400"
                  size="lg"
                  _hover={{ color: "white", bg: "transparent" }}
                >
                  How it works
                </Button>
              </Link>
            </HStack>
            <Text fontSize="sm" color="gray.500">
              Built by the{" "}
              <Link href="https://www.jspsych.org" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                <Text as="span" color="gray.300" _hover={{ textDecoration: "underline" }}>jsPsych</Text>
              </Link>
              {" "}team
            </Text>
          </VStack>

          {/* Code snippet */}
          <HeroCodeSnippet />
        </Stack>
      </Box>

      {/* How it works */}
      <Box
        bg="black"
        px={[4, 8, 12]}
        py={[12, 16]}
      >
        <Box maxW="1100px" mx="auto">
          <Stack
            direction={["column", "column", "row"]}
            gap={[10, 10, 16]}
          >
            <VStack align="start" gap={4} flex="1">
              <Text
                fontSize="xs"
                fontWeight="bold"
                textTransform="uppercase"
                letterSpacing="0.1em"
                color="brandGreen.400"
              >
                How it works
              </Text>
              <Heading
                as="h2"
                  fontSize={["xl", "2xl"]}
                fontWeight="700"
              >
                Three steps to start collecting data
              </Heading>
            </VStack>
            <VStack align="start" gap={4} flex="1.5">
              <StepItem number="1">
                Create an OSF project and link your OSF account to DataPipe.
              </StepItem>
              <StepItem number="2">
                Set up an experiment on DataPipe and add a few lines of code
                to your study to send data through the API.
              </StepItem>
              <StepItem number="3">
                Activate data collection. Participant data goes straight to
                your OSF project as files — no downloads, no manual transfers.
              </StepItem>
            </VStack>
          </Stack>
        </Box>
      </Box>

      {/* Features */}
      <Box
        px={[4, 8, 12]}
        py={[12, 16]}
      >
        <Box maxW="1100px" mx="auto">
          <Text
            fontSize="xs"
            fontWeight="bold"
            textTransform="uppercase"
            letterSpacing="0.1em"
            color="brandGreen.400"
            mb={8}
          >
            Features
          </Text>

          {/* Born-open data */}
          <HStack gap={[4, 6]} align="start" mb={[8, 8, 12]}>
            <Box color="brandOrange.400" flexShrink={0} mt="2px">
              <BookOpen size={24} />
            </Box>
            <VStack align="start" gap={1}>
              <Text fontWeight="bold" fontSize="lg">
                Born-open data collection
              </Text>
              <Text color="gray.400" fontSize="sm" lineHeight="tall">
                DataPipe sends experiment data directly to a public repository
                as it is collected, making openness the default rather than an
                afterthought. Read more about the rationale and design in{" "}
                <Link
                  href="https://doi.org/10.3758/s13428-023-02161-x"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Text as="span" color="gray.200" _hover={{ textDecoration: "underline" }}>
                    <em>Behavior Research Methods</em>
                  </Text>
                </Link>
                . If you use DataPipe in your research, we&apos;d appreciate a
                citation!
              </Text>
            </VStack>
          </HStack>

          <Stack
            direction={["column", "column", "row"]}
            gap={[8, 8, 12]}
          >
            <FeatureCard icon={<Database size={24} />} title="Multiple data formats">
              Send CSV, JSON, or base64-encoded files like audio and video
              recordings. DataPipe handles decoding and storage automatically.
            </FeatureCard>
            <FeatureCard icon={<Shield size={24} />} title="Built-in safeguards">
              Data validation, session limits, and required field checks
              protect your OSF project from malformed or malicious submissions.
            </FeatureCard>
            <FeatureCard icon={<Zap size={24} />} title="Condition assignment">
              Automatically cycle through experimental conditions with
              balanced assignment, no server-side code required.
            </FeatureCard>
          </Stack>
        </Box>
      </Box>

    </Box>
  );
}

Home.getLayout = function getLayout(page) {
  return (
    <Box
      minH="100vh"
      display="flex"
      flexDirection="column"
    >
      <Navbar />
      <Box flexGrow={1}>
        {page}
      </Box>
      <Footer />
      {process.env.NEXT_PUBLIC_OSF_ENV !== "" && <TestEnvironmentWarning />}
    </Box>
  );
};
