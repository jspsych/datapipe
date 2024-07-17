import {
  FormControl,
  FormLabel,
  HStack,
  Switch,
  Stack,
  Heading,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Box,
  Table,
  Thead,
  Tbody,
  Tfoot,
  Tr,
  Th,
  Td,
  TableCaption,
  TableContainer,
} from "@chakra-ui/react";

import { useState, useEffect } from "react";

import { setDoc, getDoc, doc } from "firebase/firestore";

import { db } from "../../lib/firebase";

export default function ErrorPanel({ errors }) {

  return (
    <Alert status="error" variant="solid">
      <AlertIcon />
      <Box flex="1">
        <AlertTitle mb={4}>There was an error in data upload.</AlertTitle>
        <Accordion allowToggle>
          <AccordionItem>
            <h2>
              <AccordionButton>
                <Box as="span" flex="1" textAlign="left">
                  See Error Logs
                </Box>
              </AccordionButton>
            </h2>
            <AccordionPanel pb={4}>
            <TableContainer>
  <Table variant='simple'>
    <Thead>
      <Tr>
        <Th>ERROR</Th>
        <Th>TIME</Th>
      </Tr>
    </Thead>
    <Tbody>
      {errors.map((error, index) => (
        <Tr key={index}>
        <Td>{error.error}</Td>
        <Td>{error.time}</Td>
      </Tr>))}
    </Tbody>
  </Table>
</TableContainer>  
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </Box>
    </Alert>
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


