import { FormControl, FormLabel, HStack, Switch, Stack, Heading } from "@chakra-ui/react";

export default function ExperimentActive({ data, onChange }) {
  return (
    <Stack w="100%" pr={8} spacing={2} bgColor={"black"} borderRadius={16} p={6}>
      <Heading fontSize="2xl">Status</Heading>
      <FormControl as={HStack} justify="space-between" alignItems="center">
        <FormLabel fontWeight={"normal"}>Enable data collection?</FormLabel>
        <Switch
          colorScheme="green"
          size="md"
          isChecked={data.active}
          onChange={onChange}
        />
      </FormControl>
    </Stack>
  );
}
