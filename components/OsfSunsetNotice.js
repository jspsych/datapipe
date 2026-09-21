import { Box, Text } from "@chakra-ui/react";
import Link from "next/link";
import { Link as ChakraLink } from "@chakra-ui/react";
import { osfSunsetLabel } from "../lib/osf-sunset";

// Researcher-facing notice that an OSF-backed experiment is on borrowed time.
// Rendered on the dashboard (once, if any experiment still writes to OSF) and
// on each legacy experiment's own page.
//
// The deadline sentence appears only when a date has actually been set in
// lib/osf-sunset.js -- the call to migrate is real either way, and naming a
// placeholder date would be worse than naming none.
export default function OsfSunsetNotice({ scope = "experiment" }) {
  const deadline = osfSunsetLabel();

  const subject =
    scope === "dashboard"
      ? "Some of your experiments still send data to OSF."
      : "This experiment sends data to OSF.";

  return (
    <Box
      w="100%"
      bg="brandOrange.subtle"
      border="1px solid"
      borderColor="brandOrange.border"
      borderRadius="md"
      px={4}
      py={3}
    >
      <Text fontSize="sm">
        <Text as="span" fontWeight="semibold">
          OSF support is ending.
        </Text>{" "}
        {subject} OSF is shutting down its projects feature, so DataPipe can no
        longer create new experiments on it
        {deadline ? ` and will stop writing to it after ${deadline}` : ""}. Data
        already on OSF is unaffected and stays in your OSF account. To keep
        collecting, connect another storage provider in{" "}
        <ChakraLink asChild color="brandOrange.fg" textDecoration="underline">
          <Link href="/admin/account">Account Settings</Link>
        </ChakraLink>{" "}
        and create a new experiment there.
      </Text>
    </Box>
  );
}
