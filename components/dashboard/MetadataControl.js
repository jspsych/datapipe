import {
  Field,
  HStack,
  Switch,
  Stack,
  Heading,
} from "@chakra-ui/react";

import { useState } from "react";

import { setDoc, doc } from "firebase/firestore";

import { db } from "../../lib/firebase";

export default function MetadataControl({ data }) {

  const [metadataActive, setMetadataActive] = useState(data.metadataActive);

  return (
    <Stack
      w="100%"
      pr={[0, 8]}
      gap={2}
      bgColor={"black"}
      borderRadius={16}
      p={6}
    >
      <Heading fontSize="2xl">Metadata</Heading>
      <Field.Root>
        <HStack justify="space-between" alignItems="center" w="100%">
          <Field.Label fontWeight={"normal"} mb={0}>Enable Psych-DS metadata production?</Field.Label>
          <Switch.Root
            colorPalette="green"
            size="md"
            checked={metadataActive}
            onCheckedChange={(e) => {
              setMetadataActive(e.checked);
              toggleMetadataActive(data.id, e.checked);
            }}
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
      </Field.Root>
    </Stack>
  );
}

async function toggleMetadataActive(expId, active) {
  if (active) {
    activateMetadata(expId);
  } else {
    deactivateMetadata(expId);
  }
}

async function activateMetadata(expId) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        metadataActive: true,
      },
      { merge: true }
    );
  } catch (error) {
  }
}

async function deactivateMetadata(expId) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        metadataActive: false,
      },
      { merge: true }
    );
  } catch (error) {
  }
}
