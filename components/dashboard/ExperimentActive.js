import { FormControl, FormLabel, HStack, Switch, Stack, Heading } from "@chakra-ui/react";

export default function ExperimentActive({ data }) {
  return (
    <Stack w="100%" pr={8} spacing={2} bgColor={"black"} borderRadius={16} p={6}>
      <Heading fontSize="2xl">Status</Heading>
      <FormControl as={HStack} justify="space-between" alignItems="center">
        <FormLabel fontWeight={"normal"}>Enable data collection?</FormLabel>
        <Switch
          colorScheme="green"
          size="md"
          isChecked={data.active}
          onChange={(e)=>toggleExperimentActive(data.id, e.target.checked)}
        />
      </FormControl>
    </Stack>
  );
}

async function toggleExperimentActive(expId, active) {
  if (active) {
    deactivateExperiment(expId);
  } else {
    activateExperiment(expId);
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
