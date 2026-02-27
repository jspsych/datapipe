import { useState, useContext } from "react";
import { UserContext } from "../../lib/context";

import {
  HStack,
  VStack,
  Button,
  Text,
  Dialog,
  Field,
  Input,
  Tooltip,
  Link,
} from "@chakra-ui/react";

import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";

import { db, auth } from "../../lib/firebase";
import { CircleCheck, TriangleAlert } from "lucide-react";

export default function OSFToken() {
  const { user } = useContext(UserContext);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);

  const [data, loading, error, snapshot, reload] = useDocumentData(
    doc(db, "users", user.uid)
  );

  return (
    <HStack justifyContent="space-between" w="100%">
      <HStack>
        <Text fontSize={"lg"}>OSF Token</Text>
        {data && data.osfTokenValid ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span><CircleCheck color="var(--chakra-colors-green-500)" /></span>
            </Tooltip.Trigger>
            <Tooltip.Positioner>
              <Tooltip.Content>Valid OSF Token</Tooltip.Content>
            </Tooltip.Positioner>
          </Tooltip.Root>
        ) : (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span><TriangleAlert color="var(--chakra-colors-orange-500)" /></span>
            </Tooltip.Trigger>
            <Tooltip.Positioner>
              <Tooltip.Content>Invalid OSF Token</Tooltip.Content>
            </Tooltip.Positioner>
          </Tooltip.Root>
        )}
      </HStack>
      <Button loading={isSubmitting} onClick={() => setOpen(true)} colorPalette="brandTeal">
        Set OSF Token
      </Button>
      <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="greyBackground">
            <Dialog.Header>Change OSF Token</Dialog.Header>
            <Dialog.CloseTrigger />
            <Dialog.Body>
              <VStack gap={4} w="100%">
                <Text>
                  To generate an OSF token, go to{" "}
                  <Link
                    color="brandOrange.100"
                    href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/settings/tokens/`}
                    target="_blank"
                    rel="noopener noreferrer"
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
                  <VStack gap={4} w="100%">
                    <Field.Root id="osf-token">
                      <Field.Label>OSF Token</Field.Label>
                      <Input type="text" placeholder="Paste your OSF token here" />
                    </Field.Root>
                  </VStack>
                )}
              </VStack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                variant={"solid"}
                colorPalette={"brandTeal"}
                size={"md"}
                mr={4}
                onClick={() => {
                  handleSaveButton(setIsSubmitting, () => setOpen(false));
                }}
                loading={isSubmitting}
              >
                Change Token
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
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
