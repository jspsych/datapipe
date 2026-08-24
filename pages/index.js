import NextLink from "next/link";
import { useContext } from "react";
import { UserContext } from "../lib/context";
import {
  Box,
  Code,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  SimpleGrid,
  Stack,
  Link,
} from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import TestEnvironmentWarning from "../components/TestEnvironmentWarning";
import CodeSpecimen from "../components/home/CodeSpecimen";
import BandMark from "../components/home/BandMark";
import { ConnectIcon, CreateIcon, CollectIcon } from "../components/home/StepIcons";
import { osfSunsetLabel } from "../lib/osf-sunset";

// ─────────────────────────────────────────────────────────────────────────
// REGISTER NOTE. This page is BRAND register; the rest of DataPipe is
// product register. PRODUCT.md's personality (trustworthy, plain, unfussy)
// and its anti-references (SaaS growth UI, playful consumer) still bind --
// what changes here is scale, not voice. There are no gradients, no glass,
// no neon, no hero metrics, no eyebrows, no scroll-triggered reveals, and no
// entrance animation of any kind (DESIGN.md §7 bans orchestrated page loads
// outright).
//
// GREEN BUDGET (owner feedback, 2026-08-24: "very green ... it really pops
// out at you and is very bright"). The previous pass gave the brand green
// real surface area: two full-bleed #1B5E20 bands top and bottom, a
// green-tinted third ground between them, display-scale green numerals, and
// a mint seam on the code device. That is four large green regions on one
// screen, and at that dosage the green stops reading as the primary action
// color -- the one thing it has to mean app-wide (DESIGN.md §5) -- and
// starts reading as the page's wallpaper. When everything is the accent,
// the CTA is not.
//
// So the green is now rationed to three places, all of them small and all of
// them meaningful:
//
//   * the hero CTA -- brandGreen.solid, the same solid green button the rest
//     of the app uses for its one primary action per screen
//   * the closing section's ground -- the ONE full-bleed `band.bg` left
//     (owner decision after the first pass: the door at the end keeps the
//     brand ground; the hero and the middle grounds stay neutral). Its CTA
//     is the white-on-green BAND_PRIMARY chip.
//   * prose links on the page ground -- brandGreen.fg + persistent underline,
//     the app-wide link treatment
//   * the three 24px step icons -- brandGreen.fg
//
// Everything the green used to do STRUCTURALLY is now done by neutrals:
// grounds alternate `bg` / `bg.subtle`, regions are bounded by `border` and
// `border.subtle` hairlines, and every piece of type is `fg` / `fg.muted`.
// That is DESIGN.md §1's own instruction -- "panels must carry a border,
// never rely on the fill alone" -- applied at section scale.
//
// GROUNDS, alternating so no two adjacent sections share one. All neutral,
// all from the §1 surface table, dark-mode values given (§2: dark is the
// only shipped mode, judge against it):
//
//   1. bg         #1C1F22   hero: type + the code device
//   2. bg.subtle  #16191B   the three steps
//   3. bg         #1C1F22   what DataPipe does (three bordered cards)
//   4. bg.subtle  #16191B   the closing door
//
// THE SEAM IS 1.07:1 (computed, both modes), which is exactly the
// page<->panel separation DESIGN.md §1 calls deliberate and then immediately
// says cannot define an edge on its own. So the fill is never asked to. Each
// ground change also carries a `border.subtle` hairline (#3F4449, 1.80:1 on
// bg.subtle), ~96px of vertical air, and a change of internal structure --
// two columns, then icon rows, then a card grid, then a single column. Four
// devices, not one.
//
// `border.subtle` rather than `border` (gray.500, 3.43:1) for those
// hairlines: DESIGN.md assigns `border` to "panel edges -- anything WCAG
// 1.4.11 covers", and a decorative ground transition on a marketing page is
// not a UI-component boundary, so 1.4.11 does not bind. Three full-bleed
// gray.500 rules across a landing page read as table chrome; the softer
// hairline reads as a seam, which is what it is.
//
// TYPE SCALE. DESIGN.md §3's fixed four-role scale (page title 24px max) is
// a PRODUCT-register rule for pages a researcher reads twice a year. The
// landing page is the one surface where a visitor's first impression is the
// deliverable, so the hero headline runs on a fluid clamp with -0.045em
// tracking -- a 2.5x jump over the deck and 700 against 400. That departure
// is scoped to this file and does not travel into the app.
//
// The cap is 3.75rem (60px), down from 5.5rem (88px) when the headline had
// the full 1100px column to itself. The hero is two columns and the type
// only gets 1.2 of 2.2 flex units: 1100 - 48 (gutter) = 1052, so the left
// column is 574px at lg and above (the container is maxW-bound, so 1280 and
// 1440 give the identical 574). At 700 weight with -0.045em the system stack
// averages ~0.47em per glyph, so 60px buys ~20 characters a line and the
// 48-character headline balances onto three; 88px would buy ~14 and force
// five. A headline that wraps five times beside a code panel is not a bigger
// hero, it is a narrower one.
//
// SPACING. Same shape of departure, declared rather than smuggled: §4's
// 2/3/4/6/8/12/16 ladder tops out at 64px, which is a correct section break
// on a settings page and a cramped one on a full-bleed brand section. This
// file continues the same 4px base upward -- 20 (80px), 24 (96px) -- and
// uses nothing between those steps. Every gap inside a section still comes
// off the §4 ladder unchanged.
// ─────────────────────────────────────────────────────────────────────────

