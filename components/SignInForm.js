import { Button, Input, InputGroup, InputLeftAddon, Stack, Heading, FormControl, FormLabel } from "@chakra-ui/react";
import { auth } from "../lib/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";

export default function SignInForm({afterSignIn}) {
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

function handleSignInButton() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  signInWithEmailAndPassword(auth, email, password)
    .then((userCredential) => {
      // Signed in
      const user = userCredential.user;
      // ...
    })
    .catch((error) => {
      const errorCode = error.code;
      const errorMessage = error.message;
    });
}
