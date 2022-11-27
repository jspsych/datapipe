import {
  Card,
  CardHeader,
  CardBody,
  Stack,
  Heading,
  Text,
  FormControl,
  FormLabel,
  FormErrorMessage,
  Input,
  Button,
} from "@chakra-ui/react";

import { auth } from "../lib/firebase";
import { sendPasswordResetEmail, confirmPasswordReset } from "firebase/auth";

import { useEffect, useState } from "react";
import { useRouter } from 'next/router'

export const getError = (code) => {
  switch(code) {
    case 'auth/weak-password':        return 'Password must be at least 6 characters';
    case 'auth/invalid-action-code':  return 'Inalid token, resend link to reset password';
    case 'auth/email-already-in-use': return 'Email already in use';
    case 'auth/invalid-email':        return 'Invalid email';
    default: return 'We had an error, try again later!';
  }
}

export default function ResetPassword() {
  const router = useRouter()
  const [state, setState] = useState('forgot');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('')
  const [error, setError] = useState('');

  useEffect(() => {
    if (router.query?.token) {
      setState('token');
      setToken(router?.query?.token);
    }
  }, []);

  const setNewPassword = async () => {
    setIsSubmitting(true);
    try {
      await confirmPasswordReset(auth, token, password)
      router.push("/admin");
    } catch (error) {
      setError(error.code)
      setIsSubmitting(false);
      console.log(error);
    }  
  }

  return (
    <Card w={360}>
      <CardHeader>
        <Heading size='lg'>Forgotten password</Heading>
      </CardHeader>
      <CardBody>
        <Stack>
          {state === 'send' && (
            <Text>
              We have sent you link to reset password, please check in spam before resubmittting form.
           </Text>
          )}
          {state === 'forgot' && (
            <>
              <FormControl id="reset-email">
                <FormLabel>Email</FormLabel>
                <Input type="email" />
              </FormControl>
              <Text>Enter your email and we will send you a link to reset your password.</Text>
              <Button
                colorScheme={"green"}
                isLoading={isSubmitting}
                onClick={() => handleResetPasswordButton(setIsSubmitting, setState)}>
                Request Reset
              </Button>
            </>
          )}
          {state === 'token' && (
            <>
              <FormControl isInvalid={error}>
                <FormLabel>Password</FormLabel>
                <Input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)} />
                <FormErrorMessage>{getError(error)}</FormErrorMessage>
              </FormControl>
              <Text>Provide a new password</Text>
              <Button
                colorScheme={"green"}
                isLoading={isSubmitting}
                onClick={setNewPassword}>
                Set New Password
              </Button>
            </>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}

async function handleResetPasswordButton(setIsSubmitting, setState) {
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
