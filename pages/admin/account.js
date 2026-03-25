import AuthCheck from "../../components/AuthCheck";
import { VStack, Heading, Text, Separator, Spinner, Center, Box } from "@chakra-ui/react";
import ChangePassword from "../../components/account/ChangePassword";

import DeleteAccount from "../../components/account/DeleteAccount";
import { useState, useContext } from "react";
import SelectAuth from "../../components/account/SelectAuth";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import OAuthTokenStatus from "../../components/account/OAuthTokenStatus";

export default function AccountPage({}) {
  const { user } = useContext(UserContext);

  const [data, loading, error, snapshot, reload] = useDocumentData(
      user?.uid ? doc(db, "users", user.uid) : null
  );

  const [deleting, setDeleting] = useState(false);

  if (loading) {
    return (
      <Center py={16}>
        <Spinner size="lg" color="brandTeal.500" />
      </Center>
    );
  }

  // Determine user type: OAuth users have authMethod === 'osf'
  const isOAuthUser = data?.authMethod === 'osf';

  return (
    <AuthCheck fallbackRoute={deleting ? "/admin/deleted-account" : null}>
      <VStack gap={0} w="100%" maxW="560px" px={4} align="stretch">
        <Heading mb={8}>Account Settings</Heading>

        {/* OSF Connection Section */}
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" color="gray.500" mb={3}>
          OSF Connection
        </Text>
        {isOAuthUser ? (
          <OAuthTokenStatus />
        ) : (
          <SelectAuth />
        )}

        {/* Account Section - only for email users */}
        {!isOAuthUser && (
          <>
            <Separator my={6} borderColor="whiteAlpha.200" />
            <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" color="gray.500" mb={3}>
              Account
            </Text>
            <ChangePassword />
          </>
        )}

        {/* Danger Zone */}
        <Separator my={6} borderColor="whiteAlpha.200" />
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" color="red.400" mb={3}>
          Danger Zone
        </Text>
        <Box borderWidth="1px" borderColor="red.900" borderRadius="md" p={4}>
          <DeleteAccount setDeleting={setDeleting} />
        </Box>
      </VStack>
    </AuthCheck>
  );
}
