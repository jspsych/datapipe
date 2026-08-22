import { useEffect, useState } from "react";
import { Box, HStack, IconButton, Link, Text } from "@chakra-ui/react";
import { TriangleAlert, X } from "lucide-react";
import { osfSunsetLabel } from "../lib/osf-sunset";

// Bump the version suffix to re-show the banner to everyone who dismissed the
// previous one. Dismissals are per-browser, not per-account, on purpose: the
// homepage is mostly read by signed-out visitors.
const DISMISS_KEY = "datapipe:announcement:osf-sunset:v1";

// localStorage throws rather than returning null in a few real configurations
// (Safari private browsing, "block all cookies", some embedded webviews). A
// visitor who cannot persist a dismissal should still see the announcement and
// still be able to close it for the session, so both helpers fail soft.
function wasDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Ignored: the banner still closes, it just comes back on the next visit.
  }
}

// Homepage announcement that OSF-backed storage is going away and DataPipe is
// becoming multi-backend. Links out to COS's own announcement rather than to
// anything on this site: the FAQ and getting-started pages still describe OSF
// as the only destination, so there is nothing here worth sending people to.
export default function OsfSunsetBanner() {
  // Starts hidden and is revealed in an effect. The site is statically
  // exported, so the server-rendered HTML cannot know whether this visitor has
  // dismissed the banner; rendering it on the server would make it flash for
  // everyone who already closed it.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!wasDismissed()) setVisible(true);
  }, []);

  if (!visible) return null;

  const deadline = osfSunsetLabel();

  return (
    <Box
      role="status"
      w="100%"
      bg="brandOrange.900"
      borderBottom="1px solid"
      borderColor="brandOrange.600"
      px={[4, 8, 12]}
      py={3}
    >
      <HStack maxW="1100px" mx="auto" gap={[3, 4]} align="start">
        <Box color="brandOrange.300" flexShrink={0} mt="2px">
          <TriangleAlert size={18} aria-hidden="true" />
        </Box>
        <Text fontSize="sm" lineHeight="tall" flex="1">
          <Text as="span" fontWeight="bold">
            {deadline
              ? `OSF support is ending on ${deadline}.`
              : "OSF support is ending."}
          </Text>{" "}
          OSF is shutting down its projects feature, so DataPipe is moving to a
          multi-backend model with support for Google Drive, Zenodo, and other
          storage providers. Experiments collecting data today keep running
          until then, and data already on OSF stays in your OSF account. We
          will publish migration instructions before anything stops working.{" "}
          <Link
            href="https://www.cos.io/blog/osf-changes-a-note-to-users"
            target="_blank"
            rel="noopener noreferrer"
            color="brandOrange.200"
            textDecoration="underline"
            _hover={{ color: "white" }}
          >
            Read the announcement from COS
          </Link>
          .
        </Text>
        <IconButton
          aria-label="Dismiss announcement"
          variant="ghost"
          size="xs"
          color="brandOrange.200"
          flexShrink={0}
          _hover={{ bg: "brandOrange.800", color: "white" }}
          onClick={() => {
            setVisible(false);
            rememberDismissal();
          }}
        >
          <X size={16} />
        </IconButton>
      </HStack>
    </Box>
  );
}
