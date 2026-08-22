import NextLink from "next/link";
import { useContext } from "react";
import { UserContext } from "../lib/context";
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Stack,
  Link,
} from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import TestEnvironmentWarning from "../components/TestEnvironmentWarning";
import CodeSpecimen from "../components/home/CodeSpecimen";
import ArrivalsPanel from "../components/home/ArrivalsPanel";
import BandMark from "../components/home/BandMark";
import { osfSunsetLabel } from "../lib/osf-sunset";

// ─────────────────────────────────────────────────────────────────────────
// REGISTER NOTE. This page is BRAND register; the rest of DataPipe is
// product register. PRODUCT.md's personality (trustworthy, plain, unfussy)
// and its anti-references (SaaS growth UI, playful consumer) still bind --
// what changes here is scale and ground, not voice. There are no gradients,
// no glass, no neon, no hero metrics, no eyebrows, no scroll-triggered
// reveals, and no entrance animation of any kind (DESIGN.md §7 bans
// orchestrated page loads outright). The whole budget goes to one decision:
// the brand green gets real surface area.
//
// Three grounds, alternating, so no two adjacent sections share one:
//
//   1. band.bg   deep green #1B5E20, full-bleed   hero + the three steps
//   2. bg        the page                          the proof (code devices)
//   3. band.bg.soft  green-tinted neutral          what DataPipe does
//   4. band.bg   deep green again                  the closing door
//
// This reverses the previous pass's "no bands at all" call. That call was
// right that an arbitrary #000 band (1.27:1 against the page, unsalvageable
// in light mode) had to go, and wrong that whitespace alone could carry the
// grouping: it left the page reading as one undifferentiated column.
// Every ratio behind the three grounds is computed in the `band.*` block at
// the end of lib/theme.js semanticTokens.colors.
//
// TYPE SCALE. DESIGN.md §3's fixed four-role scale (page title 24px max) is
// a PRODUCT-register rule for pages a researcher reads twice a year. The
// landing page is the one surface where a visitor's first impression is the
// deliverable, so the hero headline runs on a fluid clamp to 5.5rem with
// -0.045em tracking -- a ~3.7x jump over the deck and 700 against 400. That
// departure is scoped to this file and does not travel into the app.
//
// SPACING. Same shape of departure, declared rather than smuggled: §4's
// 2/3/4/6/8/12/16 ladder tops out at 64px, which is a correct section break
// on a settings page and a cramped one on a full-bleed brand band. This file
// continues the same 4px base upward -- 20 (80px), 24 (96px), 32 (128px) --
// and uses nothing between those steps. Every gap inside a section still
// comes off the §4 ladder unchanged.
// ─────────────────────────────────────────────────────────────────────────

// Motion, shared by both band CTAs. DESIGN.md §7: 160ms, ease-out
// (cubic-bezier(0, 0, 0.2, 1)), state feedback only.
//
// The reduced-motion story is the two custom properties. Under
// `prefers-reduced-motion: reduce` they collapse to 0px and the transitions
// are dropped, so the hover state still changes -- fill, border, color, all
// of which carry the affordance on their own -- but nothing translates and
// nothing eases. Written as properties rather than a nested condition so the
// media query holds plain declarations and cannot depend on how the style
// engine orders nested at-rules.
const CTA_MOTION = {
  "--dp-lift": "-2px",
  "--dp-nudge": "3px",
  transitionProperty: "background-color, border-color, color, box-shadow, transform",
  transitionDuration: "160ms",
  transitionTimingFunction: "cubic-bezier(0, 0, 0.2, 1)",
  "& svg": {
    transitionProperty: "transform",
    transitionDuration: "160ms",
    transitionTimingFunction: "cubic-bezier(0, 0, 0.2, 1)",
  },
  "@media (prefers-reduced-motion: reduce)": {
    "--dp-lift": "0px",
    "--dp-nudge": "0px",
    transitionProperty: "none",
    "& svg": { transitionProperty: "none" },
  },
};

// The band is mode-invariant, so its focus ring has to be too -- the app
// default ring (brandGreen.700 #388E3C) measures 1.91:1 on #1B5E20 and is
// simply not there. White is 7.87:1. Same argument the code device makes
// for `code.fn` as its ring.
const bandFocusRing = {
  outline: "2px solid",
  outlineColor: "band.focusRing",
  outlineOffset: "2px",
};

