import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

import { auth, db } from "../lib/firebase";

import Router from "next/router";
import { useState } from "react";

import { FormControl, Stack, Spinner, Input, InputGroup, InputLeftAddon, Checkbox, FormLabel, Button, FormErrorMessage } from '@chakra-ui/react';

export default function SignUpPage({}) {

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invalidEmail, setInvalidEmail] = useState(false);
  const [weakPassword, setWeakPassword] = useState(false);

  return (
    <Stack>
      <FormControl id="email" isInvalid={invalidEmail}>
        <FormLabel>Email</FormLabel>
        <Input type="email" onChange={()=>setInvalidEmail(false)}/>
        <FormErrorMessage>Invalid email</FormErrorMessage>
      </FormControl>
      <FormControl id="password" pb={4} isInvalid={weakPassword}>
        <FormLabel>Password</FormLabel>
        <Input type="password" onChange={()=>setWeakPassword(false)}/>
        <FormErrorMessage>Password must be at least 6 characters</FormErrorMessage>
      </FormControl>
      <Button
        variant={"solid"}
        colorScheme={"green"}
        size={"md"}
        mr={4}
        onClick={()=>handleCreateAccount(setIsSubmitting, setInvalidEmail, setWeakPassword)}
        isLoading={isSubmitting}
      >
        Create Account
      </Button>
    </Stack>
  );
}

async function handleCreateAccount(setIsSubmitting, setInvalidEmail, setWeakPassword) {
  const email = document.querySelector('#email').value;
  const password = document.querySelector('#password').value;

  setIsSubmitting(true);
  
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
    if(error.code == "auth/email-already-in-use") {
      // do something.
    }
    if(error.code == "auth/weak-password") {
      setWeakPassword(true);
    }
    if(error.code == "auth/invalid-email") {
      setInvalidEmail(true);
    }
    setIsSubmitting(false);
    console.log(error);
  }
}
