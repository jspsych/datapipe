import { useState } from "react";

import { HStack, VStack, Button, Text } from "@chakra-ui/react";

import { auth } from "../../lib/firebase";

import { useRouter } from "next/router";
import ConfirmDialog from "../ui/ConfirmDialog";

// Deletion runs server-side (functions/src/delete-account.ts) rather than
// through deleteUser() here. The client SDK can only delete the auth record,
// and it is the auth record that has to go LAST: the researcher's experiments,
// queued uploads, pending submissions and stored provider credentials all key
// off the uid, and destroying the account first means a failed cleanup strands
// them with no owner and no way to sign back in and retry.
export default function DeleteAccount({ setDeleting }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const deleteAccount = async function () {
    // `setDeleting(true)` has to land before the request can possibly fail
    // or succeed. AccountPage passes `deleting` straight into AuthCheck's
    // fallbackRoute, so a sign-out that lands mid-request -- ours below on
    // success, or an unrelated one -- resolves to the "your account is gone"
    // page instead of dumping the researcher back at the sign-in form.
    setDeleting(true);
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
      // Not deleted after all -- undo the redirect-on-signout wiring above so
      // an unrelated sign-out (or none at all) leaves the researcher on this
      // page, where ConfirmDialog now shows `error` and keeps the dialog open.
      setDeleting(false);
      throw error;
    }
  };

  return (
    <VStack w="100%" align="stretch" gap={3}>
      <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
        <Text fontSize={"lg"}>Delete DataPipe Account</Text>
        <Button onClick={() => setOpen(true)} colorPalette="red">
          Delete Account
        </Button>

        <ConfirmDialog
          open={open}
          onOpenChange={(e) => setOpen(e.open)}
          title="Delete Account"
          confirmLabel="Delete"
          destructive
          onConfirm={deleteAccount}
        >
          <Text mb={4}>
            Are you sure? This action is final. We cannot recover any
            experiments that are associated with this account after
            deletion.
          </Text>
          <Text>
            Deleting your DataPipe account will not affect any data
            already written to your storage provider.
          </Text>
        </ConfirmDialog>
      </HStack>
    </VStack>
  );
}