// The one primary action, on the one ground it ever appears on. A white chip
// on the deep green: fill 7.87:1 against the band, label #1B5E20 on white
// 7.87:1, and on hover the fill steps to brandGreen.50 #E8F5E9 where the same
// label is 7.00:1. The arrow moves 3px in the direction the whole page is
// about; that is the entire motion budget.
const BAND_PRIMARY = {
  ...CTA_MOTION,
  bg: "band.solid",
  color: "band.contrast",
  _hover: {
    bg: "band.solid.hover",
    color: "band.contrast",
    transform: "translateY(var(--dp-lift))",
    "& svg": { transform: "translateX(var(--dp-nudge))" },
  },
  _focusVisible: bandFocusRing,
};

// Secondary. DESIGN.md §5 says non-primary actions are outline or ghost "on
// gray" -- gray.border is 1.2:1 on this ground, so the band substitutes its
// own: brandGreen.200 #A5D6A7 at 4.79:1, comfortably past the 3:1 non-text
// floor. Hover takes the edge from mint 1px to white 2px (4.79 -> 7.87, and
// double the weight) via an inset shadow rather than a border-width change,
// which would shift the label by a pixel.
const BAND_SECONDARY = {
  ...CTA_MOTION,
  bg: "transparent",
  color: "band.fg",
  borderWidth: "1px",
  borderColor: "band.border",
  _hover: {
    bg: "transparent",
    color: "band.fg",
    borderColor: "band.fg",
    boxShadow: "inset 0 0 0 1px var(--chakra-colors-band-fg)",
    transform: "translateY(var(--dp-lift))",
  },
  _focusVisible: bandFocusRing,
};

// Prose links carry a PERSISTENT underline. styles/globals.css strips
// underlines globally, and no color on this palette can carry a link by color
// alone in both modes -- against body text, light brandGreen.800 vs gray.700 is
// 2.04:1 and dark brandGreen.300 vs gray.300 is 1.36:1, both under WCAG F73's
// 3:1. The underline is what makes a link a link here; the color is secondary.
//
// Because the color is secondary, it is free to change with the ground, and
// on two of this page's three grounds it has to:
//
//   page  brandGreen.fg  4.77 light / 8.23 dark   (the app-wide default)
//   band  white          7.87 on #1B5E20
//   soft  fg             11.65 light / 12.03 dark
//
// `soft` is the interesting one. brandGreen.fg on band.bg.soft is 3.61:1 in
// light mode -- below the body floor -- which is the same failure DESIGN.md
// §1 already documents for bg.subtle (4.43) and bg.muted (4.08) and answers
// the same way: "a green label inside a recessed region uses fg, not
// brandGreen.fg". The underline is untouched in every case, so nothing about
// what marks a link changes; only its hue does.
const LINK_GROUND = {
  page: "brandGreen.fg",
  band: "band.fg",
  soft: "fg",
};

function ProseLink({ href, external, ground = "page", children }) {
  const style = {
    color: LINK_GROUND[ground],
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    _hover: { textDecorationThickness: "2px" },
  };

  if (external) {
    return (
      <Link href={href} target="_blank" rel="noopener noreferrer" {...style}>
        {children}
      </Link>
    );
  }

  return (
    <Link asChild {...style}>
      <NextLink href={href}>{children}</NextLink>
    </Link>
  );
}

// A step on the deep band. The numeral is display-scale (clamp to 2.5rem,
// 700) in band.accent -- brandGreen.200 at 4.79:1, which clears the body
// floor outright, so it needs no large-text allowance to be legal. Baseline
// alignment against the step text is what makes the size jump read as
// hierarchy rather than as two unrelated blocks.
function StepItem({ number, children }) {
  return (
    <HStack gap={[4, 5]} align="baseline">
      <Text
        fontSize="clamp(1.75rem, 3vw, 2.5rem)"
        fontWeight="700"
        letterSpacing="-0.03em"
        lineHeight="1"
        color="band.accent"
        flexShrink={0}
        minW="1.6ch"
        textAlign="right"
      >
        {number}
      </Text>
      {/* The three steps are the argument for the product, not a hint under a
          field: body size, band body color (5.85:1). */}
      <Text fontSize={["md", "lg"]} color="band.fg.muted" lineHeight="tall">
        {children}
      </Text>
    </HStack>
  );
}

