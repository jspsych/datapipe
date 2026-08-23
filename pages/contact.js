import { Stack, Heading, Text, Button, Link } from "@chakra-ui/react";

export default function Contact() {
  return (
    // maxW 600 -> the committed 560px single-subject column; px={4} removed
    // (the page gutter is set once in _app.js). gap 8 -> 4 with the heading
    // carrying its own mb={4}: at a flat gap={8} the h1 sat exactly as far
    // from the first paragraph as the paragraphs sat from each other, so the
    // title did not read as a title. Now the body is one tight group and the
    // heading is separated from it.
    <Stack w="100%" maxW="560px" gap={4}>
      <Heading as="h1" size="2xl" mb={4}>
        Contact Us
      </Heading>
      <Text>
        DataPipe is a free service provided by the developers of jsPsych. We do
        not have a dedicated support team, but we do our best to respond to
        questions and issues.
      </Text>
      <Text>
        We ask that if you have a question or issue, you first check the{" "}
        <Link href="https://github.com/jspsych/datapipe/issues" target="_blank" rel="noopener noreferrer">
          GitHub repository issues
        </Link>{" "}
        to see if your question has already been answered. If not, we encourage
        you to post a new issue there.
      </Text>
      <Text>
        If you need to contact us directly, you can email Josh de Leeuw at
        jdeleeuw@vassar.edu.
      </Text>
    </Stack>
  );
}