// Motion on the two CTAs. DESIGN.md §7: 160ms, ease-out
// (cubic-bezier(0, 0, 0.2, 1)), state feedback only.
//
// WHAT USED TO BE HERE AND WHY IT IS GONE. Both hero buttons lifted 2px on
// hover (`transform: translateY(-2px)`), and the secondary also grew a 1px
// inset shadow. Owner feedback: the lift reads as the button jumping away
// from the cursor. It also fails §7 on its own terms -- motion is for state
// change, feedback, loading or reveal, and a button that moves does not tell
// you anything the color change has not already told you, so the translate
// was decoration wearing feedback's clothes. The buttons now change color
// only (the recipes' own `_hover`), which is the whole affordance.
//
// The one movement left is the arrow, which is not decoration: it points at
// the destination and moves toward it. Its reduced-motion story is the
// custom property -- under `prefers-reduced-motion: reduce` `--dp-nudge`
// collapses to 0px and the transition is dropped, so the hover state still
// changes color and nothing translates. Written as a property rather than a
// nested condition so the media query holds plain declarations and cannot
// depend on how the style engine orders nested at-rules.
const CTA_ARROW = {
  "--dp-nudge": "3px",
  "& svg": {
    transitionProperty: "transform",
    transitionDuration: "160ms",
    transitionTimingFunction: "cubic-bezier(0, 0, 0.2, 1)",
  },
  _hover: {
    "& svg": { transform: "translateX(var(--dp-nudge))" },
  },
  "@media (prefers-reduced-motion: reduce)": {
    "--dp-nudge": "0px",
    "& svg": { transitionProperty: "none" },
  },
};

// Prose links carry a PERSISTENT underline. styles/globals.css strips
// underlines globally, and no color on this palette can carry a link by color
// alone in both modes -- against body text, light brandGreen.800 vs gray.700 is
// 2.04:1 and dark brandGreen.300 vs gray.300 is 1.36:1, both under WCAG F73's
// 3:1. The underline is what makes a link a link here; the color is secondary.
//
// Because the color is secondary, it is free to change with the ground, and on
// the recessed ground it has to:
//
//   page (bg)          brandGreen.fg  4.77 light / 8.23 dark  (the app default)
//   subtle (bg.subtle) fg             14.31 light / 16.92 dark
//
// brandGreen.fg on bg.subtle is 4.43:1 in light mode -- below the body floor --
// which DESIGN.md §1 already documents and answers the same way: "a green label
// inside a recessed or hover-filled region uses fg, not brandGreen.fg". The
// underline is untouched in either case, so nothing about what marks a link
// changes; only its hue does. It also happens to be the right call for the
// green budget above: it keeps green links to the two sections that sit on the
// page's own ground.
//   band (band.bg)     white          7.87 on #1B5E20
const LINK_GROUND = {
  page: "brandGreen.fg",
  subtle: "fg",
  band: "band.fg",
};

