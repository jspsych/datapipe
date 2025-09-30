import AuthCheck from "../../components/AuthCheck";
import { VStack, Heading } from "@chakra-ui/react";
import ChangePassword from "../../components/account/ChangePassword";

import DeleteAccount from "../../components/account/DeleteAccount";
import { useState, useContext } from "react";
import SelectAuth from "../../components/account/SelectAuth";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import OAuthTokenStatus from "../../components/account/OAuthTokenStatus";

export default function AccountPage({}) {
  const { user } = useContext(UserContext);

  const [data, loading, error, snapshot, reload] = useDocumentData(
      user?.uid ? doc(db, "users", user.uid) : null
  );

  const [deleting, setDeleting] = useState(false);

  if (loading) {
    return <div>Loading...</div>; 
  }

  // Determine user type: OAuth users have authMethod === 'osf'
  const isOAuthUser = data?.authMethod === 'osf';

  return (
    <AuthCheck fallbackRoute={deleting ? "/admin/deleted-account" : null}>
      <VStack spacing={8} w="560px">
        <Heading>Account Settings</Heading>
        
        {/* OAuth users: Show OAuth status only, no auth method selection */}
        {isOAuthUser ? (
          <OAuthTokenStatus />
        ) : (
          /* Email users: Show consolidated OSF authentication component */
          <SelectAuth />
        )}
        
        {/* Only show Change Password for email users, not OAuth users */}
        {!isOAuthUser && <ChangePassword />}
        
        <DeleteAccount setDeleting={setDeleting} />
      </VStack>
    </AuthCheck>
  );
}
