import { useState } from "react";
import { HStack, VStack, Text, Alert, Link, Box } from "@chakra-ui/react";
import StatusIndicator from "../ui/StatusIndicator";
import OsfRelinkButton from "./OsfRelinkButton";

// `data` is the users/{uid} document, subscribed to ONCE by
// pages/admin/account.js and passed down. This component used to open its
// own subscription (a third read of the same document on one page) and
// carried its own loading and error branches for it; the page already gates
// on loading, and only renders this at all when hasLegacyOsfConnection(data)
// is true, so by the time it mounts `data` exists.
export default function OAuthTokenStatus({ data }) {
  // Read once, at mount, instead of calling Date.now() in the render body.
  // The clock is external mutable state: reading it during render makes this
  // component impure, so two renders with identical props could disagree, and
  // in a concurrent render React is free to discard and retry the work. A
  // fixed instant makes the comparison below stable and reproducible.
  //
  // The trade-off, accepted deliberately: a page left open across the exact
  // moment the refresh token expires keeps showing "Connected" until something
  // re-mounts it. That is a coarse, day-scale badge -- a ticking clock to
  // catch the boundary would be more machinery than the signal is worth.
  const [mountedAt] = useState(() => Date.now());

  if (!data) return null;

  const isRefreshTokenExpired =
    data.refreshTokenExpires && mountedAt > data.refreshTokenExpires;

  const osfProfileUrl = data.osfUserId
    ? `https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfUserId}/`
    : `https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/`;

  return (
    <VStack gap={4} w="100%" align="stretch">
      <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
        <HStack>
          <Text fontSize="md" fontWeight="medium">
            Connected to OSF account
          </Text>
          {/* The status word used to live inside a hover Tooltip, which made
              it unreachable on touch, unreliable by keyboard, and never
              announced -- a color-and-icon-alone signal in practice. The
              label is always rendered now. */}
          <StatusIndicator
            status={isRefreshTokenExpired ? "error" : "ok"}
            label={
              isRefreshTokenExpired ? "Re-authorization required" : "Connected"
            }
          />
        </HStack>
        <Link
          href={osfProfileUrl}
          target="_blank"
          rel="noopener noreferrer"
          color="brandGreen.fg"
          textDecoration="underline"
          fontSize="sm"
          fontWeight="medium"
        >
          View OSF profile →
        </Link>
      </HStack>

      {isRefreshTokenExpired && (
        <Alert.Root status="error" size="sm">
          <Alert.Indicator />
          <Box>
            <Alert.Title>Re-authorization required</Alert.Title>
            <Alert.Description>
              <VStack align="start" gap={3} mt={2}>
                <Text fontSize="sm">
                  DataPipe&apos;s permission to write to your OSF account has
                  expired, so any experiment still sending data to OSF has
                  stopped. Re-authorize to restore it.
                </Text>
                {/* Deliberately a re-authorization, not "sign out and sign
                    back in with OSF" as this used to say: that advice depends
                    on OSF sign-in, which is being removed, and would strand
                    an in-flight study the day it goes. */}
                <OsfRelinkButton size="sm">Re-authorize OSF</OsfRelinkButton>
              </VStack>
            </Alert.Description>
          </Box>
        </Alert.Root>
      )}
    </VStack>
  );
}