// The closing section is the one deep green band left on the page (owner
// decision, 2026-08-24: the hero and the tinted third ground stay neutral,
// the closing "door" gets the brand ground back). It is mode-invariant, so
// its focus ring has to be too -- the app default ring (brandGreen.700
// #388E3C) measures 1.91:1 on #1B5E20 and is simply not there. White is
// 7.87:1. Same argument the code device makes for `code.fn` as its ring.
const bandFocusRing = {
  outline: "2px solid",
  outlineColor: "band.focusRing",
  outlineOffset: "2px",
};

// The primary action on the band: a white chip on the deep green. Fill
// 7.87:1 against the band, label #1B5E20 on white 7.87:1, and on hover the
// fill steps to brandGreen.50 #E8F5E9 where the same label is 7.00:1. No
// translate -- see CTA_ARROW; the arrow nudge is the whole motion budget.
const BAND_PRIMARY = {
  ...CTA_ARROW,
  bg: "band.solid",
  color: "band.contrast",
  _hover: {
    ...CTA_ARROW._hover,
    bg: "band.solid.hover",
    color: "band.contrast",
  },
  _focusVisible: bandFocusRing,
};

function ProseLink({ href, external, ground = "page", children }) {
  const style = {
    // THE BROKEN UNDERLINE. Chakra v3's `link` recipe ships
    // `display: inline-flex` (node_modules/@chakra-ui/react/dist/esm/theme/
    // recipes/link.js:7) plus `gap: 1.5`. That makes the anchor a flex
    // container, so its content is split into blockified flex items -- for
    // "DataPipe paper in <em>Behavior Research Methods</em>" that is two of
    // them, the text and the <em>, laid out as separate boxes with a 6px gap
    // between them and each underlined on its own. One link, an underline
    // that stops and restarts, and on this page the link is long enough to
    // wrap as well.
    //
    // `display: inline` restores the normal inline box: one continuous
    // underline across the whole phrase and across the line break. Nothing
    // here needs flex -- no icon, no gap, just text.
    //
    // IT NEEDS `&&`. Chakra v3 serialises the recipe's base styles and this
    // component's own styles into a single emitted class, and it emits the
    // recipe block LAST -- confirmed in the dev server's
    // `<style data-emotion>` output, where `.css-trvgvb{display:inline}` was
    // followed by `.css-trvgvb{display:inline-flex}`. At equal specificity
    // the later rule wins, so neither a `display="inline"` style prop nor a
    // plain `css` prop can beat it. `&&` doubles the class selector
    // (`.css-x.css-x`), which does. lib/theme.js records the same trick under
    // its old `outlineOnDark` helper.
    //
    // Not solved by dropping Chakra's `Link` for a bare `<a>`: the link
    // recipe is where lib/theme.js re-points the focus ring onto
    // `:focus-visible` (DESIGN.md §5), and a plain anchor would opt this
    // page's links out of that.
    "&&": { display: "inline" },
    color: LINK_GROUND[ground],
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    _hover: { textDecorationThickness: "2px" },
  };

  if (external) {
    return (
      <Link href={href} target="_blank" rel="noopener noreferrer" css={style}>
        {children}
      </Link>
    );
  }

  return (
    <Link asChild css={style}>
      <NextLink href={href}>{children}</NextLink>
    </Link>
  );
}

