import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import Link from "next/link";

import { auth, db } from "../lib/firebase";

import Router from "next/router";
import { useState } from "react";

import { Card, CardBody, CardHeader, Heading, Link as ChakraLink, Text, FormControl, Stack, Input, FormLabel, Button, FormErrorMessage } from '@chakra-ui/react';

export default function SignUpPage({}) {

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invalidEmail, setInvalidEmail] = useState(false);
  const [invalidEmailType, setInvalidEmailType] = useState("");
  const [weakPassword, setWeakPassword] = useState(false);

  return (
    <Card w={360}>
      <CardHeader>
        <Heading size='lg'>Sign Up</Heading>
      </CardHeader>
      <CardBody>
        <Stack>
          <FormControl id="email" isInvalid={invalidEmail}>
            <FormLabel>Email</FormLabel>
            <Input type="email" onChange={()=>setInvalidEmail(false)}/>
            <FormErrorMessage>{invalidEmailType}</FormErrorMessage>
          </FormControl>
          <FormControl id="password" pb={4} isInvalid={weakPassword}>
            <FormLabel>Password</FormLabel>
            <Input type="password" onChange={()=>setWeakPassword(false)}/>
            <FormErrorMessage>Password must be at least 6 characters</FormErrorMessage>
          </FormControl>
          <Text>&nbsp;</Text>
          <Button
            variant={"solid"}
            colorScheme={"green"}
            size={"md"}
            mr={4}
            onClick={()=>handleCreateAccount(setIsSubmitting, setInvalidEmail, setInvalidEmailType, setWeakPassword)}
            isLoading={isSubmitting}>
            Create Account
          </Button>
          <Text pt={4}>Have an account? <Link href="/signin" passHref><ChakraLink>Sign In!</ChakraLink></Link></Text>
        </Stack>
      </CardBody>
    </Card>
  );
}

async function handleCreateAccount(setIsSubmitting, setInvalidEmail, setInvalidEmailType, setWeakPassword) {
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
      setInvalidEmail(true);
      setInvalidEmailType("Email already in use");
    }
    if(error.code == "auth/weak-password") {
      setWeakPassword(true);
    }
    if(error.code == "auth/invalid-email") {
      setInvalidEmail(true);
      setInvalidEmailType("Invalid email");
    }
    setIsSubmitting(false);
    console.log(error);
  }
}
