import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";

import {
  Card,
  CardBody,
  Heading,
  Link as ChakraLink,
  Text,
  FormControl,
  Input,
  FormLabel,
  Button,
  FormErrorMessage,
  VStack,
  FormHelperText,
  HStack,
  Divider,
  Box,
} from "@chakra-ui/react";
import { ERROR, getError } from "../lib/utils";
import SignUpWithOSF from "../components/SignUpWithOSF";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorEmail, setErrorEmail] = useState("");
  const [errorPassword, setErrorPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async () => {
    if (password.length < 12) {
      setErrorPassword("Password must be at least 12 characters");
      return;
    }

    setIsSubmitting(true);

    try {
      // Check if this email is already used by an OAuth user
      const checkResponse = await fetch('/api/checkemailconflict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email })
      });

      if (checkResponse.ok) {
        const checkResult = await checkResponse.json();
        if (checkResult.conflict) {
          setErrorEmail("This email is already registered via OSF authentication. Please sign in with OSF instead.");
          setIsSubmitting(false);
          return;
        }
      }

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
        usingPersonalToken: true,
        refreshToken: "",
        refreshTokenExpires: 0,
        authToken: "",
        authTokenExpires: 0,
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
    <Card w={400} mx="auto">
      <CardBody p={8}>
        <VStack spacing={6}>
          <Heading size="lg" textAlign="center">Create Account</Heading>
          
          <SignUpWithOSF />

          <HStack w="full">
            <Divider />
            <Text fontSize="sm" color="gray.500" px={3}>or</Text>
            <Divider />
          </HStack>

          <VStack spacing={4} w="full">
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
            
            <FormControl id="password" isInvalid={errorPassword}>
              <FormLabel>Password</FormLabel>
              <Input
                type="password"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorPassword("");
                }}
              />
              <FormHelperText display={errorPassword === "" ? "block" : "none"}>
                Password must be at least 12 characters
              </FormHelperText>
              <FormErrorMessage>{errorPassword}</FormErrorMessage>
            </FormControl>

            <Button
              colorScheme="brandTeal"
              isLoading={isSubmitting}
              onClick={onSubmit}
              w="full"
              size="lg"
            >
              Create Account
            </Button>

            <Text fontSize="sm" color="gray.600">
              Have an account?{" "}
              <ChakraLink as={Link} href="/signin" color="blue.500">
                Sign In
              </ChakraLink>
            </Text>
          </VStack>
        </VStack>
      </CardBody>
    </Card>
  );
}
