import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/router";
import { auth, db } from "../lib/firebase";

import {
  Card,
  Heading,
  Link as ChakraLink,
  Text,
  Field,
  Input,
  Button,
  VStack,
  HStack,
  Separator,
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
        usingPersonalToken: false,
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
    }
  };

  return (
    <Card.Root w={400} mx="auto" variant="unstyled" color="white">
      <Card.Body p={8}>
        <VStack gap={6}>
          <Heading size="lg" textAlign="center">Create Account</Heading>

          <SignUpWithOSF />

          <HStack w="full" alignItems="center">
            <Separator flex="1" />
            <Text fontSize="sm" color="gray.400" px={3} whiteSpace="nowrap" textTransform="uppercase" fontWeight="medium" letterSpacing="wide">or</Text>
            <Separator flex="1" />
          </HStack>

          <VStack gap={4} w="full">
            <Field.Root id="email" invalid={!!errorEmail}>
              <Field.Label>Email</Field.Label>
              <Input
                type="email"
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrorEmail("");
                }}
              />
              <Field.ErrorText>{errorEmail}</Field.ErrorText>
            </Field.Root>

            <Field.Root id="password" invalid={!!errorPassword}>
              <Field.Label>Password</Field.Label>
              <Input
                type="password"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorPassword("");
                }}
                onKeyDown={(e) => e.key === "Enter" && onSubmit()}
              />
              <Field.HelperText display={errorPassword === "" ? "block" : "none"}>
                Password must be at least 12 characters
              </Field.HelperText>
              <Field.ErrorText>{errorPassword}</Field.ErrorText>
            </Field.Root>

            <Button
              colorPalette="brandTeal"
              loading={isSubmitting}
              onClick={onSubmit}
              w="full"
              size="lg"
            >
              Create Account
            </Button>

            <Text fontSize="sm" color="gray.400">
              Have an account?{" "}
              <ChakraLink asChild color="brandOrange.300">
                <Link href="/signin">Sign In</Link>
              </ChakraLink>
            </Text>
          </VStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
