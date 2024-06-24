import {
  FormControl,
  FormLabel,
  HStack,
  Switch,
  Stack,
  Heading,
} from "@chakra-ui/react";

import { useState, useEffect } from "react";

import validateJSON from "../../functions/validate-json.js";

import { setDoc, getDoc, doc } from "firebase/firestore";

import { db } from "../../lib/firebase";

export default function MetadataControl({ data }) {

  const [metadataActive, setMetadataActive] = useState(data.metadataActive);

  return (
    <Stack
      w="100%"
      pr={8}
      spacing={2}
      bgColor={"black"}
      borderRadius={16}
      p={6}
    >
      <Heading fontSize="2xl">Metadata</Heading>
      <FormControl as={HStack} justify="space-between" alignItems="center">
        <FormLabel fontWeight={"normal"}>Enable Psych-DS metadata production?</FormLabel>
        <Switch
          colorScheme="green"
          size="md"
          isChecked={metadataActive}
          onChange={(e) => {
            setMetadataActive(e.target.checked);
            toggleMetadataActive(data.id, e.target.checked);
          }}
        />
      </FormControl>
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
    console.error(error);
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
    console.error(error);
  }
}


