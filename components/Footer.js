import {
  Box,
  Container,
  SimpleGrid,
  HStack,
  VStack,
  Link,
  Stack,
  Text,
  Button,
} from "@chakra-ui/react";
import { OpenCollectiveIcon } from "./OpenCollectiveIcon";
import { JsPsychIcon } from "./JsPsychIcon";
import NextLink from "next/link";

export default function Footer() {
  return (
    <Box bg="greyBackground" color="gray.300">
      <Container as={Stack} maxW={"6xl"} py={10}>
        <Stack direction={['column', 'row']} justifyContent={["flex-start", "space-between"]} spacing={[4, 1]} borderTopWidth={1} borderColor="gray.700" pt={3} fontSize={"sm"}>
          <Text>Created by the developers of jsPsych <JsPsychIcon boxSize={10} /></Text>
          <Text><Link href={"https://github.com/jspsych/datapipe/issues/new"} isExternal>Report an Issue</Link></Text>
          <Text><Link href={"https://github.com/jspsych/datapipe"} isExternal>GitHub</Link></Text>
          <Text><Link as={NextLink} href="/contact">Contact Us</Link></Text>
          <Stack align={"flex-start"}>
            <Button
              rightIcon={<OpenCollectiveIcon boxSize={8} />}
              variant="outline"
              color="white"
              colorScheme="white"
              size="sm"
              onClick={()=>{
                window.open("https://opencollective.com/jspsych")
              }}
            >
              Donate on Open Collective
            </Button>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
