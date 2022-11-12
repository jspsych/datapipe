import {
  Stack,
  Heading,
  Text,
  FormControl,
  FormLabel,
  Input,
  Button,
} from "@chakra-ui/react";

import { auth } from "../lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";

import { useState } from "react";

export default function ResetPassword() {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [sentEmail, setSentEmail] = useState(false);
  return (
    <Stack>
      {sentEmail && (
        <Text>
          An email has been sent with a link to reset your password.
        </Text>
      )}
      {!sentEmail && (
        <>
          <Heading as="h2" size="xl">
            Forgot your password?
          </Heading>
          <Text>We will send you an email with a link to reset.</Text>
          <FormControl id="reset-email">
            <FormLabel>Email</FormLabel>
            <Input type="email" />
          </FormControl>
          <Button isLoading={isSubmitting} onClick={() => handleResetPasswordButton(setIsSubmitting, setSentEmail)}>
            Request Reset
          </Button>
        </>
      )}
    </Stack>
  );
}

async function handleResetPasswordButton(setIsSubmitting, setSentEmail) {
  const email = document.querySelector("input#reset-email").value;

  setIsSubmitting(true);

  try {
    await sendPasswordResetEmail(auth, email);
    setIsSubmitting(false);
    setSentEmail(true);
  } catch (error) {
    setIsSubmitting(false);
    console.log("Password reset failed");
    console.log(error);
  }
}
