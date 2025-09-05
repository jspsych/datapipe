import AuthCheck from "../../components/AuthCheck";
import { VStack, Heading } from "@chakra-ui/react";
import ChangePassword from "../../components/account/ChangePassword";
import OSFToken from "../../components/account/OSFToken";
import DeleteAccount from "../../components/account/DeleteAccount";
import { useState, useContext } from "react";
import SelectAuth from "../../components/account/SelectAuth";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import OneClickAuth from "../../components/account/OneClickAuth";

export default function AccountPage({}) {
  const { user } = useContext(UserContext);

  const [data, loading, error, snapshot, reload] = useDocumentData(
      user?.uid ? doc(db, "users", user.uid) : null
  );

  const [deleting, setDeleting] = useState(false);

  if (loading) {
    return <div>Loading...</div>; 
  }

  return (
    <AuthCheck fallbackRoute={deleting ? "/admin/deleted-account" : null}>
      <VStack spacing={8} w="560px">
        <Heading>Account Settings</Heading>
        <SelectAuth />
        {!loading && !error && data?.usingPersonalToken && (
          <OSFToken />
        )}
        {!loading && !error && !data?.usingPersonalToken && (
          <OneClickAuth />
        )}
        <ChangePassword />
        <DeleteAccount setDeleting={setDeleting} />
      </VStack>
    </AuthCheck>
  );
}
