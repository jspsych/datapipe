import {
  Card,
  Stack,
  Heading,
  Text,
  Field,
  Input,
  Button,
} from "@chakra-ui/react";

import { auth } from "../lib/firebase";
import { sendPasswordResetEmail, confirmPasswordReset } from "firebase/auth";

import { useState } from "react";
import { useRouter } from "next/router";
import { getError } from "../lib/utils";

export default function ResetPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Only the transition this page drives itself: "send", after a reset email
  // goes out. null means "whatever the URL says".
  const [submittedState, setSubmittedState] = useState(null);

  // Derived from the URL rather than copied into state by an effect. The old
  // version rendered the "forgot password" form first and swapped to the
  // token form once the effect ran, so a user arriving from a reset link saw
  // the wrong form flash by -- and on Next's first client render, where
  // router.query is still empty, it was the only form they saw until the
  // query populated.
  const token = typeof router.query?.token === "string" ? router.query.token : "";
  const state = submittedState ?? (token ? "token" : "forgot");

  const resetPassword = async () => {
    setIsSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setIsSubmitting(false);
      setSubmittedState("send");
    } catch (error) {
      setIsSubmitting(false);
      setError(getError(error.code));
    }
  };

  const setNewPassword = async () => {
    if (password.length < 12) {
      setError("Password must be at least 12 characters");
      return;
    }
    setIsSubmitting(true);
    try {
      await confirmPasswordReset(auth, token, password);
      router.push("/admin");
    } catch (error) {
      setError(getError(error.code));
      setIsSubmitting(false);
    }
  };

  return (
    <Card.Root w="100%" maxW={360} mx="auto" px={4} variant="unstyled" color="white">
      <Card.Header>
        <Heading size="lg">Reset your password</Heading>
      </Card.Header>
      <Card.Body>
        <Stack>
          {state === "send" && (
            <Text>We have sent you a link to reset your password.</Text>
          )}
          {state === "forgot" && (
            <>
              <Field.Root invalid={!!error}>
                <Field.Label>Email</Field.Label>
                <Input
                  type="email"
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError("");
                  }}
                />
                <Field.ErrorText>{error}</Field.ErrorText>
              </Field.Root>
              <Text>
                Enter your email and we will send you a link to reset your
                password.
              </Text>
              <Button
                colorPalette={"brandGreen"}
                loading={isSubmitting}
                onClick={resetPassword}
              >
                Request Reset
              </Button>
            </>
          )}
          {state === "token" && (
            <>
              <Field.Root invalid={!!error}>
                <Field.Label>New Password</Field.Label>
                <Input
                  type="password"
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                />
                <Field.HelperText display={error === "" ? "block" : "none"}>
                  Password must be at least 12 characters
                </Field.HelperText>
                <Field.ErrorText>{error}</Field.ErrorText>
              </Field.Root>
              <Button
                colorPalette={"brandGreen"}
                loading={isSubmitting}
                onClick={setNewPassword}
              >
                Set New Password
              </Button>
            </>
          )}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
