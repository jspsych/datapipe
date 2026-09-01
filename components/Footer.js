import {
  Box,
  Container,
  HStack,
  Link,
  Stack,
  Text,
  Button,
  VisuallyHidden,
} from "@chakra-ui/react";
import { OpenCollectiveIcon } from "./OpenCollectiveIcon";
import { JsPsychIcon } from "./JsPsychIcon";
import NextLink from "next/link";

// The footer row is navigation, not prose: four standalone destinations in a
// labelled cluster, with no body text around them for a link to hide inside.
// That is the case DESIGN.md §5's persistent underline is written for -- "no
// green/body text pair reaches the 3:1 color-difference floor, so color alone
// can never mark a link" -- and it is why the Navbar's links are bare
// `color="fg"` too. Four permanently underlined green fragments spread across
// the band read as leftover markup rather than as a menu.
//
// So: `fg` against the band's `fg.muted` body text, which makes the links the
// one bright thing in the row, and an underline on hover, where it confirms
// what is under the cursor. Keyboard users get the theme's focus-visible ring
// (lib/theme.js re-points the link recipe for exactly this), so there is no
// `_focusVisible` underline to add here.
function FooterLink({ href, external, children }) {
  const style = {
    color: "fg",
    _hover: {
      color: "brandGreen.fg",
      textDecoration: "underline",
      textUnderlineOffset: "3px",
    },
  };

  if (external) {
    return (
      <Link {...style} href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
      </Link>
    );
  }

  return (
    <Link {...style} asChild>
      <NextLink href={href}>{children}</NextLink>
    </Link>
  );
}

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
          so the footer row lines up with the content column above it.

          Asymmetric pt/pb, not py: pt keeps the same air the band always
          had under its top border/edge (untouched per owner feedback); pb
          is roughly halved. The bottom edge is the actual bottom of the
          page, not a hand-off into another surface, so it doesn't need to
          match the top -- the previous symmetric py just read as a lot of
          dead space under the last row of links. */}
      <Container
        as={Stack}
        maxW="1100px"
        pt={{ base: 8, md: 12 }}
        pb={{ base: 4, md: 6 }}
      >
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
          {/* One cluster, not four items spaced out across the band by the
              parent's space-between. The grouping is what makes these read as
              a menu -- and, with the <nav> label, what makes "navigation, not
              prose" structural rather than a styling assertion. */}
          <HStack as="nav" aria-label="Footer" gap={{ base: 4, md: 6 }} flexWrap="wrap">
            <FooterLink external href="https://github.com/jspsych/datapipe/issues/new">
              Report an Issue
            </FooterLink>
            <FooterLink external href="https://github.com/jspsych/datapipe">
              GitHub
            </FooterLink>
            <FooterLink href="/contact">Contact Us</FooterLink>
            {/* Researchers are sent here by an IRB or an institutional security
                reviewer, i.e. by someone who is not already inside the docs.
                The footer is where that reader looks for it. */}
            <FooterLink href="/docs/privacy">Privacy</FooterLink>
          </HStack>
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
