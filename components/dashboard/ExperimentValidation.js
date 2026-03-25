import {
  Field,
  HStack,
  Switch,
  Stack,
  Heading,
  Textarea,
  Checkbox,
  CheckboxGroup,
  Button,
} from "@chakra-ui/react";

import { useEffect, useState } from "react";

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

  const [fieldsArray, setFieldsArray] = useState(data.requiredFields);

  useEffect(() => {
    async function handleSave() {
      const settings = {
        useValidation: validationEnabled,
        allowJSON: validationSettings.includes("json"),
        allowCSV: validationSettings.includes("csv"),
        requiredFields: fieldsArray,
      };

      try {
        await setDoc(doc(db, `experiments/${data.id}`), settings, {
          merge: true,
        });
      } catch (error) {
      }
    }
    handleSave();
  }, [validationEnabled, validationSettings, fieldsArray, data]);

  return (
    <Stack
      w="100%"
      pr={[0, 8]}
      gap={3}
      bgColor={"black"}
      borderRadius={16}
      p={6}
    >
      <Heading fontSize="2xl">Data Validation</Heading>
      <Field.Root id="enable-validation">
        <HStack justify="space-between" alignItems="center" w="100%">
          <Field.Label fontWeight="normal" mb={0}>Enable data validation?</Field.Label>
          <Switch.Root
            colorPalette="green"
            size="md"
            checked={validationEnabled}
            onCheckedChange={(e) => {
              setValidationEnabled(e.checked);
            }}
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
      </Field.Root>
      {validationEnabled && (
        <>
          <CheckboxGroup
            defaultValue={validationSettings}
            onValueChange={(values) => {
              setValidationSettings(values);
            }}
          >
            <Stack gap={5} direction="row">
              <Checkbox.Root value="json" colorPalette="brandTeal">
                <Checkbox.HiddenInput />
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Label>Allow JSON</Checkbox.Label>
              </Checkbox.Root>
              <Checkbox.Root value="csv" colorPalette="brandTeal">
                <Checkbox.HiddenInput />
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Label>Allow CSV</Checkbox.Label>
              </Checkbox.Root>
            </Stack>
          </CheckboxGroup>
          <Field.Root>
            <Field.Label>Required Fields</Field.Label>
            <Textarea
              value={requiredFields}
              onChange={(e) => {
                setRequiredFields(e.target.value);
              }}
              onBlur={() => {
                setFieldsArray(
                  requiredFields.split(",").map((field) => field.trim())
                );
              }}
            />
            <Field.HelperText color="gray">
              Enter a comma-separated list of required fields
            </Field.HelperText>
          </Field.Root>
        </>
      )}
    </Stack>
  );
}
