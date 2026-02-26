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
  Input,
  Tooltip,
  Link,
} from "@chakra-ui/react";

import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";

import { db, auth } from "../../lib/firebase";
import { CheckCircleIcon, WarningIcon } from "@chakra-ui/icons";

export default function OSFToken() {
  const { user } = useContext(UserContext);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [data, loading, error, snapshot, reload] = useDocumentData(
    doc(db, "users", user.uid)
  );

  return (
    <HStack justifyContent="space-between" w="100%">
      <HStack>
        <Text fontSize={"lg"}>OSF Token</Text>
        {data && data.osfTokenValid ? (
          <Tooltip label="Valid OSF Token">
            <CheckCircleIcon color="brandTeal.500" />
          </Tooltip>
        ) : (
          <Tooltip label="Invalid OSF Token">
            <WarningIcon color="brandOrange.500" />
          </Tooltip>
        )}
      </HStack>
      <Button isLoading={isSubmitting} onClick={onOpen} colorScheme="brandTeal">
        Set OSF Token
      </Button>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent bg="greyBackground">
          <ModalHeader>Change OSF Token</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} w="100%">
              <Text>
                To generate an OSF token, go to{" "}
                <Link
                  color="brandOrange.100"
                  href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/settings/tokens/`}
                  isExternal
                >
                  https://osf.io/settings/tokens/
                </Link>{" "}
                and click &quot;Create Token&quot;.
              </Text>
              <Text>
                Select osf.full_write under scopes and click &quot;Create
                token&quot;. Copy the token and paste it below.
              </Text>

              {data && (
                <VStack spacing={4} w="100%">
                  <FormControl id="osf-token">
                    <FormLabel>OSF Token</FormLabel>
                    <Input type="text" placeholder="Paste your OSF token here" />
                  </FormControl>
                </VStack>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant={"solid"}
              colorScheme={"brandTeal"}
              size={"md"}
              mr={4}
              onClick={() => {
                handleSaveButton(setIsSubmitting, onClose);
              }}
              isLoading={isSubmitting}
            >
              Change Token
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </HStack>
  );
}

async function handleSaveButton(setIsSubmitting, closeHandler) {
  const token = document.querySelector("#osf-token").value;
  setIsSubmitting(true);
  try {
    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch("/api/saveosftoken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      throw new Error("Failed to save token");
    }
    setIsSubmitting(false);
    closeHandler();
  } catch (error) {
    setIsSubmitting(false);
    console.log(error);
  }
}
