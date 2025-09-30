import {
  Button,
  Card,
  CardBody,
  Input,
  Text,
  Link,
  Heading,
  FormControl,
  FormLabel,
  FormErrorMessage,
  VStack,
  HStack,
  Divider,
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
    <Card w={400} mx="auto">
      <CardBody p={8}>
        <VStack spacing={6}>
          <Heading size="lg" textAlign="center">Sign In</Heading>
          
          <SignInWithOSF />

          <HStack w="full">
            <Divider />
            <Text fontSize="sm" color="gray.500" px={3}>or</Text>
            <Divider />
          </HStack>

          <VStack spacing={4} w="full">
            <FormControl isInvalid={errorEmail}>
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
            
            <FormControl isInvalid={errorPassword}>
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

            <Button
              colorScheme="brandTeal"
              isLoading={isSubmitting}
              onClick={onSubmit}
              w="full"
              size="lg"
            >
              Sign In
            </Button>

            <VStack spacing={2} w="full">
              <Link as={NextLink} href="/reset-password" fontSize="sm" color="blue.500">
                Forgot password?
              </Link>
              
              <Text fontSize="sm" color="gray.600">
                Need an account?{" "}
                <Link as={NextLink} href="/signup" color="blue.500">
                  Sign Up
                </Link>
              </Text>
            </VStack>
          </VStack>
        </VStack>
      </CardBody>
    </Card>
  );
}
