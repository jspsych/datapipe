import { useState } from "react";
import { Button, Alert, Text, VStack } from "@chakra-ui/react";
import { linkWithPopup, signInWithPopup } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { AUTH_PROVIDER_LIST } from "../../lib/auth-providers";
import { AUTH_PROVIDER_ICONS } from "../AuthProviderIcons";
import {
  isCancelledAuthError,
  messageForAuthError,
} from "../../lib/auth-errors";
import { ensureUserDocument } from "../../lib/user-bootstrap";

// The federated provider buttons, rendered from AUTH_PROVIDERS. Used by the
// sign-in page, the sign-up page, and the "add a sign-in method" migration
// banner -- for a federated provider signing in and signing up are the same
// operation, so `verb` only changes the wording.
//
// `mode` picks the Firebase call:
//   "signIn" -- signInWithPopup, for a visitor who is not signed in.
//   "link"   -- linkWithPopup, which attaches the credential to the CURRENT
//               user and leaves the uid alone. This is what lets an OSF-era
//               account adopt a new sign-in method without being severed from
//               the experiments that reference it by `owner: uid`.
//
// Popup rather than redirect: signInWithRedirect needs third-party storage
// access that Safari and Firefox block by default unless the auth handler is
// self-hosted on this domain, and DataPipe uses the default
// <project>.firebaseapp.com handler.
export default function AuthProviderButtons({
  verb = "Sign in",
  mode = "signIn",
  onSignedIn,
}) {
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState("");

  const handleClick = async (entry) => {
    setPendingId(entry.id);
    setError("");
    try {
      if (mode === "link") {
        const credential = await linkWithPopup(
          auth.currentUser,
          entry.makeProvider()
        );
        onSignedIn?.(credential.user);
      } else {
        const credential = await signInWithPopup(auth, entry.makeProvider());
        // A first-time federated sign-in has no users/{uid} doc yet; nothing
        // else in the app creates one for these providers.
        await ensureUserDocument(credential.user);
        onSignedIn?.(credential.user);
      }
    } catch (err) {
      if (!isCancelledAuthError(err?.code)) {
        setError(messageForAuthError(err?.code, entry.name, mode));
      }
    } finally {
      setPendingId(null);
    }
  };

  return (
    <VStack gap={3} w="full">
      {error && (
        <Alert.Root status="error" borderRadius="md">
          <Alert.Indicator />
          <Text fontSize="sm">{error}</Text>
        </Alert.Root>
      )}

      {AUTH_PROVIDER_LIST.map((entry) => {
        const Icon = AUTH_PROVIDER_ICONS[entry.id];
        return (
          <Button
            key={entry.id}
            variant="outline"
            width="full"
            size="lg"
            loading={pendingId === entry.id}
            disabled={pendingId !== null && pendingId !== entry.id}
            onClick={() => handleClick(entry)}
          >
            {Icon && <Icon />} {verb} with {entry.name}
          </Button>
        );
      })}
    </VStack>
  );
}
