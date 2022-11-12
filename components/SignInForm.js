import { Button, Input, Text, Link as ChakraLink, InputGroup, InputLeftAddon, Stack, Heading, FormControl, FormLabel, FormHelperText } from "@chakra-ui/react";
import { auth } from "../lib/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import Router from "next/router";
import { useState } from "react";
import Link from "next/link";

export default function SignInForm({routeAfterSignIn}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  return(
    <Stack>
      <Heading pb={2}>Sign In</Heading>
      <FormControl id="email">
        <FormLabel>Email</FormLabel>
        <Input type="email" />
      </FormControl>
      <FormControl id="password" pb={4}>
        <FormLabel>Password</FormLabel>
        <Input type="password" />
        <FormHelperText><Link href="/reset-password" passHref><ChakraLink>Forgot password?</ChakraLink></Link></FormHelperText>
      </FormControl>
      <Button onClick={()=>handleSignInButton(setIsSubmitting)} isLoading={isSubmitting}>Sign In</Button>
      <Text pt={4}>Need an account? <Link href="/signup" passHref><ChakraLink>Sign up</ChakraLink></Link></Text>
    </Stack>
  )
}

async function handleSignInButton(setIsSubmitting) {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  setIsSubmitting(true);

  try{
    const user = await signInWithEmailAndPassword(auth, email, password);
    Router.push(routeAfterSignIn);
  } catch(error) {
    setIsSubmitting(false);
    console.log("Sign in failed");
    console.log(error);
  }
    
}