function Feature({ title, children }) {
  return (
    <VStack align="start" gap={2} flex="1" minW="200px">
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
      {/* ── Ground 1: the deep green band, full-bleed ───────────────────
          It carries the headline AND the three steps, as one long
          single-subject region rather than two thin stripes. Type only: the
          code device cannot live here. code.bg #111111 is 1.07:1 against
          #1B5E20 and its #18181b chrome strip is 1.00:1, so the specimen
          would dissolve into the ground -- which is why the proof gets its
          own section on the page below, where its gray.500 seam reads 4.50:1
          light / 3.43:1 dark exactly as DESIGN.md §1 intends. */}
      <Box bg="band.bg" position="relative" overflow="hidden">
        <BandMark />
        <Box
          px={[4, 8, 12]}
          pt={[16, 20, 24]}
          pb={[16, 20, 24]}
          maxW="1100px"
          mx="auto"
          position="relative"
          zIndex={1}
        >
          <VStack gap={6} align="start" maxW="720px">
            {/* The scale IS the hero moment. 700 against the deck's 400,
                -0.045em, and text-wrap: balance so the ragged edge is a
                decision rather than a leftover. Light type on a dark ground
                reads lighter than it measures, so the line-height is looser
                than a 5.5rem headline would otherwise take. */}
            <Heading
              as="h1"
              fontSize="clamp(2.25rem, 7.2vw, 5.5rem)"
              fontWeight="700"
              letterSpacing="-0.045em"
              lineHeight="1.05"
              textWrap="balance"
              color="band.fg"
            >
              Experiment data, straight to storage you control.
            </Heading>
            <Text
              fontSize="clamp(1.125rem, 2.2vw, 1.5rem)"
              color="band.fg.muted"
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
            <Text fontSize={["md", "lg"]} color="band.fg" lineHeight="tall" maxW="60ch">
              DataPipe only ever asks your storage provider for permission to
              add files. You can disconnect it at any time.
            </Text>
            {/* TODO(owner): retention claim -- needs a decision on what DataPipe
                retains and for how long */}
            <HStack gap={4} pt={4} flexWrap="wrap">
              {/* asChild, not <Link><Button> -- that rendered <a><button></a>:
                  invalid HTML, two tab stops for one control, and a focus ring
                  on the element that is not focused. */}
              <Button asChild size="lg" css={BAND_PRIMARY}>
                <NextLink href={primaryHref}>
                  {primaryLabel} <ArrowRight size={18} />
                </NextLink>
              </Button>
              {/* One primary action per screen (DESIGN.md §5). The secondary
                  is an outline in the band's own border color, because the
                  neutral gray it would otherwise take is 1.2:1 here. */}
              <Button asChild size="lg" variant="outline" css={BAND_SECONDARY}>
                {/* Names the page it opens, in the same words faq.js and the
                    closing band use for it. "How it works" described a concept
                    page; the destination is a step-by-step setup guide. */}
                <NextLink href="/getting-started">
                  Read the getting started guide
                </NextLink>
              </Button>
            </HStack>
            <Text fontSize="sm" color="band.fg.subtle" pt={2}>
              Built by the{" "}
              <ProseLink href="https://www.jspsych.org" ground="band" external>
                jsPsych
              </ProseLink>{" "}
              team
            </Text>
          </VStack>

          {/* Second beat of the same band. The gap is the section break --
              inside one ground, spacing is exactly the right grouping device
              (DESIGN.md §4); it is between grounds that it was not enough. */}
          <Stack
            direction={["column", "column", "row"]}
            gap={[8, 8, 16]}
            mt={[20, 24, 32]}
          >
            <Box flex="1">
              <SectionHeading color="band.fg">
                Three steps to start collecting data
              </SectionHeading>
            </Box>
            <VStack align="start" gap={[6, 8]} flex="1.5" maxW="70ch">
              {/* One imperative verb per step, in the order the researcher
                  performs them, matching getting-started.js steps 2, 3+5 and 7
                  and the labels they will actually click. "your study" is gone:
                  this page now says "a DataPipe experiment" for the record and
                  "your experiment" for the thing participants run. */}
              <StepItem number="1">
                Connect a storage provider — Google Drive, Dataverse, or Zenodo
                — to your DataPipe account.
              </StepItem>
              <StepItem number="2">
                Create a DataPipe experiment, then add a few lines of code to
                the experiment your participants run so it sends data to
                DataPipe.
              </StepItem>
              <StepItem number="3">
                Enable data collection and run your experiment. Each
                participant&apos;s data lands in your Drive folder, Dataverse
                dataset, or Zenodo deposition as they finish.
              </StepItem>
            </VStack>
          </Stack>
        </Box>
      </Box>

      {/* ── Ground 2: the page itself, carrying the proof ───────────────
          What you send, then what you get, read left to right. These two
          devices are the only place on the page where the reader sees the
          actual product, and they are mode-invariant by design, so they get
          the mode-aware page ground to sit against rather than a band that
          would erase them. The figcaptions are the only labels the section
          needs; a heading over two self-describing figures would be a caption
          for a caption. */}
      <Box px={[4, 8, 12]} py={[16, 20, 24]}>
        <Stack
          direction={["column", "column", "row"]}
          gap={[10, 10, 12]}
          maxW="1100px"
          mx="auto"
          align="start"
        >
          <Box as="figure" m={0} flex="1" w="100%" minW={0}>
            <CodeSpecimen />
            <Text as="figcaption" fontSize="sm" color="fg.muted" mt={3}>
              The code is the same whichever storage provider you chose. Every
              endpoint and error code is in the{" "}
              <ProseLink href="/api-docs">API reference</ProseLink>.
            </Text>
          </Box>
          <Box as="figure" m={0} flex="1" w="100%" minW={0}>
            <ArrivalsPanel />
            {/* "Illustration." named the genre without saying why it mattered.
                The reader's question is whether these are real arrivals, so the
                caption answers that first. "the ... you connected" was also
                wrong: a researcher connects a provider, and DataPipe creates
                the folder, dataset or deposition. */}
            <Text as="figcaption" fontSize="sm" color="fg.muted" mt={3}>
              Example, not live data. Each participant&apos;s data arrives as
              its own file in your Drive folder, Dataverse dataset, or Zenodo
              deposition.
            </Text>
          </Box>
        </Stack>
      </Box>

      {/* ── Ground 3: the tinted neutral ────────────────────────────────
          A green-tinted ground rather than another gray, so the page's three
          surfaces are one tonal family. 1.32:1 against the page in both
          modes -- roughly 4x bg.subtle's 1.07, which is a recessed code-block
          fill and was never a section ground. Green text is banned here
          (3.61:1 light); the ProseLink below is on `soft`, so it renders in
          `fg` and keeps its underline. */}
      <Box bg="band.bg.soft" px={[4, 8, 12]} py={[16, 20, 24]}>
        <Box maxW="1100px" mx="auto">
          <SectionHeading mb={8}>What DataPipe does</SectionHeading>

          <Box mb={[10, 10, 14]} maxW="70ch">
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
                ground="soft"
                external
              >
                DataPipe paper in <em>Behavior Research Methods</em>
              </ProseLink>
              . If you use DataPipe in your research, please cite it.
            </Text>
          </Box>

          {/* No icons above the cards. Database / Shield / Zap were decoration
              at the same size as the headings they sat on, and one of them meant
              nothing at all. */}
          <Stack direction={["column", "column", "row"]} gap={[8, 8, 12]}>
            {/* Blurb rules for this audience: name the dashboard feature the
                researcher will switch on, say what it does to their data, and
                spend a clause explaining any term they may not own. "base64"
                is now introduced by what it carries; "condition assignment" is
                their own vocabulary and keeps its name. Required-field checks
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
            <Feature title="Condition assignment">
              Ask DataPipe for the next condition and it counts through your
              conditions in order — 0, 1, 2, back to 0 — so groups stay
              balanced as participants arrive. You write no server code of your
              own.
            </Feature>
          </Stack>
        </Box>
      </Box>

      {/* ── Ground 1 again: the door at the end ─────────────────────────
          Same action as the hero, not a second competing one, and the same
          ground -- the green opens the page and closes it, which is what
          makes it read as the brand's color rather than as decoration on one
          section. */}
      <Box bg="band.bg" px={[4, 8, 12]} py={[16, 20, 24]}>
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
            <ProseLink href="/faq" ground="band">
              FAQ
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
            <ProseLink href="/faq#item-0b" ground="band">
              how to move to another provider
            </ProseLink>
            .
          </Text>
        </VStack>
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
      {/* Truthy, not `!== ""`: NEXT_PUBLIC_OSF_ENV is undefined in production,
          and `undefined !== ""` put a red "OSF Environment:" banner on the
          public homepage. pages/_app.js:38 still has the original test and is
          owned elsewhere. */}
      {Boolean(process.env.NEXT_PUBLIC_OSF_ENV) && <TestEnvironmentWarning />}
    </Box>
  );
};
