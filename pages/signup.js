import { createUserWithEmailAndPassword } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/router";
import { auth } from "../lib/firebase";
import { ensureUserDocument } from "../lib/user-bootstrap";

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
} from "@chakra-ui/react";
import { messageForAuthError } from "../lib/auth-errors";
import AuthProviderButtons from "../components/auth/AuthProviderButtons";
import FormErrorAlert from "../components/ui/FormErrorAlert";

function fieldErrorsFor(email, password) {
  return {
    email: email.trim() ? "" : "Enter your email address.",
    password:
      password.length >= 12
        ? ""
        : "Password must be at least 12 characters.",
  };
}

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });
  const [touched, setTouched] = useState({ email: false, password: false });
  // Unlike the field errors above, this one isn't shaped like a single
  // field's problem -- an email collision (via our own OSF pre-check or via
  // Firebase's own auth/email-already-in-use) is a whole-form situation with
  // its own next step, so it renders as a banner with an inline link rather
  // than text under the Email field.
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    const errors = fieldErrorsFor(email, password);
    setFieldErrors(errors);
    setTouched({ email: true, password: true });
    if (errors.email || errors.password) return;

    setIsSubmitting(true);

    try {
      // Check if this email is already used by an OAuth user
      const checkResponse = await fetch("/api/checkemailconflict", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      if (checkResponse.ok) {
        const checkResult = await checkResponse.json();
        if (checkResult.conflict) {
          setFormError(
            <>
              This email is already registered through OSF sign-in.{" "}
              <ChakraLink
                asChild
                color="brandGreen.fg"
                textDecoration="underline"
              >
                <Link href="/signin">Sign in with OSF instead</Link>
              </ChakraLink>
              .
            </>
          );
          setIsSubmitting(false);
          return;
        }
      } else {
        // The pre-check is a courtesy for a friendlier message, not the
        // safety net -- Firebase itself refuses a duplicate email below, and
        // that path is now handled just as gracefully. So a down check
        // doesn't need to block signup; it just means a less specific
        // message if a collision does turn out to exist.
        console.error(
          "checkemailconflict unavailable, continuing without it:",
          checkResponse.status
        );
      }

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;

      // Same slim shape as a federated first sign-in. The OSF token fields
      // this used to seed (osfToken/usingPersonalToken/refreshToken/...) are
      // dead weight on a new account: OSF is closed to new experiments, so
      // nothing will ever read them. Existing docs keep theirs untouched.
      await ensureUserDocument(user);

      router.push("/admin");
    } catch (error) {
      setIsSubmitting(false);
      const { code } = error;
      if (code === "auth/weak-password") {
        setFieldErrors((prev) => ({
          ...prev,
          password: messageForAuthError(code, null, "signUp"),
        }));
      } else if (code === "auth/invalid-email") {
        setFieldErrors((prev) => ({
          ...prev,
          email: messageForAuthError(code, null, "signUp"),
        }));
      } else if (code === "auth/email-already-in-use") {
        setFormError(
          <>
            {messageForAuthError(code, "a password", "signUp")}{" "}
            <ChakraLink
              asChild
              color="brandGreen.fg"
              textDecoration="underline"
            >
              <Link href="/signin">Go to sign in</Link>
            </ChakraLink>
          </>
        );
      } else {
        setFormError(messageForAuthError(code, null, "signUp"));
      }
    }
  };

  return (
    <Card.Root
      w="100%"
      maxW="560px"
      mx="auto"
      // No px here: this Card.Root padding sat INSIDE the card border and
      // added to Card.Body's p={8}, making the card 48px horizontally and
      // 32px vertically. The page gutter belongs to _app.js.
      variant="unstyled"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      rounded="lg"
    >
      <Card.Body p={8}>
        <VStack gap={6} as="form" onSubmit={onSubmit} noValidate>
          <VStack gap={2} textAlign="center">
            <Heading as="h1" fontSize="2xl" fontWeight="700" color="fg">
              Create an account
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              Create an account to start sending data to your own repository.
              Already have one?{" "}
              <ChakraLink
                asChild
                color="brandGreen.fg"
                textDecoration="underline"
              >
                <Link href="/signin">Sign in</Link>
              </ChakraLink>
              .
            </Text>
          </VStack>

          <AuthProviderButtons
            verb="Sign up"
            onSignedIn={() => router.push("/admin")}
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
                  setFormError(null);
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
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, password: "" }));
                  setFormError(null);
                }}
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, password: true }))
                }
              />
              {!fieldErrors.password && (
                <Field.HelperText>
                  Password must be at least 12 characters.
                </Field.HelperText>
              )}
              <Field.ErrorText>{fieldErrors.password}</Field.ErrorText>
            </Field.Root>

            {/* mt={2} against the stack's gap={4}: the submit is the end of
                the form, not another field in it. */}
            <Button
              type="submit"
              colorPalette="brandGreen"
              loading={isSubmitting}
              loadingText="Creating account…"
              w="full"
              size="lg"
              mt={2}
            >
              Create account
            </Button>
          </VStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
