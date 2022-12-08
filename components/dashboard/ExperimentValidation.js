import {
  FormControl,
  FormLabel,
  HStack,
  Switch,
  Stack,
  Heading,
  Textarea,
  FormHelperText,
  Checkbox,
  CheckboxGroup,
  Button,
} from "@chakra-ui/react";

import { useState } from "react";

export default function ExperimentValidation({ data,}) {

  const [validationSettings, setValidationSettings] = useState(['json']);
  const [requiredFields, setRequiredFields] = useState('');
  const [validationEnabled, setValidationEnabled] = useState(data.useValidation);

  return (
    <Stack
      w="100%"
      pr={8}
      spacing={2}
      bgColor={"black"}
      borderRadius={16}
      p={6}
    >
      <Heading fontSize="2xl">Data Validation</Heading>
      <FormControl as={HStack} id="enable-validation" justify="space-between" alignItems="center">
        <FormLabel fontWeight="normal">Enable data validation?</FormLabel>
        <Switch
          colorScheme="green"
          size="md"
          isChecked={validationEnabled}
          onChange={(e) => setValidationEnabled(e.target.checked)}
        />
      </FormControl>
      {validationEnabled && (
        <>
        <CheckboxGroup
          id="validation-settings"
          defaultValue={validationSettings}
          onChange={setValidationSettings}
          colorScheme="brandTeal"
        >
          <Stack spacing={5} direction="row">
            <Checkbox value="json">Allow JSON</Checkbox>
            <Checkbox value="csv">Allow CSV</Checkbox>
          </Stack>
        </CheckboxGroup>
      <FormControl>
        <FormLabel>Required Fields</FormLabel>
        <Textarea value={requiredFields} onChange={(e)=>{setRequiredFields(e.target.value)}}/>
        <FormHelperText>
          Enter a comma-separated list of required fields
        </FormHelperText>
      </FormControl>
      </>
      )}
      <Button variant={"solid"} colorScheme={"green"} size={"md"}>
        Save Validation Settings
      </Button>
    </Stack>
  );
}
