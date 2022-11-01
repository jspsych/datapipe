import { Button, Input, InputGroup, InputLeftAddon, Stack, Heading, FormControl, FormLabel } from "@chakra-ui/react";
import { auth } from "../lib/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import Router from "next/router";

export default function SignInForm({routeAfterSignIn}) {
  return(
    <Stack>
      <Heading>Sign In</Heading>
      <FormControl id="email">
        <FormLabel>Email</FormLabel>
        <Input type="email" />
      </FormControl>
      <FormControl id="password">
        <FormLabel>Password</FormLabel>
        <Input type="password" />
      </FormControl>
      <Button onClick={handleSignInButton}>Sign In</Button>
    </Stack>
  )
}

async function handleSignInButton() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try{
    const user = await signInWithEmailAndPassword(auth, email, password);
    Router.push(routeAfterSignIn);
  } catch(error) {
    console.log("Sign in failed");
    console.log(error);
  }
    
}
