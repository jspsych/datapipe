import AuthCheck from "../../components/AuthCheck";
import { VStack, Box, Heading, Text, Spinner, Center } from "@chakra-ui/react";
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
import SettingsSection from "../../components/ui/SettingsSection";
import {
  ORCID_PROVIDER_ID,
  PASSWORD_PROVIDER_ID,
  linkedProviderIds,
} from "../../lib/auth-providers";
import { hasLegacyOsfConnection, osfSunsetLabel } from "../../lib/osf-sunset";

export default function AccountPage() {
  const { user } = useContext(UserContext);

  // The ONLY subscription to users/{uid} on this page. ProviderConnections,
  // OAuthTokenStatus and SelectAuth each used to open their own, which meant
  // redundant reads and -- worse -- each child resolving on its own schedule:
  // ProviderConnections rendered isConnected(undefined) === false on first
  // paint, so a connected researcher watched every provider flash "Connect"
  // before settling. One read, passed down, so the whole page agrees about
  // the state of the world at every moment.
  const [data, loading] = useDocumentData(
    user?.uid ? doc(db, "users", user.uid) : null
  );

  const [deleting, setDeleting] = useState(false);

  if (loading) {
    return (
      <Center py={16}>
        <Spinner size="lg" color="brandGreen.solid" />
      </Center>
    );
  }

  // Whether to offer the password form is a question about sign-in methods,
  // so it is answered from Firebase's providerData rather than the legacy
  // users/{uid}.authMethod field. A researcher who signed up with OSF and has
  // since linked a password must see this; one who only ever used a
  // federated provider has no password to change.
  const linkedIds = linkedProviderIds(user);
  const hasPassword = linkedIds.includes(PASSWORD_PROVIDER_ID);

  // Which account am I about to change? A researcher with a personal and a
  // lab account has no other way to tell them apart. ORCID lets researchers
  // keep their email private (see providesEmail in lib/auth-providers.js), so
  // an email-less account still gets a truthful line rather than a blank one.
  const accountIdentity =
    user?.email ||
    user?.displayName ||
    (linkedIds.includes(ORCID_PROVIDER_ID)
      ? "Signed in with ORCID"
      : "Signed in");

  // The OSF section is legacy surface: it is shown only to researchers who
  // actually connected OSF at some point, and disappears entirely for
  // everyone else. New accounts never see it.
  const showOsfSection = hasLegacyOsfConnection(data);
  const isOsfOAuthUser = data?.authMethod === "osf";

  // The date lives in lib/osf-sunset.js, never inline: every researcher-facing
  // surface has to name the same day. Null is tolerated there (no deadline
  // announced yet), so the clause is conditional rather than the sentence.
  const osfDeadline = osfSunsetLabel();
  const osfDescription =
    "DataPipe's original storage connection. It serves the OSF experiments " +
    "you already have — new experiments cannot use it" +
    (osfDeadline ? `, and DataPipe stops writing to OSF after ${osfDeadline}` : "") +
    ".";

  return (
    <AuthCheck fallbackRoute={deleting ? "/admin/deleted-account" : null}>
      <VStack gap={0} w="100%" maxW="560px" px={4} align="stretch">
        <Box mb={10}>
          <Heading>Account settings</Heading>
          <Text fontSize="sm" color="fg.muted" mt={1}>
            {accountIdentity}
          </Text>
        </Box>

        {/* Spacing carries the grouping -- no separators. DESIGN.md §4:
            mt={10} between routine sections, mt={16} before the Danger Zone,
            so the break before the irreversible section is the one break
            that reads as different. */}
        <SettingsSection
          title="Sign-in methods"
          description="How you sign in to DataPipe. Add a second method so you keep access if you lose one."
        >
          <LinkedAccounts />
        </SettingsSection>

        <Box mt={10}>
          <SettingsSection
            title="Storage providers"
            description="Where your experiment data lands. You need at least one connected before you can create an experiment."
          >
            <ProviderConnections data={data} />
          </SettingsSection>
        </Box>

        {/* OSF, legacy. Below the storage providers now, not above them --
            it serves in-flight experiments only. */}
        {showOsfSection && (
          <Box mt={10}>
            <SettingsSection title="OSF (legacy)" description={osfDescription}>
              {isOsfOAuthUser ? (
                <OAuthTokenStatus data={data} />
              ) : (
                <SelectAuth data={data} />
              )}
            </SettingsSection>
          </Box>
        )}

        {hasPassword && (
          <Box mt={10}>
            <SettingsSection
              title="Password"
              description="The password for the email and password method listed above. Changing it does not affect your other sign-in methods."
            >
              <ChangePassword />
            </SettingsSection>
          </Box>
        )}

        <Box mt={16}>
          <SettingsSection
            title="Danger zone"
            description="Deleting your account cannot be undone."
            variant="danger"
          >
            <DeleteAccount setDeleting={setDeleting} />
          </SettingsSection>
        </Box>
      </VStack>
    </AuthCheck>
  );
}
