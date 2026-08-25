import { Stack, SimpleGrid, Box, Text, Link } from "@chakra-ui/react";

import { ExternalLink } from "lucide-react";
import { STORAGE_PROVIDERS } from "../../lib/provider-config";
import { isLegacyOsfExperiment } from "../../lib/osf-sunset";
import OsfSunsetNotice from "../OsfSunsetNotice";

// A label/value pair, stacked: label above, value below.
//
// This used to be an HStack with `justify="space-between"` capped at 360px --
// a correct fix for the wrong layout. These pairs were a vertical list inside
// a 530px column, so the section reserved 530px, used 360px of it, and ran
// ~190px tall to state three short facts.
//
// They are a horizontal strip now (see the grid below), which means the pair
// no longer needs a cap to keep label and value within reading distance: they
// are one above the other, so the eye travels a line height instead of a
// column width. `minW={0}` on both the cell and the value box is what lets a
// long experiment ID or provider link shrink inside its grid track rather than
// forcing the track wider than its share.
function InfoCell({ label, children }) {
  return (
    <Stack gap={1} minW={0}>
      <Text color="fg.muted" fontSize="sm">
        {label}
      </Text>
      <Box minW={0}>{children}</Box>
    </Stack>
  );
}

// Links were `color="white"` -- invisible on a white panel the moment light
// mode ships. brandGreen.fg is DESIGN.md §5's link color (blue is retired):
// 4.77:1 on `bg`, 5.13:1 on `bg.panel` light; 6.71:1 dark. Underlined as well
// as tinted, so the link is not signalled by hue alone.
function ExternalValueLink({ href, children }) {
  return (
    <Link
      color="brandGreen.fg"
      textDecoration="underline"
      fontSize="sm"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}{" "}
      <ExternalLink
        aria-hidden="true"
        style={{ display: "inline", width: "0.9em", height: "0.9em" }}
      />
    </Link>
  );
}

export default function ExperimentInfo({ data }) {
  const provider = STORAGE_PROVIDERS[data.storageProvider];

  // Built as a list rather than written out as JSX so the grid can size itself
  // to however many facts this experiment actually has. A current experiment
  // has three; a legacy OSF one has four, because its storage location takes
  // two IDs to name instead of one.
  const cells = [
    <InfoCell key="id" label="Experiment ID">
      <Text fontSize="sm" color="fg">
        {data.id}
      </Text>
    </InfoCell>,
  ];

  if (provider) {
    cells.push(
      <InfoCell key="container" label={provider.containerLabel}>
        <ExternalValueLink href={provider.containerLink(data)}>
          {provider.containerLinkText}
        </ExternalValueLink>
      </InfoCell>
    );
  } else {
    cells.push(
      <InfoCell key="osf-project" label="OSF project">
        <ExternalValueLink
          href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfRepo}`}
        >
          {data.osfRepo}
        </ExternalValueLink>
      </InfoCell>,
      <InfoCell key="osf-component" label="OSF data component">
        <ExternalValueLink
          href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfComponent}`}
        >
          {data.osfComponent}
        </ExternalValueLink>
      </InfoCell>
    );
  }

  cells.push(
    <InfoCell key="sessions" label="Completed sessions">
      <Text fontSize="sm" color="fg">
        {data.sessions || 0}
      </Text>
    </InfoCell>
  );

  return (
    <Stack w="100%" gap={4}>
      {isLegacyOsfExperiment(data) && <OsfSunsetNotice scope="experiment" />}
      {/* One track per fact on a wide viewport, so this reads as a short
          orienting band across the top of the page instead of a tall list
          down the side of it. Two-up on tablets and one-up on phones, where
          a four-track row would put ~90px of measure under each label. */}
      <SimpleGrid
        columns={{ base: 1, sm: 2, md: cells.length }}
        gap={{ base: 4, md: 8 }}
        w="100%"
      >
        {cells}
      </SimpleGrid>
    </Stack>
  );
}
