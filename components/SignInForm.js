import {
  Button,
  Card,
  Input,
  Text,
  Link,
  Heading,
  Field,
  VStack,
  HStack,
  Separator,
} from "@chakra-ui/react";
import { auth } from "../lib/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useState } from "react";
import { useRouter } from "next/router";
import NextLink from "next/link";
import { ERROR, getError } from "../lib/utils";
import SignInWithOSF from "./SignInWithOSF";

export default function SignInForm({ routeAfterSignIn }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorEmail, setErrorEmail] = useState("");
  const [errorPassword, setErrorPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async () => {
    setIsSubmitting(true);
    try {
      const user = await signInWithEmailAndPassword(auth, email, password);
      router.push(routeAfterSignIn);
    } catch (error) {
      setIsSubmitting(false);
      const { code } = error;
      if (code == ERROR.PASSWORD_WRONG) {
        setErrorPassword(getError(code));
      } else {
        setErrorEmail(getError(code));
      }
      console.log("Sign in failed");
      console.log(error);
    }
  };

  return (
    <Card.Root w={400} mx="auto">
      <Card.Body p={8}>
        <VStack gap={6}>
          <Heading size="lg" textAlign="center">Sign In</Heading>

          <SignInWithOSF />

          <HStack w="full">
            <Separator />
            <Text fontSize="sm" color="gray.500" px={3}>or</Text>
            <Separator />
          </HStack>

          <VStack gap={4} w="full">
            <Field.Root invalid={!!errorEmail}>
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

            <Field.Root invalid={!!errorPassword}>
              <Field.Label>Password</Field.Label>
              <Input
                type="password"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorPassword("");
                }}
              />
              <Field.ErrorText>{errorPassword}</Field.ErrorText>
            </Field.Root>

            <Button
              colorPalette="brandTeal"
              loading={isSubmitting}
              onClick={onSubmit}
              w="full"
              size="lg"
            >
              Sign In
            </Button>

            <VStack gap={2} w="full">
              <Link asChild fontSize="sm" color="blue.500">
                <NextLink href="/reset-password">Forgot password?</NextLink>
              </Link>

              <Text fontSize="sm" color="gray.600">
                Need an account?{" "}
                <Link asChild color="blue.500">
                  <NextLink href="/signup">Sign Up</NextLink>
                </Link>
              </Text>
            </VStack>
          </VStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
