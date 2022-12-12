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

const ListHeader = ({ children }) => {
  return (
    <Text fontWeight={"500"} fontSize={"lg"} mb={2}>
      {children}
    </Text>
  );
};

export default function Footer() {
  return (
    <Box bg="greyBackground" color="gray.300">
      <Container as={Stack} maxW={"6xl"} py={10}>
        <HStack justifyContent="space-between" borderTopWidth={1} borderColor="gray.700" pt={3} fontSize={"sm"}>
          <Text>Created by the developers of jsPsych <JsPsychIcon boxSize={10} /></Text>
          <Link href={"#"}>Report an Issue</Link>
          <Link href={"#"}>GitHub</Link>
          <Link href={"#"}>Contact Us</Link>
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
        </HStack>
      </Container>
    </Box>
  );
}
