import {
  Box,
  Container,
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
        <Stack
          direction={["column", "row"]}
          justifyContent={["flex-start", "space-between"]}
          alignItems={["flex-end", "center"]}
          gap={[4, 1]}
          borderTopWidth={1}
          borderColor="gray.700"
          pt={3}
          fontSize={"sm"}
        >
          <Text>
            Created by the developers of jsPsych <JsPsychIcon width="2em" height="2em" style={{ display: "inline" }} />
          </Text>
          <Text>
            <Link
              color="gray.300"
              href={"https://github.com/jspsych/datapipe/issues/new"}
              target="_blank"
              rel="noopener noreferrer"
            >
              Report an Issue
            </Link>
          </Text>
          <Text>
            <Link
              color="gray.300"
              href={"https://github.com/jspsych/datapipe"}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </Link>
          </Text>
          <Text>
            <Link color="gray.300" asChild>
              <NextLink href="/contact">Contact Us</NextLink>
            </Link>
          </Text>
          <Stack align={"flex-start"}>
            <Button
              variant="outline"
              color="white"
              borderColor="white"
              size="sm"
              _hover={{ bg: "whiteAlpha.300" }}
              onClick={() => {
                window.open("https://opencollective.com/jspsych");
              }}
            >
              Donate on Open Collective <OpenCollectiveIcon width="1.5em" height="1.5em" />
            </Button>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
