import { useContext, useEffect, useState } from "react";
import {
  Alert,
  HStack,
  VStack,
  Text,
  Button,
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
import FormErrorAlert from "../ui/FormErrorAlert";
import StatusIndicator from "../ui/StatusIndicator";
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
  // Name of the method just linked, or null to hide the banner. Plain
  // component state, not anything URL-derived: linkWithPopup and
  // linkWithCredential (AddPasswordRow below) both resolve in-page with no
  // redirect, so there is no query param to read or clear here -- a refresh
  // simply remounts with this back at null, which already satisfies "must
  // not reappear on refresh".
  const [linkedAlert, setLinkedAlert] = useState(null);

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
      setLinkedAlert(entry.name);
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
      <FormErrorAlert>{error}</FormErrorAlert>

      {/* colorPalette="brandGreen" + variant="outline" is deliberate, not the
          Alert default. `status="success"` alone maps to Chakra's stock
          `green` colorPalette (DESIGN.md §5: "one green, not two" -- the
          brand's #2E7D32 and stock green.500 are visibly different hues), and
          the default `variant="subtle"` paints colorPalette.fg on
          colorPalette.subtle, which DESIGN.md's brandGreen section calls out
          by name as 3.91:1 in dark mode -- under the body-text floor and
          "not approved for body text". `variant="outline"` instead colors
          the text with brandGreen.fg directly on the page's own background
          (no subtle fill), which is the pairing DESIGN.md's ratio table
          already clears (6.71:1 dark / 5.13:1 light on `bg.panel`). */}
      {linkedAlert && (
        <Alert.Root
          status="success"
          colorPalette="brandGreen"
          variant="outline"
          borderRadius="md"
          role="status"
          aria-live="polite"
        >
          <Alert.Indicator />
          <Alert.Title flex="1">{linkedAlert} sign-in added.</Alert.Title>
          <CloseButton
            size="sm"
            aria-label="Dismiss"
            onClick={() => setLinkedAlert(null)}
          />
        </Alert.Root>
      )}

      {/* Zero linked methods is not "nothing to say" -- it is the OSF-only
          population, reachable by the sign-in flow that is being removed and
          by nothing else (see AddSignInMethodBanner, which carries the same
          message on /admin). They were the one group this section stayed
          silent for. */}
      {linkedIds.length === 0 && (
        <Text fontSize="sm" color="fg.muted">
          You sign in to DataPipe through OSF, which is being retired. Link a
          method below and you keep this account, your experiments, and your
          settings exactly as they are.
        </Text>
      )}

      {linkedIds.length === 1 && (
        <Text fontSize="sm" color="fg.muted">
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
          <VStack key={entry.id} w="100%" align="stretch" gap={2}>
            <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
              <HStack>
                {Icon && <Icon />}
                {/* fontSize="md"/medium (16px/500): a step below
                    SettingsSection's 18px/600 heading, not level with it --
                    see SettingsSection.js's comment for the full rationale. */}
                <Text fontSize="md" fontWeight="medium">
                  {entry.name}
                </Text>
                {linked && <StatusIndicator status="ok" label="Linked" />}
              </HStack>

              {linked ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={last}
                  loading={pendingId === entry.id}
                  onClick={() => handleUnlink(entry)}
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

            {/* Why the button is dead, in visible text next to it. This used
                to live in a `title` on the disabled button -- invisible on
                touch, unreliable on a disabled element, and never announced. */}
            {last && (
              <Text fontSize="sm" color="fg.muted">
                This is your only way to sign in. Add another method before
                removing it.
              </Text>
            )}
          </VStack>
        );
      })}

      {hasPassword ? (
        // One status per row, in the slot the action would occupy. The row
        // used to carry two -- a bare check icon beside the name AND a gray
        // "Enabled" badge -- saying the same thing twice in two visual
        // languages, neither of which matched the other sections.
        <HStack justifyContent="space-between" w="100%">
          <Text fontSize="md" fontWeight="medium">
            Email and password
          </Text>
          <StatusIndicator status="ok" label="Enabled" />
        </HStack>
      ) : (
        // ORCID lets researchers keep their email private (see the
        // providesEmail comment in lib/auth-providers.js), and a password
        // credential has to be built from a real email address. An
        // ORCID-only account with no disclosed email has nothing to attach
        // a password to, so render nothing rather than a button that can
        // only fail.
        user.email && (
          <AddPasswordRow
            user={user}
            setAfterAction={setAfterAction}
            onLinked={setLinkedAlert}
          />
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
function AddPasswordRow({ user, setAfterAction, onLinked }) {
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
      onLinked("Email and password");
      setOpen(false);
    } catch (err) {
      setError(messageForAuthError(err?.code, "password", "setPassword"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <HStack justifyContent="space-between" w="100%">
      <Text fontSize="md" fontWeight="medium">
        Email and password
      </Text>
      <Button colorPalette="brandGreen" size="sm" onClick={() => setOpen(true)}>
        Add password
      </Button>

      <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content
            bg="bg.panel"
            color="fg"
            borderWidth="1px"
            borderColor="border"
          >
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" aria-label="Close" />
            </Dialog.CloseTrigger>
            <Dialog.Header>Add a password</Dialog.Header>
            <Dialog.Body>
              <VStack gap={4} align="stretch">
                <Text fontSize="sm" color="fg.muted">
                  This adds a password to sign in as {user.email}, alongside
                  the methods you already use.
                </Text>
                <Field.Root
                  invalid={touchedPassword && !passwordLengthSatisfied}
                >
                  <Field.Label>New password</Field.Label>
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
                  <Field.Label>Confirm password</Field.Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onBlur={() => setTouchedConfirm(true)}
                  />
                  <Field.ErrorText>Passwords do not match</Field.ErrorText>
                </Field.Root>

                <FormErrorAlert>{error}</FormErrorAlert>
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
                Add password
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </HStack>
  );
}
