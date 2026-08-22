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
import { messageForAuthError } from "../lib/auth-errors";
import AuthProviderButtons from "./auth/AuthProviderButtons";
import SignInWithOSF from "./SignInWithOSF";
import FormErrorAlert from "./ui/FormErrorAlert";

function fieldErrorsFor(email, password) {
  return {
    email: email.trim() ? "" : "Enter your email address.",
    password: password ? "" : "Enter your password.",
  };
}

export default function SignInForm({ routeAfterSignIn }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });
  const [touched, setTouched] = useState({ email: false, password: false });
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");

    const errors = fieldErrorsFor(email, password);
    setFieldErrors(errors);
    setTouched({ email: true, password: true });
    if (errors.email || errors.password) return;

    setIsSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push(routeAfterSignIn);
    } catch (error) {
      setIsSubmitting(false);
      const { code } = error;
      if (code === "auth/invalid-email") {
        // The one code from this call that really is about the shape of the
        // email field rather than the credential pair -- safe to attribute.
        setFieldErrors((prev) => ({
          ...prev,
          email: messageForAuthError(code, null, "password"),
        }));
      } else {
        // auth/invalid-credential (modern Firebase with email enumeration
        // protection on) and auth/wrong-password / auth/user-not-found
        // (protection off, or an older SDK) all mean "this email+password
        // pair doesn't match" and are indistinguishable from here.
        // Attributing the error to one field would be a guess -- and, worse,
        // exactly the account-existence confirmation enumeration protection
        // exists to prevent. Shown at the credentials level instead.
        setFormError(messageForAuthError(code, null, "password"));
      }
    }
  };

  return (
    <Card.Root
      w="100%"
      maxW="560px"
      mx="auto"
      px={4}
      variant="unstyled"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      rounded="lg"
    >
      <Card.Body p={8}>
        <VStack gap={6} as="form" onSubmit={handleSubmit} noValidate>
          <VStack gap={1} textAlign="center">
            <Heading as="h1" fontSize="2xl" fontWeight="700" color="fg">
              Sign in
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              Sign in to manage your experiments. New here?{" "}
              <Link asChild color="brandGreen.fg" textDecoration="underline">
                <NextLink href="/signup">Create an account</NextLink>
              </Link>
              .
            </Text>
          </VStack>

          <AuthProviderButtons
            verb="Sign in"
            onSignedIn={() => router.push(routeAfterSignIn)}
          />

          <HStack w="full" alignItems="center">
            <Separator flex="1" />
            <Text fontSize="sm" color="fg.muted" px={3} whiteSpace="nowrap">
              or
            </Text>
            <Separator flex="1" />
          </HStack>

          <FormErrorAlert>{formError}</FormErrorAlert>

          <VStack gap={4} w="full">
            <Field.Root invalid={touched.email && !!fieldErrors.email}>
              <Field.Label>Email</Field.Label>
              <Input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, email: "" }));
                  setFormError("");
                }}
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, email: true }))
                }
              />
              <Field.ErrorText>{fieldErrors.email}</Field.ErrorText>
            </Field.Root>

            <Field.Root invalid={touched.password && !!fieldErrors.password}>
              <Field.Label>Password</Field.Label>
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, password: "" }));
                  setFormError("");
                }}
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, password: true }))
                }
              />
              <Field.ErrorText>{fieldErrors.password}</Field.ErrorText>
            </Field.Root>

            <Button
              type="submit"
              colorPalette="brandGreen"
              loading={isSubmitting}
              loadingText="Signing in…"
              w="full"
              size="lg"
            >
              Sign in
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

            <Link
              asChild
              fontSize="sm"
              color="brandGreen.fg"
              textDecoration="underline"
            >
              <NextLink href="/reset-password">Forgot password?</NextLink>
            </Link>
          </VStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
