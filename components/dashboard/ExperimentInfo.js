import { Stack, HStack, Text, Link, Heading } from "@chakra-ui/react";

import { ExternalLink } from "lucide-react";

export default function ExperimentInfo({ data }) {
  return (
    <Stack
      w="100%"
      pr={[0, 8]}
      gap={2}
      bgColor={"black"}
      borderRadius={16}
      p={6}
    >
      <Heading fontSize="2xl">Info</Heading>
      <HStack justify="space-between">
        <Text>Experiment ID</Text>
        <Text>{data.id}</Text>
      </HStack>
      <HStack justify="space-between">
        <Text>OSF Project</Text>
        <Link color="white" href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfRepo}`} target="_blank" rel="noopener noreferrer">
          {`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfRepo}`} <ExternalLink style={{ display: "inline", width: "1em", height: "1em" }} />
        </Link>
      </HStack>
      <HStack justify="space-between">
        <Text>OSF Data Component</Text>
        <Link
          color="white"
          href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfComponent}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfComponent}`} <ExternalLink style={{ display: "inline", width: "1em", height: "1em" }} />
        </Link>
      </HStack>
      <HStack justify="space-between">
        <Text>Completed Sessions</Text>
        <Text>{data.sessions}</Text>
      </HStack>
    </Stack>
  );
}
