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
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Link,
  Box
} from "@chakra-ui/react";
import { CheckCircleIcon, WarningIcon, InfoIcon } from "@chakra-ui/icons";

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
      <Alert status="error">
        <AlertIcon />
        <AlertTitle>Error loading OAuth status</AlertTitle>
      </Alert>
    );
  }

  const isRefreshTokenExpired = data.refreshTokenExpires && Date.now() > data.refreshTokenExpires;
  const isAccessTokenExpired = data.authTokenExpires && Date.now() > data.authTokenExpires;

  const getStatusIcon = () => {
    if (isRefreshTokenExpired) {
      return <WarningIcon color="red.500" />;
    } else if (isAccessTokenExpired) {
      return <InfoIcon color="blue.500" />;
    } else {
      return <CheckCircleIcon color="green.500" />;
    }
  };

  const getStatusText = () => {
    if (isRefreshTokenExpired) {
      return "Re-authentication Required";
    } else if (isAccessTokenExpired) {
      return "Connected (Auto-refreshing)";
    } else {
      return "Connected";
    }
  };


  // Construct OSF profile URL from user ID
  const osfProfileUrl = data.osfUserId ? `https://osf.io/${data.osfUserId}/` : 'https://osf.io/';

  return (
    <VStack spacing={4} w="100%" align="stretch">
      <HStack justifyContent="space-between" w="100%">
        <HStack>
          
          <Text fontSize="lg" fontWeight="medium">Connected to OSF Account</Text>
          <Tooltip label={getStatusText()}>
            {getStatusIcon()}
          </Tooltip>
        </HStack>
        <Link 
          href={osfProfileUrl} 
          isExternal 
          color="blue.500" 
          fontSize="sm"
          fontWeight="medium"
        >
          View OSF Profile →
        </Link>
      </HStack>

      {isRefreshTokenExpired && (
        <Alert status="error" size="sm">
          <AlertIcon />
          <Box>
            <AlertTitle>Re-authentication Required</AlertTitle>
            <AlertDescription>
              Your OSF authorization has expired. Please sign out and sign back in with OSF to restore access.
            </AlertDescription>
          </Box>
        </Alert>
      )}

      {isAccessTokenExpired && !isRefreshTokenExpired && (
        <Alert status="info" size="sm">
          <AlertIcon />
          <Box>
            <AlertTitle>Auto-Refreshing Access</AlertTitle>
            <AlertDescription>
              Your access token will be automatically refreshed when needed. No action required.
            </AlertDescription>
          </Box>
        </Alert>
      )}
    </VStack>
  );
}