// A step. Icon, a numbered verb label, and the sentence.
//
// THE ALIGNMENT BUG THIS REPLACES. The step used to be
// `<HStack align="baseline">` with a display-scale numeral -- clamp to
// 2.5rem/700 at `lineHeight="1"` -- beside `lg` body text at
// `lineHeight="tall"`. Baseline alignment resolves to the largest baseline
// offset in the row, which was the numeral's ~33.8px against the body text's
// ~18.5px, so every line of body copy was pushed 15px down inside its own row
// while the numeral stayed at the top. Against the section heading in the
// left column (cap top ~7px) the whole right column read as if it had been
// nudged down half a line -- which is exactly what the owner saw.
//
// The fix is geometric rather than a magic offset: the icon is 24px tall and
// the label's line box is 16px x 1.5 = 24px, so `align="start"` puts two
// boxes of identical height at the same top edge and the row is flush by
// construction. The heading's own cap top lands within ~1px of the label's,
// so the two columns start on the same line as well.
//
// The numeral moved into the label ("1. Connect") because a 40px green digit
// was also one of the four large green regions the green budget above
// retires -- and the verb it now sits beside is more useful than the digit
// was on its own. The three verbs are the same three the closing section
// recaps, and the same three the icons draw.
function StepItem({ icon: Icon, number, title, children }) {
  return (
    <HStack gap={4} align="start">
      {/* `display: flex` on the wrapper, not a bare inline <svg>: an inline
          svg sits on the text baseline and inherits the parent's line box,
          which would reintroduce a few pixels of exactly the offset this
          component exists to remove. */}
      <Box display="flex" flexShrink={0} color="brandGreen.fg">
        <Icon />
      </Box>
      <Box>
        <Heading
          as="h3"
          fontSize="md"
          fontWeight="600"
          lineHeight="1.5"
          color="fg"
          mb={1}
        >
          {number}. {title}
        </Heading>
        {/* The three steps are the argument for the product, not a hint under
            a field: body size, page body color (11.20:1 dark). */}
        <Text color="fg.muted" lineHeight="tall">
          {children}
        </Text>
      </Box>
    </HStack>
  );
}

// One of the three peer cards in "What DataPipe does". A real bordered panel
// on `bg.panel` -- in dark mode that fill is identical to the page, so the
// border IS the card (DESIGN.md §1: "panels must carry a border, never rely
// on the fill alone to define an edge").
function Feature({ title, children }) {
  return (
    <VStack
      as="article"
      align="start"
      gap={2}
      h="full"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      rounded="lg"
      // 24px on the §4 ladder. Not 5/20px -- that step is not on it.
      p={6}
    >
      <Heading as="h3" fontSize="lg" fontWeight="600">
        {title}
      </Heading>
      <Text color="fg.muted" lineHeight="tall">
        {children}
      </Text>
    </VStack>
  );
}

// Section headings, everywhere below the h1. One step down from the hero and
// one clear step above body: clamp 1.5rem -> 2.25rem at 700.
function SectionHeading({ children, ...props }) {
  return (
    <Heading
      as="h2"
      fontSize="clamp(1.5rem, 3.2vw, 2.25rem)"
      fontWeight="700"
      letterSpacing="-0.02em"
      lineHeight="1.15"
      textWrap="balance"
      {...props}
    >
      {children}
    </Heading>
  );
}

