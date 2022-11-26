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

import { useEffect, useState } from "react";
import { useRouter } from 'next/router'

export default function ResetPassword() {
  const router = useRouter()
  const [state, setState] = useState('forgot');
  const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => {
    if (router?.query?.token) {
      setState('token');
    }
  }, [])

  return (
    <Stack>
      {state === 'send' && (
        <Text>
          An email has been sent with a link to reset your password.
        </Text>
      )}
      {state === 'forgot' && (
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
      {state === 'token' && (
        <>
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
    setState('send');
  } catch (error) {
    setIsSubmitting(false);
    console.log("Password reset failed");
    console.log(error);
  }
}
