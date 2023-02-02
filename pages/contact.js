import { Stack, Heading, Text, Button, Link } from "@chakra-ui/react";

export default function Contact() {
  return (
    <Stack w={600} spacing={8}>
      <Heading as="h1" size="2xl">
        Contact Us
      </Heading>
      <Text>
        DataPipe is a free service provided by the developers of jsPsych. We do
        not have a dedicated support team, but we do our best to respond to
        questions and issues.
      </Text>
      <Text>
        We ask that if you have a question or issue, you first check the{" "}
        <Link href="https://github.com/jspsych/datapipe/issues" isExternal>
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