export default function Home() {
  const { user } = useContext(UserContext);
  // Read from lib/osf-sunset.js, like the FAQ and the getting-started guide, so
  // the three surfaces can never disagree about the date. Tolerates a null date
  // the same way they do.
  const osfDeadline = osfSunsetLabel();

  const primaryHref = user ? "/admin" : "/signup";
  // The label names the destination the click actually reaches. "/admin" is
  // "My Experiments" in the navbar, not a "dashboard" -- getting-started.js
  // reserves "experiment dashboard" for the per-experiment page, so "Go to
  // dashboard" pointed at the wrong screen. Signed out, "Get started" promised
  // a guide and delivered a signup form.
  const primaryLabel = user ? "Go to my experiments" : "Create an account";

  return (
    <Box w="100%">
      {/* ── Ground 1: the page's own surface ────────────────────────────
          Two columns: the type on the left, the code device on the right.
          The specimen is the first thing on the page that shows the actual
          product, so it belongs where the claim is made, not in a section
          the reader has to scroll to.

          THE HERO IS NO LONGER A GREEN BAND. It was a full-bleed #1B5E20
          stripe roughly 600px tall -- the single largest green object on the
          site, and the reason the page read as "very green" before anyone
          got to the CTA. On the page's own ground the headline is `fg`
          (15.86:1 on #1C1F22) and the deck `fg.muted` (11.20:1), both
          better numbers than the band's white-on-green 7.87:1, and the one
          green thing above the fold is the button we actually want clicked.

          A consequence worth recording: the code device gets its normal
          `code.border` seam back (gray.500, 3.43:1 on the dark page). It had
          been carrying `band.border` (mint) precisely because gray.500 is
          1.63:1 on #1B5E20 -- see the note in CodeSpecimen.js, which the
          green band forced and which this change undoes. */}
      <Box px={[4, 8, 12]} pt={[16, 20, 24]} pb={[16, 20, 24]}>
        <Box maxW="1100px" mx="auto">
          {/* Row at `lg` (992px), not `md` (768px). At md the container is
              672px wide and the type column would be 366px -- a 60px
              headline in 366px wraps five times. At lg it is 574px and wraps
              three. Below lg the two columns stack in DOM order, so the
              headline is still the first thing read and the device follows
              the CTAs. */}
          <Stack
            direction={{ base: "column", lg: "row" }}
            gap={12}
            align="start"
          >
            <VStack gap={6} align="start" flex="1.2" minW={0} w="100%">
              {/* The scale IS the hero moment. 700 against the deck's 400,
                  -0.045em, and text-wrap: balance so the ragged edge is a
                  decision rather than a leftover. The cap is sized to the
                  two-column measure -- see TYPE SCALE at the top. */}
              <Heading
                as="h1"
                fontSize="clamp(2.25rem, 7.2vw, 3.75rem)"
                fontWeight="700"
                letterSpacing="-0.045em"
                lineHeight="1.05"
                textWrap="balance"
                color="fg"
              >
                Experiment data, straight to storage you control.
              </Heading>
              <Text
                fontSize="clamp(1.125rem, 2.2vw, 1.5rem)"
                color="fg.muted"
                lineHeight="1.55"
                maxW="60ch"
              >
                DataPipe is a free, open-source service that sends data from any
                online experiment to your own Google Drive, Dataverse, or Zenodo
                account as each participant finishes. No server to set up,
                nothing to download by hand.
              </Text>
              {/* This line is the trust claim and must not restate the two above
                  it. "The account stays yours" was the third sentence in a row
                  saying the same thing; the permission scope and the exit are
                  new information, and both are checkable. Scope is stated as
                  what DataPipe asks for, not as what a provider forbids -- a
                  Dataverse API token carries the researcher's full privileges,
                  so "it cannot read or delete anything" would be false there
                  (PRODUCT.md principle 5). */}
              <Text fontSize={["md", "lg"]} color="fg" lineHeight="tall" maxW="60ch">
                DataPipe only ever asks your storage provider for permission to
                add files. You can disconnect it at any time.
              </Text>
              {/* TODO(owner): retention claim -- needs a decision on what DataPipe
                  retains and for how long */}
              <HStack gap={4} pt={4} flexWrap="wrap">
                {/* asChild, not <Link><Button> -- that rendered <a><button></a>:
                    invalid HTML, two tab stops for one control, and a focus ring
                    on the element that is not focused.

                    The one primary action on the page, in the app's primary
                    action color (DESIGN.md §5). On the dark page brandGreen.solid
                    #4CAF50 is a 5.96:1 fill carrying #1C1F22 text at 5.96:1 --
                    the bright chip reads as a control, which is the whole
                    argument for spending the green here rather than on a band. */}
                <Button
                  asChild
                  size="lg"
                  colorPalette="brandGreen"
                  css={CTA_ARROW}
                >
                  <NextLink href={primaryHref}>
                    {primaryLabel} <ArrowRight size={18} />
                  </NextLink>
                </Button>
                {/* One primary action per screen (DESIGN.md §5): every other
                    action is outline or ghost on gray. With the band gone this
                    can finally be the stock neutral outline the rest of the app
                    uses, instead of the bespoke mint outline the green ground
                    forced (gray.border is 1.2:1 on #1B5E20). */}
                <Button asChild size="lg" variant="outline">
                  {/* Names the page it opens, in the same words faq.js and the
                      closing section use for it. "How it works" described a
                      concept page; the destination is a step-by-step guide. */}
                  <NextLink href="/getting-started">
                    Read the getting started guide
                  </NextLink>
                </Button>
              </HStack>
              <Text fontSize="sm" color="fg.muted" pt={2}>
                Built by the{" "}
                <ProseLink href="https://www.jspsych.org" external>
                  jsPsych
                </ProseLink>{" "}
                team
              </Text>
            </VStack>

            {/* The right column. `flex="1"` against the type column's 1.2
                gives 478px at lg and above, and the widest line either
                snippet renders is 38 monospace characters -- ~360px with the
                device's own padding, so nothing here scrolls sideways at the
                measure it was designed for. `minW={0}` because a flex child
                containing a <pre> will otherwise refuse to shrink below its
                content width and push the type column off its own measure. */}
            <Box as="figure" m={0} flex="1" minW={0} w="100%">
              <CodeSpecimen />
              <Text as="figcaption" fontSize="sm" color="fg.muted" mt={3}>
                The code is the same whichever storage provider you chose.
                Every endpoint and error code is in the{" "}
                <ProseLink href="/docs/api">API reference</ProseLink>.
              </Text>
            </Box>
          </Stack>
        </Box>
      </Box>

      {/* ── Ground 2: the recessed neutral, carrying the three steps ────
          `bg.subtle` (#16191B) with a hairline top and bottom. The seam is
          1.20:1 on its own, which is why it is never asked to work alone:
          the hairline, ~96px of air on each side, and the switch from the
          hero's two-column layout to a labelled icon list all mark the same
          boundary. */}
      <Box
        as="section"
        bg="bg.subtle"
        borderTopWidth="1px"
        borderBottomWidth="1px"
        borderColor="border.subtle"
        px={[4, 8, 12]}
        py={[16, 20, 24]}
      >
        <Stack
          direction={["column", "column", "row"]}
          gap={[8, 8, 16]}
          maxW="1100px"
          mx="auto"
        >
          <Box flex="1">
            <SectionHeading>Three steps to start collecting data</SectionHeading>
          </Box>
          <VStack align="start" gap={[6, 8]} flex="1.5" maxW="70ch">
            {/* One imperative verb per step, in the order the researcher
                performs them, matching getting-started.js steps 2, 3+5 and 7
                and the labels they will actually click. The verb is now
                rendered as the step's own label rather than living only in
                the sentence, so the icon beside it is never the only thing
                naming the step (DESIGN.md §5). */}
            <StepItem icon={ConnectIcon} number="1" title="Connect">
              Connect a storage provider — Google Drive, Dataverse, or Zenodo —
              to your DataPipe account.
            </StepItem>
            <StepItem icon={CreateIcon} number="2" title="Create">
              Create a DataPipe experiment, then add a few lines of code to the
              experiment your participants run so it sends data to DataPipe.
            </StepItem>
            <StepItem icon={CollectIcon} number="3" title="Collect">
              Enable data collection and run your experiment. Each
              participant&apos;s data lands in your Drive folder, Dataverse
              dataset, or Zenodo deposition as they finish.
            </StepItem>
          </VStack>
        </Stack>
      </Box>

      {/* ── Ground 3: back to the page ──────────────────────────────────
          LEAD PLUS THREE THIRDS, not a 2x2 of equals. The owner's note was
          that one big card over three small ones reads awkward, and the two
          fixes on the table were a 2x2 grid of four equal cards or a
          full-width lead over three equal thirds. The content decides it:
          "Born-open data collection" is not a fourth feature. It defines the
          term the whole product is built on and it carries the citation ask,
          so it is a different KIND of block from "CSV, JSON, and media
          files". A 2x2 would assert that the four are peers, which would put
          the citation request in a feature card and demote the idea that
          justifies the product to one quarter of a grid.

          So the lead is made unmistakably a lead rather than a big card: no
          border, no card fill, sitting at prose measure directly under the
          section heading, with the three peers as bordered cards beneath it.
          The grid gives them matching heights for free (grid items stretch),
          which was the other half of the complaint -- three ragged-bottomed
          columns of unequal text. */}
      <Box as="section" px={[4, 8, 12]} py={[16, 20, 24]}>
        <Box maxW="1100px" mx="auto">
          <SectionHeading mb={6}>What DataPipe does</SectionHeading>

          {/* 8 -> 12 on the §4 ladder. The old 10/14 were off it. */}
          <Box mb={[8, 8, 12]} maxW="70ch">
            <Heading as="h3" fontSize="lg" fontWeight="600" mb={2}>
              Born-open data collection
            </Heading>
            {/* "Born-open" is the paper's term and stays in the heading, but
                the first sentence now defines it instead of restating it, and
                the link text names the paper rather than only its journal. */}
            <Text color="fg.muted" lineHeight="tall">
              Born-open means each participant&apos;s data is already in your
              own storage the moment it is collected, instead of being uploaded
              months later when the paper is written. The reasoning behind that
              is set out in the{" "}
              <ProseLink
                href="https://doi.org/10.3758/s13428-023-02161-x"
                external
              >
                DataPipe paper in <em>Behavior Research Methods</em>
              </ProseLink>
              . If you use DataPipe in your research, please cite it.
            </Text>
          </Box>

          {/* No icons above these cards. Database / Shield / Zap were
              decoration at the same size as the headings they sat on, and one
              of them meant nothing at all. The step icons two sections up earn
              their place differently: each labels a numbered action in a
              sequence, and each sits beside its own one-word verb. */}
          <SimpleGrid columns={{ base: 1, md: 3 }} gap={[6, 6, 8]}>
            {/* Blurb rules for this audience: name the dashboard feature the
                researcher will switch on, say what it does to their data, and
                spend a clause explaining any term they may not own. "base64"
                is now introduced by what it carries; "Psych-DS" gets its own
                clause because most researchers have not met it yet. Required-field checks
                are part of data validation, so listing them as a third
                separate safeguard was inaccurate. */}
            <Feature title="CSV, JSON, and media files">
              Send text data as CSV or JSON, and recordings — audio, video,
              images — as base64 strings. DataPipe decodes each string and
              saves the original file alongside the rest of your data.
            </Feature>
            <Feature title="Built-in safeguards">
              Data validation checks that every submission is well-formed JSON
              or CSV and carries the fields you require; anything else is
              rejected before it reaches your storage. A session limit caps how
              many files DataPipe will accept.
            </Feature>
            {/* Psych-DS replaced condition assignment here (owner request,
                2026-08-24): it is the feature that makes the collected data
                worth something to someone else, which is the point of the
                born-open lead above it. Same blurb rules: name the switch on
                the dashboard, say what it does to the data, spend a clause on
                the term. Condition assignment is still documented at
                /docs/api. */}
            <Feature title="Psych-DS metadata">
              Turn on metadata and DataPipe writes a{" "}
              <Code>dataset_description.json</Code> alongside your data —
              describing the dataset and every variable in it in the Psych-DS
              format, a standard layout others can read and reuse — and keeps
              it up to date after each session.
            </Feature>
          </SimpleGrid>
        </Box>
      </Box>

      {/* ── The door at the end: the page's one green band ───────────────
          Same action as the hero, not a second competing one. The hero and
          the two grounds between are neutral (see GREEN BUDGET above); the
          closing section alone takes the deep green `band.bg` (#1B5E20,
          mode-invariant -- every pairing is computed in lib/theme.js's
          `band.*` block). One band at the end reads as the brand signing
          off; the same band at both ends read as wallpaper.

          No `border.subtle` seam here: bg.subtle -> #1B5E20 is 2.10:1, a
          real edge on its own, and a gray hairline on a green fill would be
          a third color at the join.

          This section carries the cropped |> mark, drawn in `band.ornament`
          (see BandMark.js). */}
      <Box
        as="section"
        bg="band.bg"
        position="relative"
        overflow="hidden"
      >
        <BandMark />
        <Box px={[4, 8, 12]} py={[16, 20, 24]} position="relative" zIndex={1}>
          <VStack maxW="1100px" mx="auto" align="start" gap={6}>
            <SectionHeading color="band.fg" maxW="20ch">
              Set up your first experiment
            </SectionHeading>
            <Text
              maxW="70ch"
              fontSize={["md", "lg"]}
              color="band.fg.muted"
              lineHeight="tall"
            >
              {/* Recaps the three steps in the same three verbs they use above --
                  connect, create, add -- rather than a fourth wording of the same
                  sequence. */}
              Connect a storage provider, create an experiment, and add a few
              lines of code. The{" "}
              <ProseLink href="/getting-started" ground="band">
                getting started guide
              </ProseLink>{" "}
              walks through all of it, end to end.
            </Text>
            <Button asChild size="lg" css={BAND_PRIMARY} mt={2}>
              <NextLink href={primaryHref}>
                {primaryLabel} <ArrowRight size={18} />
              </NextLink>
            </Button>
            <Text fontSize="sm" color="band.fg.subtle" maxW="70ch" pt={2}>
              The{" "}
              <ProseLink href="/docs" ground="band">
                documentation
              </ProseLink>{" "}
              covers what DataPipe stores, what it costs to run, and what happens
              when an upload fails.
            </Text>
            {/* The cause sentence is faq.js item-0b's opening, verbatim, and it
                earns its space here: without it the notice reads as DataPipe
                retreating rather than OSF closing a feature. The dated sentence
                is already identical to the one getting-started.js builds. Link
                text says where it goes, not "what to do next". */}
            <Text fontSize="sm" color="band.fg.subtle" maxW="70ch">
              Already collecting on OSF? OSF is shutting down its projects
              feature.{" "}
              {osfDeadline
                ? `DataPipe will stop writing to OSF after ${osfDeadline}.`
                : "DataPipe is winding down its support for OSF."}{" "}
              Data already there stays in your OSF account, and DataPipe never
              removes it. See{" "}
              <ProseLink href="/docs/providers/osf" ground="band">
                how to move to another provider
              </ProseLink>
              .
            </Text>
          </VStack>
        </Box>
      </Box>
    </Box>
  );
}

Home.getLayout = function getLayout(page) {
  return (
    <Box minH="100vh" display="flex" flexDirection="column">
      <Navbar />
      <Box flexGrow={1}>{page}</Box>
      <Footer />
      {/* Same guard as pages/_app.js: NEXT_PUBLIC_DEPLOY_ENV truthy AND not
          "production". The var is unset in production deploys, so the banner
          only ships on the test site. */}
      {!!process.env.NEXT_PUBLIC_DEPLOY_ENV &&
        process.env.NEXT_PUBLIC_DEPLOY_ENV !== "production" && (
          <TestEnvironmentWarning />
        )}
    </Box>
  );
};
