import { Box, Text, VStack, Button, HStack } from "@chakra-ui/react";
import Link from "next/link";
import { hasContactEmail } from "../../lib/contact-email";

// Shown to researchers whose contact address has never been confirmed.
//
// ---------------------------------------------------------------------------
// WHY *UNVERIFIED* AND NOT *MISSING*
// ---------------------------------------------------------------------------
//
// "No contact email" is very nearly extinct, and deliberately so:
// ContactEmailGate (components/AuthCheck.js) walls off every admin route until
// a usable address exists, so a researcher cannot reach this dashboard without
// one. What the gate does NOT check is whether the address works --
// hasContactEmail() tests format only, never contactEmailVerified.
//
// That gap is the entire failure mode. A typo passes the gate. So does an
// address the 2026-08 backfill seeded from Firebase Auth, which is real but
// was never confirmed against the person now using the account. And
// upload-failure-notify.ts mails the address regardless of verified status --
// so the notification goes out, hard-bounces, and is marked terminally failed
// somewhere nobody looks. The researcher's data stopped arriving and the only
// system that could tell them believes it did.
//
// This banner exists because that failure is invisible from the researcher's
// side by construction: the symptom of a notification you cannot receive is
// silence, which is indistinguishable from everything being fine.
//
// ---------------------------------------------------------------------------
// NOT DISMISSIBLE, AND NO FLAG TO MAINTAIN
// ---------------------------------------------------------------------------
//
// Same reasoning as AddSignInMethodBanner: this is not a nag, it is the one
// warning about a silent data-loss path, and it removes itself the moment it is
// acted on. `contactEmailVerified` flipping to true is written server-side by
// verify-contact-email.ts and ONLY there, so the condition is exact and there
// is no dismissal state to store, expire, or reset when the address changes.
//
// ---------------------------------------------------------------------------
// NO SUBSCRIPTION OF ITS OWN
// ---------------------------------------------------------------------------
//
// `userDoc` is the users/{uid} document, passed down from the dashboard's
// single subscription -- the same convention ContactEmail, ProviderConnections
// and SelectAuth follow on the account page. This component used to open its
// own live listener, which made three on one document on /admin (AuthCheck's
// gate, the experiment list's provider check, and this), each with its own
// loading flicker. Undefined means "not loaded yet" and renders nothing,
// exactly as the in-component loading flag did.
export default function UnverifiedEmailBanner({ userDoc }) {
  if (!userDoc) return null;

  // Nothing to say to someone who is already reachable.
  if (userDoc.contactEmailVerified === true) return null;

  // No address at all is ContactEmailGate's job, not this banner's -- and a
  // researcher seeing this dashboard has already been past it. Staying quiet
  // here means the two never argue about the same account.
  if (!hasContactEmail(userDoc)) return null;

  return (
    <Box
      w="100%"
      bg="brandOrange.subtle"
      border="1px solid"
      borderColor="brandOrange.border"
      borderRadius="md"
      px={4}
      py={4}
    >
      <VStack align="stretch" gap={4}>
        <Box>
          <Text fontWeight="semibold" mb={2}>
            Confirm your email address
          </Text>
          <Text fontSize="sm" color="fg.muted">
            DataPipe emails you if data stops uploading for one of your
            experiments — but {userDoc.contactEmail} has never been confirmed,
            so we have no way to know it reaches you. If it does not, that
            notification is the one you would never see.
          </Text>
        </Box>

        <HStack>
          <Button asChild size="sm" colorPalette="brandOrange">
            <Link href="/admin/account">Confirm it now</Link>
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}
