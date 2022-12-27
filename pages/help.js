import { Stack, Heading, Text, Button } from "@chakra-ui/react";

export default function Help() {
  return (
    <Stack w={["95%", 640]} spacing={6}>
      <Heading as="h1" size="2xl">
        Getting Started
      </Heading>
      <Text>DataPipe is a free service that lets you connect your behavioral experiments with the Open Science Framework so that any data you collect is automatically saved in an OSF component.</Text>
      <Text>We are working on building out the instructional materials. For now, please watch this tutorial video to learn how to use DataPipe.</Text>
      <Text>We are especially appreciative of feedback during this early stage of the project. Please let us know what needs improvement as we work towards a stable release.</Text>
    </Stack>
  );
}
