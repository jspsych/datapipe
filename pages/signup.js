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
  FormHelperText,
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
    console.log("Starting signup process...");
    if (password.length < 12) {
      setErrorPassword("Password must be at least 12 characters");
      return;
    }

    setIsSubmitting(true);
    console.log("Creating user with email:", email);

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      console.log("User created successfully:", userCredential.user.uid);
      const user = userCredential.user;

      console.log("Creating user document in Firestore...");
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        uid: user.uid,
        osfToken: "",
        osfTokenValid: false,
        experiments: [],
        googleDriveEnabled: false,
        googleDriveFolderId: "",
        googleDriveRefreshToken: "",
        googleDriveAccessToken: "",
        googleDriveTokenExpiry: null,
      });
      console.log("User document created successfully");

      console.log("Redirecting to admin page...");
      router.push("/admin");
    } catch (error) {
      console.error("Signup error:", error);
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
    <VStack w={["100%", 660]} spacing={8}>
      <Card w={360}>
        <CardHeader>
          <Heading size="lg">Sign Up</Heading>
        </CardHeader>
        <CardBody>
          <Stack as="form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
            <FormControl id="email" isInvalid={errorEmail}>
              <FormLabel>Email</FormLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrorEmail("");
                }}
                required
              />
              <FormErrorMessage>{errorEmail}</FormErrorMessage>
            </FormControl>
            <FormControl id="password" pb={4} isInvalid={errorPassword}>
              <FormLabel>Password</FormLabel>
              <Input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorPassword("");
                }}
                required
              />
              <FormHelperText display={errorPassword === "" ? "block" : "none"}>
                Password must be at least 12 characters
              </FormHelperText>
              <FormErrorMessage>{errorPassword}</FormErrorMessage>
            </FormControl>
            <Text>&nbsp;</Text>
            <Button
              type="submit"
              colorScheme={"brandTeal"}
              isLoading={isSubmitting}
            >
              Create Account
            </Button>
            <Text pt={4}>
              Have an account?{" "}
              <ChakraLink as={Link} href="/signin">
                Sign In!
              </ChakraLink>
            </Text>
          </Stack>
        </CardBody>
      </Card>
    </VStack>
  );
}
