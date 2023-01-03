import { useState, useContext, useEffect } from "react";
import { UserContext } from "../../lib/context";

import { useDisclosure } from "@chakra-ui/react";
import {
  HStack,
  VStack,
  Button,
  Text,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
} from "@chakra-ui/react";

import { auth } from "../../lib/firebase";
import { deleteUser } from "firebase/auth";

import { useRef } from "react";

import { useRouter } from "next/router";

export default function DeleteAccount({ setDeleting }) {
  const { user } = useContext(UserContext);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef();
  const router = useRouter();

  const deleteAccount = async function () {
    try {
      await deleteUser(auth.currentUser);
      router.push("/admin/deleted-account");
    } catch (error) {
      setDeleting(false);
      console.log(error);
    }
  };

  return (
    <HStack justifyContent="space-between" w="100%">
      <Text fontSize={"lg"}>Delete Account</Text>
      <Button isLoading={isSubmitting} onClick={onOpen} colorScheme="red">
        Delete Account
      </Button>
      <AlertDialog
        isOpen={isOpen}
        leastDestructiveRef={cancelRef}
        onClose={onClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent bg="greyBackground">
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete Account
            </AlertDialogHeader>

            <AlertDialogBody>
              <Text mb={4}>
                Are you sure? This action is final. We cannot recover any
                experiments that are associated with this account after
                deletion.
              </Text>
              <Text>
                Deleting your DataPipe account will not affect any data on the
                OSF.
              </Text>
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onClose} colorScheme="brandTeal">
                Cancel
              </Button>
              <Button
                colorScheme="red"
                onClick={() => {
                  setDeleting(true);
                  onClose();
                  deleteAccount();
                }}
                ml={3}
              >
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </HStack>
  );
}
