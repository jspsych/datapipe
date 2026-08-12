import { useState } from "react";

import {
  HStack,
  VStack,
  Button,
  Text,
  Alert,
  Dialog,
} from "@chakra-ui/react";

import { auth } from "../../lib/firebase";

import { useRouter } from "next/router";

// Deletion runs server-side (functions/src/delete-account.ts) rather than
// through deleteUser() here. The client SDK can only delete the auth record,
// and it is the auth record that has to go LAST: the researcher's experiments,
// queued uploads, pending submissions and stored provider credentials all key
// off the uid, and destroying the account first means a failed cleanup strands
// them with no owner and no way to sign back in and retry.
export default function DeleteAccount({ setDeleting }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const router = useRouter();

  const deleteAccount = async function () {
    setIsSubmitting(true);
    try {
      // Not forced: a refreshed token carries the same auth_time, so it would
      // not get past the endpoint's recent-login check anyway.
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/deleteaccount", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.code === "requires-recent-login"
            ? "For security, sign out and sign back in, then delete your account."
            : body.error ||
              "Could not delete your account. Nothing was lost -- please try again."
        );
      }

      // The auth record is gone; drop the local session so the app does not
      // keep acting on a user that no longer exists.
      await auth.signOut().catch(() => {});
      router.push("/admin/deleted-account");
    } catch (error) {
      setDeleting(false);
      setIsSubmitting(false);
      setDeleteError(error.message);
    }
  };

  return (
    <VStack w="100%" align="stretch" gap={3}>
      {deleteError && (
        <Alert.Root status="error" borderRadius="md">
          <Alert.Indicator />
          <Text fontSize="sm">{deleteError}</Text>
        </Alert.Root>
      )}

      <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
        <Text fontSize={"lg"}>Delete DataPipe Account</Text>
        <Button
          loading={isSubmitting}
          onClick={() => setOpen(true)}
          colorPalette="red"
        >
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
                  Deleting your DataPipe account will not affect any data
                  already written to your storage provider.
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
                    setDeleteError(null);
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
    </VStack>
  );
}
