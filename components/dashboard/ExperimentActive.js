import {
  FormControl,
  FormLabel,
  HStack,
  Switch,
  Stack,
  Heading,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
} from "@chakra-ui/react";

import { useState } from "react";

import { setDoc, doc } from "firebase/firestore";

import { db } from "../../lib/firebase";

export default function ExperimentActive({ data }) {
  const [sessionLimitActive, setSessionLimitActive] = useState(
    data.limitSessions
  );
  const [experimentActive, setExperimentActive] = useState(data.active);
  const [base64Active, setBase64Active] = useState(data.activeBase64 || false);
  const [maxSessions, setMaxSessions] = useState(data.maxSessions);

  return (
    <Stack
      w="100%"
      pr={8}
      spacing={2}
      bgColor={"black"}
      borderRadius={16}
      p={6}
    >
      <Heading fontSize="2xl">Status</Heading>
      <FormControl as={HStack} justify="space-between" alignItems="center">
        <FormLabel fontWeight={"normal"}>Enable data collection?</FormLabel>
        <Switch
          colorScheme="green"
          size="md"
          isChecked={experimentActive}
          onChange={(e) => {
            setExperimentActive(e.target.checked);
            toggleExperimentActive(data.id, e.target.checked);
          }}
        />
      </FormControl>
      <FormControl as={HStack} justify="space-between" alignItems="center">
        <FormLabel fontWeight={"normal"}>Enable base64 data collection?</FormLabel>
        <Switch
          colorScheme="green"
          size="md"
          isChecked={base64Active}
          onChange={(e) => {
            setBase64Active(e.target.checked);
            toggleBase64Active(data.id, e.target.checked);
          }}
        />
      </FormControl>
      <FormControl as={HStack} justify="space-between" alignItems="center">
        <FormLabel fontWeight={"normal"}>Enable session limit?</FormLabel>
        <Switch
          colorScheme="green"
          size="md"
          isChecked={sessionLimitActive}
          onChange={(e) => {
            setSessionLimitActive(e.target.checked);
            updateSessionLimitActive(data.id, e.target.checked);
          }}
        />
      </FormControl>
      {sessionLimitActive && (
        <FormControl id="session-limit">
          <FormLabel>How many total sessions?</FormLabel>
          <NumberInput
            value={maxSessions}
            min={0}
            onChange={(value) => {
              setMaxSessions(value);
              if(value!=="" && parseInt(value) >= 0){
                updateMaxSessions(data.id, value);
              }
            }}
            onBlur={(e)=>{
              if(e.target.value ===""){
                setMaxSessions(0);
                updateMaxSessions(data.id, 0);
              }
            }}
          >
            <NumberInputField />
            <NumberInputStepper>
              <NumberIncrementStepper />
              <NumberDecrementStepper />
            </NumberInputStepper>
          </NumberInput>
        </FormControl>
      )}
    </Stack>
  );
}

async function toggleExperimentActive(expId, active) {
  if (active) {
    activateExperiment(expId);
  } else {
    deactivateExperiment(expId);
  }
}

async function activateExperiment(expId) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        active: true,
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}

async function deactivateExperiment(expId) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        active: false,
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}

async function toggleBase64Active(expId, active) {
  if (active) {
    activateBase64(expId);
  } else {
    deactivateBase64(expId);
  }
}

async function activateBase64(expId) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        activeBase64: true,
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}

async function deactivateBase64(expId) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        activeBase64: false,
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}

async function updateSessionLimitActive(expId, active) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        limitSessions: active,
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}

async function updateMaxSessions(expId, maxSessions) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        maxSessions: parseInt(maxSessions),
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}
