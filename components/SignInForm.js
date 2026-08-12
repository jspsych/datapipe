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
import AuthProviderButtons from "./auth/AuthProviderButtons";
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
    }
  };

  return (
    <Card.Root w="100%" maxW={400} mx="auto" variant="unstyled" color="white">
      <Card.Body p={8}>
        <VStack gap={6}>
          <Heading size="lg" textAlign="center">Sign In</Heading>

          <AuthProviderButtons
            verb="Sign in"
            onSignedIn={() => router.push(routeAfterSignIn)}
          />

          <HStack w="full" alignItems="center">
            <Separator flex="1" />
            <Text fontSize="sm" color="gray.400" px={3} whiteSpace="nowrap" textTransform="uppercase" fontWeight="medium" letterSpacing="wide">or</Text>
            <Separator flex="1" />
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
                onKeyDown={(e) => e.key === "Enter" && onSubmit()}
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

            {/* OSF sign-in stays available through the wind-down, and ONLY
                here -- it is gone from the sign-up page, because no new
                account should be created against a platform that is closing.
                Researchers who signed up through OSF can still get in, which
                is what lets them link one of the providers above from the
                dashboard banner without losing their uid (and with it, their
                experiments). Remove this in the same release that removes the
                signup branch of functions/src/oauth2-callback.ts, not before. */}
            <SignInWithOSF />

            <VStack gap={2} w="full">
              <Link asChild fontSize="sm" color="brandOrange.300">
                <NextLink href="/reset-password">Forgot password?</NextLink>
              </Link>

              <Text fontSize="sm" color="gray.400">
                Need an account?{" "}
                <Link asChild color="brandOrange.300">
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
