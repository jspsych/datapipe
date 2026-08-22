import {
  Box,
  Container,
  Link,
  Stack,
  Text,
  Button,
  VisuallyHidden,
} from "@chakra-ui/react";
import { OpenCollectiveIcon } from "./OpenCollectiveIcon";
import { JsPsychIcon } from "./JsPsychIcon";
import NextLink from "next/link";

export default function Footer() {
  return (
    // DESIGN.md §1: the footer is the app's second neutral layer, so it
    // moves to `bg.subtle` rather than matching the page (`bg`) -- that
    // reading survives the light/dark split instead of collapsing into it.
    <Box as="footer" bg="bg.subtle" color="fg.muted">
      <Container as={Stack} maxW={"6xl"} py={10}>
        <Stack
          direction={["column", "row"]}
          justifyContent={["flex-start", "space-between"]}
          alignItems={["flex-end", "center"]}
          gap={[4, 1]}
          borderTopWidth={1}
          borderColor="border"
          pt={3}
          fontSize={"sm"}
        >
          <Text>
            Created by the developers of jsPsych{" "}
            <JsPsychIcon width="2em" height="2em" style={{ display: "inline" }} />
          </Text>
          <Text>
            <Link
              color="brandGreen.fg"
              textDecoration="underline"
              href={"https://github.com/jspsych/datapipe/issues/new"}
              target="_blank"
              rel="noopener noreferrer"
            >
              Report an Issue
              <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
            </Link>
          </Text>
          <Text>
            <Link
              color="brandGreen.fg"
              textDecoration="underline"
              href={"https://github.com/jspsych/datapipe"}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
              <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
            </Link>
          </Text>
          <Text>
            <Link color="brandGreen.fg" textDecoration="underline" asChild>
              <NextLink href="/contact">Contact Us</NextLink>
            </Link>
          </Text>
          <Stack align={"flex-start"}>
            <Button
              asChild
              variant="outline"
              color="fg"
              borderColor="border"
              size="sm"
              _hover={{ bg: "bg.muted" }}
            >
              <a
                href="https://opencollective.com/jspsych"
                target="_blank"
                rel="noopener noreferrer"
              >
                Donate on Open Collective <OpenCollectiveIcon width="1.5em" height="1.5em" />
                <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
              </a>
            </Button>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
