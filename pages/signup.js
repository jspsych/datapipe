import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";

import {
  Card,
  CardBody,
  CardHeader,
  Heading,
  Link as ChakraLink,
  Text,
  FormControl,
  Stack,
  Input,
  FormLabel,
  Button,
  FormErrorMessage,
  Alert,
  AlertIcon,
  VStack,
} from "@chakra-ui/react";
import { ERROR, getError } from "../lib/utils";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorEmail, setErrorEmail] = useState("");
  const [errorPassword, setErrorPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async () => {
    setIsSubmitting(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;

      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        uid: user.uid,
        osfToken: "",
        osfTokenValid: false,
        experiments: [],
      });

      router.push("/admin");
    } catch (error) {
      const { code } = error;
      if (ERROR.PASSWORD_WEAK === code) {
        setErrorPassword(getError(code));
      } else {
        setErrorEmail(getError(code));
      }
      setIsSubmitting(false);
      console.log(error);
    }
  };

  return (
    <VStack w={["100%", 660]} spacing={8}>
      <Alert status="warning" variant="solid">
        <AlertIcon />
        This service is still in development. Do not use for anything important
        yet.
      </Alert>
      <Card w={360}>
        <CardHeader>
          <Heading size="lg">Sign Up</Heading>
        </CardHeader>
        <CardBody>
          <Stack>
            <FormControl id="email" isInvalid={errorEmail}>
              <FormLabel>Email</FormLabel>
              <Input
                type="email"
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrorEmail("");
                }}
              />
              <FormErrorMessage>{errorEmail}</FormErrorMessage>
            </FormControl>
            <FormControl id="password" pb={4} isInvalid={errorPassword}>
              <FormLabel>Password</FormLabel>
              <Input
                type="password"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorPassword("");
                }}
              />
              <FormErrorMessage>{errorPassword}</FormErrorMessage>
            </FormControl>
            <Text>&nbsp;</Text>
            <Button
              colorScheme={"brandTeal"}
              isLoading={isSubmitting}
              onClick={onSubmit}
            >
              Create Account
            </Button>
            <Text pt={4}>
              Have an account?{" "}
              <Link href="/signin" passHref>
                <ChakraLink>Sign In!</ChakraLink>
              </Link>
            </Text>
          </Stack>
        </CardBody>
      </Card>
    </VStack>
  );
}
