import NextLink from "next/link";
import { Stack, Heading, Text, Link } from "@chakra-ui/react";

// A plain component with no data fetching -- Next.js statically optimizes
// pages/404.js automatically (https://nextjs.org/docs/pages/building-your-application/routing/custom-error#404-page),
// which is also why it can't read auth state the way most pages do: it
// renders before _app.js's ordinary per-page logic would have anything to
// key off of, and a page that only exists because the URL was wrong should
// not depend on anything that can itself fail.
//
// Layout: no getLayout override, so _app.js's default Navbar + Footer chrome
// applies exactly as it does on every other page (see pages/contact.js).
//
// Copy and structure follow DESIGN.md's page-title role (§3: 2xl/700/fg, one
// per page, sentence case) and the single-subject content column (§4:
// maxW="560px"). The task calls for something simple: a heading, one
// sentence of plain copy, and links back -- no card, no illustration, no
// eyebrow label, matching components/ui/EmptyState.js's DESIGN.md §6 mandate
// ("text only: no illustration, no mascot, no emoji") without borrowing that
// component's bordered panel, which is scoped to zero-state content inside a
// page rather than a page that stands in for missing content itself.
export default function Custom404() {
  return (
    <Stack w="100%" maxW="560px" gap={4}>
      <Heading as="h1" size="2xl" mb={4}>
        Page not found
      </Heading>
      <Text>
        The page you were looking for does not exist, or may have moved.
      </Text>
      <Text>
        {/* Links carry a persistent underline rather than color alone
            (DESIGN.md §5: no green/body-text pairing reaches the 3:1
            color-difference floor in either mode), and use brandGreen.fg,
            the app-wide link color. */}
        <Link
          asChild
          color="brandGreen.fg"
          textDecoration="underline"
          textUnderlineOffset="2px"
        >
          <NextLink href="/">Go to the homepage</NextLink>
        </Link>
        {" or read the "}
        <Link
          asChild
          color="brandGreen.fg"
          textDecoration="underline"
          textUnderlineOffset="2px"
        >
          <NextLink href="/docs">documentation</NextLink>
        </Link>
        .
      </Text>
    </Stack>
  );
}
