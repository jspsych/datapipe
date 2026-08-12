import { useContext, useState } from "react";
import { HStack, VStack, Text, Button, Alert, Badge } from "@chakra-ui/react";
import { linkWithPopup, unlink } from "firebase/auth";
import { CircleCheck } from "lucide-react";
import { UserContext } from "../../lib/context";
import { auth } from "../../lib/firebase";
import {
  AUTH_PROVIDER_LIST,
  PASSWORD_PROVIDER_ID,
  canUnlink,
  linkedProviderIds,
} from "../../lib/auth-providers";
import { AUTH_PROVIDER_ICONS } from "../AuthProviderIcons";
import {
  isCancelledAuthError,
  messageForAuthError,
} from "../../lib/auth-errors";

// Account-page section listing how this researcher can sign in, driven by
// Firebase's own record (user.providerData) crossed with AUTH_PROVIDERS.
// Firestore is deliberately not consulted: providerData IS the source of
// truth for sign-in methods, and the legacy users/{uid}.authMethod field
// describes only the OSF era.
//
// linkWithPopup attaches a credential to the EXISTING Firebase user, so the
// uid never changes. That matters more than it looks: experiments are keyed
// by `owner: uid`, so an account that gained its new sign-in method by any
// route that mints a fresh uid would be severed from its own data.
export default function LinkedAccounts() {
  const { user } = useContext(UserContext);

  // The linked list is DERIVED from the user below rather than copied into
  // state by an effect. link/unlink mutate providerData in place without
  // re-emitting an auth state, so each call's return value is recorded here
  // and takes precedence -- tagged with the uid it describes so it can never
  // bleed onto a different account.
  const [afterAction, setAfterAction] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState("");

  const handleLink = async (entry) => {
    setPendingId(entry.id);
    setError("");
    try {
      const credential = await linkWithPopup(
        auth.currentUser,
        entry.makeProvider()
      );
      setAfterAction({
        uid: credential.user.uid,
        ids: linkedProviderIds(credential.user),
      });
    } catch (err) {
      if (!isCancelledAuthError(err?.code)) {
        setError(messageForAuthError(err?.code, entry.name));
      }
    } finally {
      setPendingId(null);
    }
  };

  const handleUnlink = async (entry) => {
    setPendingId(entry.id);
    setError("");
    try {
      const updated = await unlink(auth.currentUser, entry.providerId);
      setAfterAction({ uid: updated.uid, ids: linkedProviderIds(updated) });
    } catch (err) {
      setError(messageForAuthError(err?.code, entry.name));
    } finally {
      setPendingId(null);
    }
  };

  if (!user) return null;

  const linkedIds =
    afterAction?.uid === user.uid ? afterAction.ids : linkedProviderIds(user);

  const hasPassword = linkedIds.includes(PASSWORD_PROVIDER_ID);

  return (
    <VStack gap={3} w="100%" align="stretch">
      {error && (
        <Alert.Root status="error" borderRadius="md">
          <Alert.Indicator />
          <Text fontSize="sm">{error}</Text>
        </Alert.Root>
      )}

      {linkedIds.length === 1 && (
        <Text fontSize="sm" color="gray.400">
          You have one way to sign in. Adding a second means you keep access if
          you ever lose the first.
        </Text>
      )}

      {AUTH_PROVIDER_LIST.map((entry) => {
        const Icon = AUTH_PROVIDER_ICONS[entry.id];
        const linked = linkedIds.includes(entry.providerId);
        // canUnlink counts the password method too, so a researcher with a
        // password plus one federated provider can still drop the federated
        // one.
        const last = linked && !canUnlink(linkedIds, entry.providerId);

        return (
          <HStack
            key={entry.id}
            justifyContent="space-between"
            w="100%"
            flexWrap="wrap"
            gap={3}
          >
            <HStack>
              {Icon && <Icon />}
              <Text fontSize="lg">{entry.name}</Text>
              {linked && (
                <CircleCheck color="var(--chakra-colors-green-500)" size={18} />
              )}
            </HStack>

            {linked ? (
              <Button
                variant="outline"
                size="sm"
                disabled={last}
                loading={pendingId === entry.id}
                onClick={() => handleUnlink(entry)}
                title={
                  last
                    ? "This is your only way to sign in. Add another method before removing it."
                    : undefined
                }
              >
                {last ? "Only sign-in method" : "Unlink"}
              </Button>
            ) : (
              <Button
                colorPalette="brandTeal"
                size="sm"
                loading={pendingId === entry.id}
                onClick={() => handleLink(entry)}
              >
                Link {entry.name}
              </Button>
            )}
          </HStack>
        );
      })}

      {hasPassword && (
        <HStack justifyContent="space-between" w="100%">
          <HStack>
            <Text fontSize="lg">Email and password</Text>
            <CircleCheck color="var(--chakra-colors-green-500)" size={18} />
          </HStack>
          <Badge colorPalette="gray">Enabled</Badge>
        </HStack>
      )}
    </VStack>
  );
}
