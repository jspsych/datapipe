import { useState, useContext, useEffect } from "react";
import { UserContext } from "../../lib/context";

import { FormErrorMessage, useDisclosure } from "@chakra-ui/react";
import {
  HStack,
  VStack,
  Button,
  Text,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  FormControl,
  FormLabel,
  Input
} from "@chakra-ui/react";

import { auth } from "../../lib/firebase";
import { updatePassword } from "firebase/auth";

export default function ChangePassword() {
  const { user } = useContext(UserContext);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMatch, setPasswordMatch] = useState(true);

  useEffect(() => {
    if (password !== confirmPassword) {
      setPasswordMatch(false);
    } else {
      setPasswordMatch(true);
    }
  }, [password, confirmPassword]);


  return (
    <HStack justifyContent="space-between">
      <Text>Password</Text>
      <Button isLoading={isSubmitting} onClick={onOpen} colorScheme="brandTeal">
        Change Password
      </Button>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent bg="greyBackground">
          <ModalHeader>Change Password</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4}>
            <FormControl id="new-password">
              <FormLabel>New Password</FormLabel>
              <Input type="password" value={password} onChange={(e)=>setPassword(e.target.value)}/>
            </FormControl>
            <FormControl id="confirm-password" isInvalid={!passwordMatch}>
              <FormLabel>Confirm Password</FormLabel>
              <Input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} />
              <FormErrorMessage>Passwords do not match</FormErrorMessage>
            </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant={"solid"}
              colorScheme={"brandTeal"}
              size={"md"}
              mr={4}
              onClick={() => handleChangePassword(setIsSubmitting)}
              isLoading={isSubmitting}
              isDisabled={!passwordMatch || password.length < 6}
            >
              Change Password
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </HStack>
  );
}

async function handleChangePassword(setIsSubmitting) {
  setIsSubmitting(true);
  const user = auth.currentUser;
  const newPassword = document.querySelector("#new-password").value;
  try {
    await updatePassword(user, newPassword);
    setIsSubmitting(false);
  } catch (error) {
    console.log(error);
  }
}
