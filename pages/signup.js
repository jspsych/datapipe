import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

import { auth, db } from "../lib/firebase";

import Router from "next/router";

import { FormControl, Stack, Spinner, Input, InputGroup, InputLeftAddon, Checkbox, FormLabel, Button } from '@chakra-ui/react';

export default function SignUpPage({}) {

  return (
    <Stack>
      <FormControl id="email">
        <FormLabel>Email</FormLabel>
        <Input type="email" />
      </FormControl>
      <FormControl id="password" pb={4}>
        <FormLabel>Password</FormLabel>
        <Input type="password" />
      </FormControl>
      <Button
        variant={"solid"}
        colorScheme={"green"}
        size={"md"}
        mr={4}
        onClick={handleCreateAccount}
      >
        Create Account
      </Button>
    </Stack>
  );
}

async function handleCreateAccount() {
  const email = document.querySelector('#email').value;
  const password = document.querySelector('#password').value;
  
  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user = userCredential.user;
    await setDoc(doc(db, "users", user.uid), {
      email: user.email,
      uid: user.uid,
      osfToken: "",
      osfTokenValid: false,
      experiments: []
    });

    Router.push("/admin")
  }
  catch (error) {
    console.log(error);
  }
}
