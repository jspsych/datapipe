import AuthCheck from "../../components/AuthCheck";
import { doc, setDoc } from "firebase/firestore";
import { updatePassword } from "firebase/auth";
import { auth, db } from "../../lib/firebase";
import { useContext, useState } from "react";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { UserContext } from "../../lib/context";
import {
  Stack,
  VStack,
  Button,
  Heading,
  FormControl,
  FormLabel,
  FormHelperText,
  Input,
  Spinner,
} from "@chakra-ui/react";

export default function ProfilePage({}) {
  return (
    <AuthCheck>
      <VStack spacing={16}>
        <Heading>Account Settings</Heading>
        <PasswordChangeForm />
        <OsfTokenForm />
      </VStack>
    </AuthCheck>
  );
}

function PasswordChangeForm() {
  const { user } = useContext(UserContext);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <Stack>
      <FormControl id="new-password">
        <FormLabel>New Password</FormLabel>
        <Input type="password" />
      </FormControl>
      <Button
        isLoading={isSubmitting}
        onClick={() => {
          handleChangePassword(setIsSubmitting);
        }}
        colorScheme="brandTeal"
      >
        Change Password
      </Button>
    </Stack>
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

function OsfTokenForm() {
  const { user } = useContext(UserContext);
  const [data, loading, error, snapshot, reload] = useDocumentData(
    doc(db, "users", user.uid)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <>
      {loading && <Spinner color="green.500" size={"xl"} />}
      {data && (
        <Stack>
          <FormControl id="osf-token">
            <FormLabel>OSF Token</FormLabel>
            <Input type="text" defaultValue={data.osfToken} />
            <FormHelperText color="white">
              {data.osfTokenValid
                ? "This is a valid token"
                : "This is an invalid token"}
            </FormHelperText>
          </FormControl>
          <Button
            variant={"solid"}
            colorScheme={"brandTeal"}
            size={"md"}
            mr={4}
            onClick={() => handleSaveButton(setIsSubmitting)}
            isLoading={isSubmitting}
          >
            Save Token
          </Button>
        </Stack>
      )}
    </>
  );
}

async function handleSaveButton(setIsSubmitting) {
  const token = document.querySelector("#osf-token").value;
  setIsSubmitting(true);
  try {
    const isTokenValid = await checkOSFToken(token);
    const userDoc = doc(db, "users", auth.currentUser.uid);
    await setDoc(
      userDoc,
      { osfToken: token, osfTokenValid: isTokenValid },
      { merge: true }
    );
    setIsSubmitting(false);
  } catch (error) {
    setIsSubmitting(false);
    console.log(error);
  }
}

async function checkOSFToken(token) {
  const data = await fetch("https://api.osf.io/v2/", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (data.status === 200) {
    return true;
  } else {
    return false;
  }
}
