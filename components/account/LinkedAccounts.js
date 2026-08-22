import { useContext, useEffect, useState } from "react";
import {
  HStack,
  VStack,
  Text,
  Button,
  Alert,
  Badge,
  Dialog,
  Field,
  Input,
  CloseButton,
} from "@chakra-ui/react";
import {
  EmailAuthProvider,
  linkWithCredential,
  linkWithPopup,
  unlink,
} from "firebase/auth";
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
        setError(messageForAuthError(err?.code, entry.name, "link"));
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
      setError(messageForAuthError(err?.code, entry.name, "unlink"));
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
                colorPalette="brandGreen"
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

      {hasPassword ? (
        <HStack justifyContent="space-between" w="100%">
          <HStack>
            <Text fontSize="lg">Email and password</Text>
            <CircleCheck color="var(--chakra-colors-green-500)" size={18} />
          </HStack>
          <Badge colorPalette="gray">Enabled</Badge>
        </HStack>
      ) : (
        // ORCID lets researchers keep their email private (see the
        // providesEmail comment in lib/auth-providers.js), and a password
        // credential has to be built from a real email address. An
        // ORCID-only account with no disclosed email has nothing to attach
        // a password to, so render nothing rather than a button that can
        // only fail.
        user.email && (
          <AddPasswordRow user={user} setAfterAction={setAfterAction} />
        )
      )}
    </VStack>
  );
}

// Lets a researcher whose only sign-in methods are federated add an
// email/password fallback, using the email address Firebase already has on
// file for them (there is nowhere else on this page to type a different one,
// and EmailAuthProvider.credential needs a real address to attach the
// password to).
function AddPasswordRow({ user, setAfterAction }) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Same touched-gating as ChangePassword: no red validation text before the
  // researcher has typed anything.
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [touchedConfirm, setTouchedConfirm] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirmPassword("");
      setTouchedPassword(false);
      setTouchedConfirm(false);
      setError("");
    }
  }, [open]);

  const passwordMatch = password === confirmPassword;
  // Mirrors ChangePassword's 12-character rule -- same Firebase project,
  // same policy. Not shared as a constant: each dialog is small enough that
  // the duplication costs less than a new module for one number.
  const passwordLengthSatisfied = password.length >= 12;

  const handleAddPassword = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      const result = await linkWithCredential(auth.currentUser, credential);
      // Same tagging discipline as handleLink above: linking mutates
      // providerData in place without re-emitting an auth state, so the
      // returned user is recorded here, tagged with its uid, and takes
      // precedence over the derived read.
      setAfterAction({
        uid: result.user.uid,
        ids: linkedProviderIds(result.user),
      });
      setOpen(false);
    } catch (err) {
      setError(messageForAuthError(err?.code, "password", "setPassword"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <HStack justifyContent="space-between" w="100%">
      <Text fontSize="lg">Email and password</Text>
      <Button colorPalette="brandGreen" size="sm" onClick={() => setOpen(true)}>
        Add password
      </Button>

      <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="greyBackground" color="white">
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" aria-label="Close" />
            </Dialog.CloseTrigger>
            <Dialog.Header>Add a Password</Dialog.Header>
            <Dialog.Body>
              <VStack gap={4} align="stretch">
                <Text fontSize="sm" color="gray.400">
                  This adds a password to sign in as {user.email}, alongside
                  the methods you already use.
                </Text>
                <Field.Root
                  invalid={touchedPassword && !passwordLengthSatisfied}
                >
                  <Field.Label>New Password</Field.Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setTouchedPassword(true)}
                  />
                  <Field.ErrorText>
                    Password must be at least 12 characters
                  </Field.ErrorText>
                </Field.Root>
                <Field.Root invalid={touchedConfirm && !passwordMatch}>
                  <Field.Label>Confirm Password</Field.Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onBlur={() => setTouchedConfirm(true)}
                  />
                  <Field.ErrorText>Passwords do not match</Field.ErrorText>
                </Field.Root>

                {error && (
                  <Alert.Root status="error" borderRadius="md">
                    <Alert.Indicator />
                    <Text fontSize="sm">{error}</Text>
                  </Alert.Root>
                )}
              </VStack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                colorPalette="brandGreen"
                onClick={handleAddPassword}
                loading={isSubmitting}
                disabled={!passwordMatch || !passwordLengthSatisfied}
                ml={3}
              >
                Add Password
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </HStack>
  );
}
