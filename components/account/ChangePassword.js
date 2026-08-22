import { useEffect, useState } from "react";

import {
  HStack,
  VStack,
  Button,
  Text,
  Dialog,
  Field,
  Input,
  Alert,
  CloseButton,
} from "@chakra-ui/react";

import { auth } from "../../lib/firebase";
import { updatePassword } from "firebase/auth";
import { messageForAuthError } from "../../lib/auth-errors";

export default function ChangePassword() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Gates the two validation messages on the field having been visited, not
  // just on its value -- otherwise "Password must be at least 12 characters"
  // renders in red the instant the dialog opens, before a single keystroke.
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [touchedConfirm, setTouchedConfirm] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null); // "success" | null
  const [error, setError] = useState("");

  // Reopening is a fresh attempt, not a continuation of whatever was left on
  // screen last time: an old error, an old "Success" tick, or a stale
  // touched-field flag must not greet the researcher before they have typed
  // anything this time.
  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirmPassword("");
      setTouchedPassword(false);
      setTouchedConfirm(false);
      setSubmitStatus(null);
      setError("");
    }
  }, [open]);

  // "Success" next to the button is only useful for the few seconds after a
  // change -- left on screen forever it reads as a permanent status rather
  // than a one-time confirmation. Reopening the dialog also clears it (above),
  // so this timeout only matters for someone who leaves the page open.
  useEffect(() => {
    if (submitStatus !== "success") return;
    const timer = setTimeout(() => setSubmitStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [submitStatus]);

  // Derived during render, not mirrored into state by an effect. Both are pure
  // functions of the two fields above, so storing them separately only created
  // a window -- the render between a keystroke and the effect that followed it
  // -- where the validation message on screen disagreed with the input beside
  // it. On first open that window was visible: passwordLengthSatisfied was
  // initialised true, so an empty field rendered as valid until the effect ran.
  const passwordMatch = password === confirmPassword;
  const passwordLengthSatisfied = password.length >= 12;

  const handleChangePassword = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      await updatePassword(auth.currentUser, password);
      setSubmitStatus("success");
      setOpen(false);
    } catch (err) {
      // Dialog stays open on failure -- closing it here would discard the
      // one thing that lets the researcher fix the problem: what they
      // already typed. auth/requires-recent-login is the likeliest failure
      // for a twice-a-year visitor, and a bare "Failed" gave them nothing to
      // act on.
      setError(messageForAuthError(err?.code, null, "changePassword"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
      <Text fontSize={"lg"}>Password</Text>
      <HStack>
        {submitStatus === "success" && (
          <Text fontSize="sm" color="green.400">Success</Text>
        )}
        <Button loading={isSubmitting} onClick={() => setOpen(true)} colorPalette="brandTeal">
          Change Password
        </Button>
      </HStack>
      <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="greyBackground" color="white">
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" aria-label="Close" />
            </Dialog.CloseTrigger>
            <Dialog.Header>Change Password</Dialog.Header>
            <Dialog.Body>
              <VStack gap={4}>
                <Field.Root
                  id="new-password"
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
                <Field.Root
                  id="confirm-password"
                  invalid={touchedConfirm && !passwordMatch}
                >
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
                variant={"solid"}
                colorPalette={"brandTeal"}
                size={"md"}
                onClick={handleChangePassword}
                loading={isSubmitting}
                disabled={!passwordMatch || !passwordLengthSatisfied}
              >
                Change Password
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </HStack>
  );
}
