import {
  Field,
  HStack,
  Switch,
  Stack,
  Heading,
  NumberInput,
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
  const [conditionActive, setConditionActive] = useState(
    "activeConditionAssignment" in data
      ? data.activeConditionAssignment
      : data.nConditions > 1
  );
  const [maxSessions, setMaxSessions] = useState(data.maxSessions);
  const [nConditions, setNConditions] = useState(data.nConditions);

  return (
    <Stack
      w="100%"
      pr={[0, 8]}
      gap={2}
      bgColor={"black"}
      borderRadius={16}
      p={6}
    >
      <Heading fontSize="2xl">Status</Heading>
      <Field.Root>
        <HStack justify="space-between" alignItems="center" w="100%">
          <Field.Label fontWeight={"normal"} mb={0}>Enable data collection?</Field.Label>
          <Switch.Root
            colorPalette="green"
            size="md"
            checked={experimentActive}
            onCheckedChange={(e) => {
              setExperimentActive(e.checked);
              toggleExperimentActive(data.id, e.checked);
            }}
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
      </Field.Root>

      <Field.Root>
        <HStack justify="space-between" alignItems="center" w="100%">
          <Field.Label fontWeight={"normal"} mb={0}>
            Enable base64 data collection?
          </Field.Label>
          <Switch.Root
            colorPalette="green"
            size="md"
            checked={base64Active}
            onCheckedChange={(e) => {
              setBase64Active(e.checked);
              toggleBase64Active(data.id, e.checked);
            }}
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
      </Field.Root>

      <Field.Root>
        <HStack justify="space-between" alignItems="center" w="100%">
          <Field.Label fontWeight={"normal"} mb={0}>
            Enable condition assignment?
          </Field.Label>
          <Switch.Root
            colorPalette="green"
            size="md"
            checked={conditionActive}
            onCheckedChange={(e) => {
              setConditionActive(e.checked);
              updateConditionActive(data.id, e.checked);
            }}
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
      </Field.Root>
      {conditionActive && (
        <Field.Root id="n-conditions" pb={6}>
          <Field.Label>How many conditions?</Field.Label>
          <NumberInput.Root
            value={String(nConditions)}
            min={2}
            onValueChange={(e) => {
              setNConditions(e.value);
              if (e.value !== "" && parseInt(e.value) >= 0) {
                updateNConditions(data.id, e.value);
              }
            }}
          >
            <NumberInput.Input />
            <NumberInput.Control>
              <NumberInput.IncrementTrigger />
              <NumberInput.DecrementTrigger />
            </NumberInput.Control>
          </NumberInput.Root>
        </Field.Root>
      )}

      <Field.Root>
        <HStack justify="space-between" alignItems="center" w="100%">
          <Field.Label fontWeight={"normal"} mb={0}>Enable session limit?</Field.Label>
          <Switch.Root
            colorPalette="green"
            size="md"
            checked={sessionLimitActive}
            onCheckedChange={(e) => {
              setSessionLimitActive(e.checked);
              updateSessionLimitActive(data.id, e.checked);
            }}
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
      </Field.Root>
      {sessionLimitActive && (
        <Field.Root id="session-limit">
          <Field.Label>How many total sessions?</Field.Label>
          <NumberInput.Root
            value={String(maxSessions)}
            min={0}
            onValueChange={(e) => {
              setMaxSessions(e.value);
              if (e.value !== "" && parseInt(e.value) >= 0) {
                updateMaxSessions(data.id, e.value);
              }
            }}
          >
            <NumberInput.Input />
            <NumberInput.Control>
              <NumberInput.IncrementTrigger />
              <NumberInput.DecrementTrigger />
            </NumberInput.Control>
          </NumberInput.Root>
        </Field.Root>
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
      { active: true },
      { merge: true }
    );
  } catch (error) {
  }
}

async function deactivateExperiment(expId) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      { active: false },
      { merge: true }
    );
  } catch (error) {
  }
}

async function toggleBase64Active(expId, active) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      { activeBase64: active },
      { merge: true }
    );
  } catch (error) {
  }
}

async function updateSessionLimitActive(expId, active) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      { limitSessions: active },
      { merge: true }
    );
  } catch (error) {
  }
}

async function updateMaxSessions(expId, maxSessions) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      { maxSessions: parseInt(maxSessions) },
      { merge: true }
    );
  } catch (error) {
  }
}

async function updateConditionActive(expId, active) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      { activeConditionAssignment: active },
      { merge: true }
    );
  } catch (error) {
  }
}

async function updateNConditions(expId, nConditions) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      { nConditions: parseInt(nConditions) },
      { merge: true }
    );
  } catch (error) {
  }
}
