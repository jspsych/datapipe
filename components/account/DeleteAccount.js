import { useState, useContext } from "react";
import { UserContext } from "../../lib/context";

import {
  HStack,
  Button,
  Text,
  Dialog,
} from "@chakra-ui/react";

import { auth } from "../../lib/firebase";
import { deleteUser } from "firebase/auth";

import { useRouter } from "next/router";

export default function DeleteAccount({ setDeleting }) {
  const { user } = useContext(UserContext);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
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
      <Text fontSize={"lg"}>Delete DataPipe Account</Text>
      <Button loading={isSubmitting} onClick={() => setOpen(true)} colorPalette="red">
        Delete Account
      </Button>
      <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="greyBackground" color="white">
            <Dialog.Header fontSize="lg" fontWeight="bold">
              Delete Account
            </Dialog.Header>

            <Dialog.Body>
              <Text mb={4}>
                Are you sure? This action is final. We cannot recover any
                experiments that are associated with this account after
                deletion.
              </Text>
              <Text>
                Deleting your DataPipe account will not affect any data on the
                OSF.
              </Text>
            </Dialog.Body>

            <Dialog.Footer>
              <Button onClick={() => setOpen(false)} colorPalette="brandTeal">
                Cancel
              </Button>
              <Button
                colorPalette="red"
                onClick={() => {
                  setDeleting(true);
                  setOpen(false);
                  deleteAccount();
                }}
                ml={3}
              >
                Delete
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </HStack>
  );
}
