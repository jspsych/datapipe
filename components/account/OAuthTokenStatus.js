import { useContext } from "react";
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

export default function OAuthTokenStatus() {
  const { user } = useContext(UserContext);

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

  const isRefreshTokenExpired = data.refreshTokenExpires && Date.now() > data.refreshTokenExpires;


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
      <HStack justifyContent="space-between" w="100%">
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
            <Alert.Title>Re-authentication Required</Alert.Title>
            <Alert.Description>
              Your OSF authorization has expired. Please sign out and sign back in with OSF to restore access.
            </Alert.Description>
          </Box>
        </Alert.Root>
      )}

    </VStack>
  );
}
