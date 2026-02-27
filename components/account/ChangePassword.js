import { useState, useContext, useEffect } from "react";
import { UserContext } from "../../lib/context";

import {
  HStack,
  VStack,
  Button,
  Text,
  Dialog,
  Field,
  Input,
} from "@chakra-ui/react";

import { auth } from "../../lib/firebase";
import { updatePassword } from "firebase/auth";

export default function ChangePassword() {
  const { user } = useContext(UserContext);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMatch, setPasswordMatch] = useState(true);
  const [passwordLengthSatisfied, setPasswordLengthSatisfied] = useState(true);

  useEffect(() => {
    if (password !== confirmPassword) {
      setPasswordMatch(false);
    } else {
      setPasswordMatch(true);
    }
  }, [password, confirmPassword]);

  useEffect(() => {
    if (password.length < 6) {
      setPasswordLengthSatisfied(false);
    } else {
      setPasswordLengthSatisfied(true);
    }
  }, [password]);

  return (
    <HStack justifyContent="space-between" w="100%">
      <Text fontSize={"lg"}>Password</Text>
      <Button loading={isSubmitting} onClick={() => setOpen(true)} colorPalette="brandTeal">
        Change Password
      </Button>
      <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="greyBackground">
            <Dialog.Header>Change Password</Dialog.Header>
            <Dialog.CloseTrigger />
            <Dialog.Body>
              <VStack gap={4}>
                <Field.Root
                  id="new-password"
                  invalid={!passwordLengthSatisfied}
                >
                  <Field.Label>New Password</Field.Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Field.ErrorText>
                    Password must be at least 6 characters
                  </Field.ErrorText>
                </Field.Root>
                <Field.Root id="confirm-password" invalid={!passwordMatch}>
                  <Field.Label>Confirm Password</Field.Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <Field.ErrorText>Passwords do not match</Field.ErrorText>
                </Field.Root>
              </VStack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                variant={"solid"}
                colorPalette={"brandTeal"}
                size={"md"}
                mr={4}
                onClick={() => handleChangePassword(password, setIsSubmitting)}
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

async function handleChangePassword(newPassword, setIsSubmitting) {
  setIsSubmitting(true);
  const user = auth.currentUser;

  try {
    await updatePassword(user, newPassword);
    setIsSubmitting(false);
  } catch (error) {
    console.log(error);
  }
}
