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
  requiredChakraThemeKeys,
} from "@chakra-ui/react";

import { useState } from "react";

import { doc, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";

export default function ExperimentValidation({ data }) {
  const validationOptionsArray = [];
  if (data.allowCSV) validationOptionsArray.push("csv");
  if (data.allowJSON) validationOptionsArray.push("json");

  const requiredFieldsText = data.requiredFields.join(", ");

  const [validationSettings, setValidationSettings] = useState(
    validationOptionsArray
  );
  const [requiredFields, setRequiredFields] = useState(requiredFieldsText);
  const [validationEnabled, setValidationEnabled] = useState(
    data.useValidation
  );
  const [isSaving, setIsSaving] = useState(false);

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
      <FormControl
        as={HStack}
        id="enable-validation"
        justify="space-between"
        alignItems="center"
      >
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
            <Textarea
              value={requiredFields}
              onChange={(e) => {
                setRequiredFields(e.target.value);
              }}
            />
            <FormHelperText>
              Enter a comma-separated list of required fields
            </FormHelperText>
          </FormControl>
        </>
      )}
      <Button
        variant={"solid"}
        colorScheme={"green"}
        size={"md"}
        onClick={() =>
          handleSaveSubmit(
            data.id,
            validationEnabled,
            validationSettings,
            requiredFields,
            setIsSaving
          )
        }
        isLoading={isSaving}
      >
        Save Validation Settings
      </Button>
    </Stack>
  );
}

async function handleSaveSubmit(
  expId,
  validationEnabled,
  validationSettings,
  requiredFields,
  setIsSaving
) {
  // split array and remove all whitespace
  const fieldsArray = requiredFields.split(",").map((field) => field.trim());

  const settings = {
    useValidation: validationEnabled,
    allowJSON: validationSettings.includes("json"),
    allowCSV: validationSettings.includes("csv"),
    requiredFields: fieldsArray,
  };

  setIsSaving(true);
  try {
    await setDoc(doc(db, `experiments/${expId}`), settings, { merge: true });
    setIsSaving(false);
  } catch (error) {
    console.error(error);
    setIsSaving(false);
  }
}
