import {
  Stack,
  HStack,
  Text,
  Link,
  Heading
} from "@chakra-ui/react";

import { ExternalLinkIcon } from "@chakra-ui/icons";

export default function ExperimentInfo({ data }) {
  return (
    <Stack w="100%" pr={8} spacing={2} bgColor={"black"} borderRadius={16} p={6}>
      <Heading fontSize="2xl">Info</Heading>
      <HStack justify="space-between">
        <Text>Experiment ID</Text>
        <Text>{data.id}</Text>
      </HStack>
      <HStack justify="space-between">
        <Text>OSF Project</Text>
        <Link href={`https://osf.io/${data.osfRepo}`} isExternal>
          {`https://osf.io/${data.osfRepo}`} <ExternalLinkIcon mx="2px" />
        </Link>
      </HStack>
      <HStack justify="space-between">
        <Text>OSF Data Component</Text>
        <Link href={`https://osf.io/${data.osfComponent}`} isExternal>
          {`https://osf.io/${data.osfComponent}`} <ExternalLinkIcon mx="2px" />
        </Link>
      </HStack>
      <HStack justify="space-between">
        <Text>Completed Sessions</Text>
        <Text>{data.sessions}</Text>
      </HStack>
      <HStack justify="space-between">
        <Text>Number of Conditions</Text>
        <Text>{data.nConditions}</Text>
      </HStack>
    </Stack>
  );
}