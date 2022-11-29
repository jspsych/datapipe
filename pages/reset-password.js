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
import { getError } from "../lib/utils";

export default function ResetPassword() {
  const router = useRouter()
  const [state, setState] = useState('forgot');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [token, setToken] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (router.query?.token) {
      setState('token');
      setToken(router?.query?.token);
    }
  }, []);

  const resetPassword = async () => {
    setIsSubmitting(true);  
    try {
      await sendPasswordResetEmail(auth, email);
      setIsSubmitting(false);
      setState('send');
    } catch (error) {
      setIsSubmitting(false);
      setError(getError(error.code));
      console.log("Password reset failed");
      console.log(error);
    }  
  }

  const setNewPassword = async () => {
    setIsSubmitting(true);
    try {
      await confirmPasswordReset(auth, token, password)
      router.push("/admin");
    } catch (error) {
      setError(getError(error.code))
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
              <FormControl isInvalid={error}>
                <FormLabel>Email</FormLabel>
                <Input type="email" onChange={e => { setEmail(e.target.value); setError('') }} />
                <FormErrorMessage>{error}</FormErrorMessage>
              </FormControl>
              <Text>Enter your email and we will send you a link to reset your password.</Text>
              <Button
                colorScheme={"green"}
                isLoading={isSubmitting}
                onClick={resetPassword}>
                Request Reset
              </Button>
            </>
          )}
          {state === 'token' && (
            <>
              <FormControl isInvalid={error}>
                <FormLabel>Password</FormLabel>
                <Input type="password" onChange={e => { setPassword(e.target.value); setError('') }} />
                <FormErrorMessage>{error}</FormErrorMessage>
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
