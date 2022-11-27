import { Button, Card, CardBody, CardHeader, Input, Text, Link as ChakraLink, Stack, Heading, FormControl, FormLabel, FormErrorMessage } from "@chakra-ui/react";
import { auth } from "../lib/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import Router from "next/router";
import { useState } from "react";
import Link from "next/link";

export default function SignInForm({routeAfterSignIn}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invalidEmail, setInvalidEmail] = useState(false);
  const [invalidPassword, setInvalidPassword] = useState(false);
  return(
    <Card w={360}>
      <CardHeader>
        <Heading size='lg'>Sign In</Heading>
      </CardHeader>
      <CardBody>
        <Stack>
          <FormControl id="email" isInvalid={invalidEmail}>
            <FormLabel>Email</FormLabel>
            <Input type="email" />
            <FormErrorMessage>Invalid email</FormErrorMessage>
          </FormControl>
          <FormControl id="password" pb={4} isInvalid={invalidPassword}>
            <FormLabel>Password</FormLabel>
            <Input type="password" onChange={()=>setInvalidPassword(false)}/>
            <FormErrorMessage>Invalid password</FormErrorMessage>
          </FormControl>
          <Text>
            <Link href="/reset-password" passHref><ChakraLink>Forgot password?</ChakraLink></Link>
          </Text>
          <Button
            colorScheme={"green"}
            isLoading={isSubmitting}
            onClick={()=>handleSignInButton(setIsSubmitting, setInvalidEmail, setInvalidPassword, routeAfterSignIn)}>
            Sign In
          </Button>
          <Text pt={4}>Need an account? <Link href="/signup" passHref><ChakraLink>Sign Up!</ChakraLink></Link></Text>
        </Stack>
      </CardBody>
    </Card>
  )
}

async function handleSignInButton(setIsSubmitting, setInvalidEmail, setInvalidPassword, routeAfterSignIn) {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  setIsSubmitting(true);

  try{
    const user = await signInWithEmailAndPassword(auth, email, password);
    Router.push(routeAfterSignIn);
  } catch(error) {
    setIsSubmitting(false);
    if(error.code == "auth/user-not-found") {
      setInvalidEmail(true);
    }
    if(error.code == "auth/wrong-password") {
      setInvalidPassword(true);
    }
    console.log("Sign in failed");
    console.log(error);
  }
    
}
