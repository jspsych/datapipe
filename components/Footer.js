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
    // The boundary belongs on the band's own top edge, not 40px inside it.
    // The `borderTopWidth` that used to sit on the inner Stack was added when
    // the footer shared the page fill and the rule WAS the boundary; once the
    // band arrived it became a second, lower edge with nothing above it -- a
    // 4.5:1 gray rule floating in the middle of the footer.
    //
    // It is replaced rather than simply removed: bg.subtle against bg measures
    // 1.077:1 light / 1.067:1 dark, the same separation DESIGN.md §1 already
    // declares too weak to define an edge on its own ("panels must carry a
    // border, never rely on the fill alone"). `border.subtle` (1.38:1 vs bg
    // light, 1.68:1 dark) lands exactly ON the fill transition, so it reads as
    // the band's edge reinforcing the color change instead of as a stray rule.
    <Box
      as="footer"
      bg="bg.subtle"
      color="fg.muted"
      borderTopWidth="1px"
      borderColor="border.subtle"
    >
      {/* 1100px, not 6xl (1152px): DESIGN.md §4's dashboard/marketing measure,
          so the footer row lines up with the content column above it. */}
      <Container as={Stack} maxW="1100px" py={{ base: 8, md: 12 }}>
        <Stack
          direction={["column", "row"]}
          justifyContent={["flex-start", "space-between"]}
          alignItems={["flex-start", "center"]}
          gap={[6, 6]}
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
