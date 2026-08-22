import { Stack, HStack, Text, Link } from "@chakra-ui/react";

import { ExternalLink } from "lucide-react";
import { STORAGE_PROVIDERS } from "../../lib/provider-config";
import { isLegacyOsfExperiment } from "../../lib/osf-sunset";
import OsfSunsetNotice from "../OsfSunsetNotice";

// A label/value pair.
//
// These rows used `justify="space-between"` inside a column that can be 550px
// wide, so "Experiment ID" and its value ended up at opposite ends of the row
// with nothing tying them together -- the eye has to travel the full measure
// to pair a label with its value. Capping the row keeps the two within reading
// distance of each other at any column width.
//
// Label is `fg.muted` (8.30:1 light / 9.14:1 dark), value is `fg` (13.16 /
// 12.94). Both were `gray.400`, a raw palette step that is only defensible
// while the page is forced dark.
function InfoRow({ label, children }) {
  return (
    <HStack justify="space-between" flexWrap="wrap" gap={3} maxW="360px">
      <Text color="fg.muted" fontSize="sm">
        {label}
      </Text>
      {children}
    </HStack>
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

  return (
    <Stack w="100%" gap={2}>
      {isLegacyOsfExperiment(data) && <OsfSunsetNotice scope="experiment" />}
      <InfoRow label="Experiment ID">
        <Text fontSize="sm" color="fg">
          {data.id}
        </Text>
      </InfoRow>
      {provider ? (
        <InfoRow label={provider.containerLabel}>
          <ExternalValueLink href={provider.containerLink(data)}>
            {provider.containerLinkText}
          </ExternalValueLink>
        </InfoRow>
      ) : (
        <>
          <InfoRow label="OSF project">
            <ExternalValueLink
              href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfRepo}`}
            >
              {data.osfRepo}
            </ExternalValueLink>
          </InfoRow>
          <InfoRow label="OSF data component">
            <ExternalValueLink
              href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfComponent}`}
            >
              {data.osfComponent}
            </ExternalValueLink>
          </InfoRow>
        </>
      )}
      <InfoRow label="Completed sessions">
        <Text fontSize="sm" color="fg">
          {data.sessions || 0}
        </Text>
      </InfoRow>
    </Stack>
  );
}
