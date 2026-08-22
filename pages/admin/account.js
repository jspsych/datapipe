import AuthCheck from "../../components/AuthCheck";
import { VStack, Heading, Text, Separator, Spinner, Center } from "@chakra-ui/react";
import ChangePassword from "../../components/account/ChangePassword";

import DeleteAccount from "../../components/account/DeleteAccount";
import { useState, useContext } from "react";
import SelectAuth from "../../components/account/SelectAuth";
import LinkedAccounts from "../../components/account/LinkedAccounts";
import ProviderConnections from "../../components/account/ProviderConnections";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import OAuthTokenStatus from "../../components/account/OAuthTokenStatus";
import {
  PASSWORD_PROVIDER_ID,
  linkedProviderIds,
} from "../../lib/auth-providers";
import { hasLegacyOsfConnection } from "../../lib/osf-sunset";

function SectionLabel({ children, color = "gray.500" }) {
  return (
    <Text
      fontSize="xs"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="wide"
      color={color}
      mb={3}
    >
      {children}
    </Text>
  );
}

export default function AccountPage({}) {
  const { user } = useContext(UserContext);

  const [data, loading] = useDocumentData(
    user?.uid ? doc(db, "users", user.uid) : null
  );

  const [deleting, setDeleting] = useState(false);

  if (loading) {
    return (
      <Center py={16}>
        <Spinner size="lg" color="brandGreen.500" />
      </Center>
    );
  }

  // Whether to offer the password form is a question about SIGN-IN METHODS,
  // so it is answered from Firebase's providerData rather than the legacy
  // users/{uid}.authMethod field. A researcher who signed up with OSF and has
  // since linked a password must see this; one who only ever used a
  // federated provider has no password to change.
  const hasPassword = linkedProviderIds(user).includes(PASSWORD_PROVIDER_ID);

  // The OSF section is legacy surface: it is shown only to researchers who
  // actually connected OSF at some point, and disappears entirely for
  // everyone else. New accounts never see it.
  const showOsfSection = hasLegacyOsfConnection(data);
  const isOsfOAuthUser = data?.authMethod === "osf";

  return (
    <AuthCheck fallbackRoute={deleting ? "/admin/deleted-account" : null}>
      <VStack gap={0} w="100%" maxW="560px" px={4} align="stretch">
        <Heading mb={8}>Account Settings</Heading>

        {/* Sign-in methods */}
        <SectionLabel>Sign-in Methods</SectionLabel>
        <LinkedAccounts />

        {/* Storage Providers */}
        <Separator my={6} borderColor="whiteAlpha.200" />
        <SectionLabel>Storage Providers</SectionLabel>
        <ProviderConnections />

        {/* OSF, legacy. Below the storage providers now, not above them --
            it serves in-flight experiments only. */}
        {showOsfSection && (
          <>
            <Separator my={6} borderColor="whiteAlpha.200" />
            <SectionLabel>OSF (Legacy)</SectionLabel>
            {isOsfOAuthUser ? <OAuthTokenStatus /> : <SelectAuth />}
          </>
        )}

        {/* Account */}
        {hasPassword && (
          <>
            <Separator my={6} borderColor="whiteAlpha.200" />
            <SectionLabel>Account</SectionLabel>
            <ChangePassword />
          </>
        )}

        {/* Danger Zone */}
        <Separator my={6} borderColor="whiteAlpha.200" />
        <SectionLabel color="red.400">Danger Zone</SectionLabel>
        <DeleteAccount setDeleting={setDeleting} />
      </VStack>
    </AuthCheck>
  );
}
