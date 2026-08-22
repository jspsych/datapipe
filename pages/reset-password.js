import {
  Card,
  Heading,
  Text,
  Field,
  Input,
  Button,
  Link as ChakraLink,
  VStack,
} from "@chakra-ui/react";

import { auth } from "../lib/firebase";
import { sendPasswordResetEmail, confirmPasswordReset } from "firebase/auth";

import { useState } from "react";
import { useRouter } from "next/router";
import NextLink from "next/link";
import { messageForAuthError, isExpiredResetLink } from "../lib/auth-errors";
import FormErrorAlert from "../components/ui/FormErrorAlert";

export default function ResetPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailFieldError, setEmailFieldError] = useState("");
  const [passwordFieldError, setPasswordFieldError] = useState("");
  const [formError, setFormError] = useState("");
  // Set only when a "token" attempt fails because the link expired or was
  // already used -- shown once, on top of the "forgot" form this bounces
  // back to, so the researcher knows *why* they are back at square one.
  const [notice, setNotice] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState("");
  // Only the transition this page drives itself: "send", after a reset email
  // goes out, or "forgot", when an expired-token attempt bounces back here.
  // null means "whatever the URL says".
  const [submittedState, setSubmittedState] = useState(null);

  // Derived from the URL rather than copied into state by an effect. The old
  // version rendered the "forgot password" form first and swapped to the
  // token form once the effect ran, so a user arriving from a reset link saw
  // the wrong form flash by -- and on Next's first client render, where
  // router.query is still empty, it was the only form they saw until the
  // query populated.
  const token = typeof router.query?.token === "string" ? router.query.token : "";
  const state = submittedState ?? (token ? "token" : "forgot");

  const requestReset = async (e) => {
    e.preventDefault();
    setFormError("");

    if (!email.trim()) {
      setEmailFieldError("Enter your email address.");
      setTouched((prev) => ({ ...prev, email: true }));
      return;
    }

    setIsSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setSentTo(email);
      setIsSubmitting(false);
      setSubmittedState("send");
    } catch (error) {
      setIsSubmitting(false);
      const { code } = error;
      if (code === "auth/user-not-found") {
        // Same neutral outcome as success. Confirming that an email has NO
        // account is exactly the enumeration leak this branch exists to
        // avoid -- a researcher who mistyped their address sees the same
        // "check your inbox" screen as one who got it right.
        setSentTo(email);
        setSubmittedState("send");
      } else if (code === "auth/invalid-email") {
        setEmailFieldError(messageForAuthError(code, null, "resetRequest"));
      } else {
        setFormError(messageForAuthError(code, null, "resetRequest"));
      }
    }
  };

  const resendReset = () => {
    setSubmittedState(null);
    setNotice("");
    setFormError("");
    setEmailFieldError("");
    setTouched({ email: false, password: false });
  };

  const setNewPassword = async (e) => {
    e.preventDefault();
    setFormError("");

    if (password.length < 12) {
      setPasswordFieldError("Password must be at least 12 characters.");
      setTouched((prev) => ({ ...prev, password: true }));
      return;
    }

    setIsSubmitting(true);
    try {
      await confirmPasswordReset(auth, token, password);
      router.push("/admin");
    } catch (error) {
      setIsSubmitting(false);
      const { code } = error;
      if (isExpiredResetLink(code)) {
        // Dead end, fixed: bounce back to "forgot" instead of leaving the
        // researcher on a form with no way to get a new link.
        setSubmittedState("forgot");
        setNotice(
          "That reset link has expired or was already used. Enter your email and we'll send a new one."
        );
      } else if (code === "auth/weak-password") {
        setPasswordFieldError(messageForAuthError(code, null, "resetConfirm"));
      } else {
        setFormError(messageForAuthError(code, null, "resetConfirm"));
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
        <VStack gap={6} align="stretch">
          <Heading as="h1" fontSize="2xl" fontWeight="700" color="fg">
            Reset your password
          </Heading>

          {state === "send" && (
            <VStack gap={4} align="start">
              <Text color="fg">
                We sent a reset link to{" "}
                <Text as="span" fontWeight="600">
                  {sentTo}
                </Text>
                . It expires in one hour. Check your spam folder if it hasn't
                arrived.
              </Text>
              <Button
                type="button"
                variant="outline"
                colorPalette="gray"
                onClick={resendReset}
              >
                Send it again
              </Button>
              <ChakraLink
                asChild
                fontSize="sm"
                color="brandGreen.fg"
                textDecoration="underline"
              >
                <NextLink href="/signin">Back to sign in</NextLink>
              </ChakraLink>
            </VStack>
          )}

          {state === "forgot" && (
            <VStack as="form" onSubmit={requestReset} gap={4} align="stretch" noValidate>
              <Text fontSize="sm" color="fg.muted">
                Enter your email and we'll send you a link to reset your
                password.
              </Text>

              <FormErrorAlert>{notice}</FormErrorAlert>
              <FormErrorAlert>{formError}</FormErrorAlert>

              <Field.Root invalid={touched.email && !!emailFieldError}>
                <Field.Label>Email</Field.Label>
                <Input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailFieldError("");
                    setFormError("");
                  }}
                  onBlur={() =>
                    setTouched((prev) => ({ ...prev, email: true }))
                  }
                />
                <Field.ErrorText>{emailFieldError}</Field.ErrorText>
              </Field.Root>

              <Button
                type="submit"
                colorPalette="brandGreen"
                loading={isSubmitting}
                loadingText="Sending link…"
              >
                Send reset link
              </Button>

              <ChakraLink
                asChild
                fontSize="sm"
                color="brandGreen.fg"
                textDecoration="underline"
              >
                <NextLink href="/signin">Back to sign in</NextLink>
              </ChakraLink>
            </VStack>
          )}

          {state === "token" && (
            <VStack as="form" onSubmit={setNewPassword} gap={4} align="stretch" noValidate>
              <FormErrorAlert>{formError}</FormErrorAlert>

              <Field.Root invalid={touched.password && !!passwordFieldError}>
                <Field.Label>New password</Field.Label>
                <Input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordFieldError("");
                    setFormError("");
                  }}
                  onBlur={() =>
                    setTouched((prev) => ({ ...prev, password: true }))
                  }
                />
                {!passwordFieldError && (
                  <Field.HelperText>
                    Password must be at least 12 characters.
                  </Field.HelperText>
                )}
                <Field.ErrorText>{passwordFieldError}</Field.ErrorText>
              </Field.Root>

              <Button
                type="submit"
                colorPalette="brandGreen"
                loading={isSubmitting}
                loadingText="Setting password…"
              >
                Set new password
              </Button>
            </VStack>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
