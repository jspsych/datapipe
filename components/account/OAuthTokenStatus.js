import { useContext, useState } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  HStack,
  VStack,
  Text,
  Tooltip,
  Alert,
  Link,
  Box
} from "@chakra-ui/react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import OsfRelinkButton from "./OsfRelinkButton";

export default function OAuthTokenStatus() {
  const { user } = useContext(UserContext);

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

  const [data, loading, error] = useDocumentData(
    user?.uid ? doc(db, "users", user.uid) : null
  );

  if (loading) {
    return <Text>Loading OAuth status...</Text>;
  }

  if (error || !data) {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Title>Error loading OAuth status</Alert.Title>
      </Alert.Root>
    );
  }

  const isRefreshTokenExpired =
    data.refreshTokenExpires && mountedAt > data.refreshTokenExpires;


  const getStatusIcon = () => {
    if (isRefreshTokenExpired) {
      return <TriangleAlert color="var(--chakra-colors-red-500)" />;
    } else {
      return <CircleCheck color="var(--chakra-colors-green-500)" />;
    }
  };

  const getStatusText = () => {
    if (isRefreshTokenExpired) {
      return "Re-authentication Required";
    } else {
      return "Connected";
    }
  };

  const osfProfileUrl = data.osfUserId ?
    `https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfUserId}/` :
    `https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/`;

  return (
    <VStack gap={4} w="100%" align="stretch">
      <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
        <HStack>
          <Text fontSize="lg" fontWeight="medium">Connected to OSF Account</Text>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span>{getStatusIcon()}</span>
            </Tooltip.Trigger>
            <Tooltip.Positioner>
              <Tooltip.Content>{getStatusText()}</Tooltip.Content>
            </Tooltip.Positioner>
          </Tooltip.Root>
        </HStack>
        <Link
          href={osfProfileUrl}
          target="_blank"
          rel="noopener noreferrer"
          color="blue.500"
          fontSize="sm"
          fontWeight="medium"
        >
          View OSF Profile →
        </Link>
      </HStack>

      {isRefreshTokenExpired && (
        <Alert.Root status="error" size="sm">
          <Alert.Indicator />
          <Box>
            <Alert.Title>Re-authorization Required</Alert.Title>
            <Alert.Description>
              <VStack align="start" gap={3} mt={1}>
                <Text fontSize="sm">
                  DataPipe&apos;s permission to write to your OSF account has
                  expired, so any experiment still sending data to OSF has
                  stopped. Re-authorize to restore it.
                </Text>
                {/* Deliberately a re-authorization, not "sign out and sign
                    back in with OSF" as this used to say: that advice depends
                    on OSF sign-in, which is being removed, and would strand
                    an in-flight study the day it goes. */}
                <OsfRelinkButton>Re-authorize OSF</OsfRelinkButton>
              </VStack>
            </Alert.Description>
          </Box>
        </Alert.Root>
      )}

    </VStack>
  );
}
