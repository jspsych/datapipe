import {
  Field,
  HStack,
  Stack,
  Textarea,
  Checkbox,
  CheckboxGroup,
} from "@chakra-ui/react";

import { useEffect, useRef, useState } from "react";

import { doc, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import SettingsRow, {
  SaveError,
  SavedFlag,
  useTrackedSave,
} from "../ui/SettingsRow";
import { SwitchTable } from "./SectionPanel";

function writeExperiment(expId, fields) {
  return setDoc(doc(db, `experiments/${expId}`), fields, { merge: true });
}

export default function ExperimentValidation({ data }) {
  const validationOptionsArray = [];
  if (data.allowCSV) validationOptionsArray.push("csv");
  if (data.allowJSON) validationOptionsArray.push("json");

  const requiredFieldsText = data.requiredFields.join(", ");

  const [validationSettings, setValidationSettings] = useState(
    validationOptionsArray
  );
  const [requiredFields, setRequiredFields] = useState(requiredFieldsText);
  const [fieldsArray, setFieldsArray] = useState(data.requiredFields);
  // Mirrors the switch so the dependent controls appear the instant it is
  // flipped rather than after the Firestore round trip. SettingsRow calls
  // this again with the previous value if the write fails, so the revealed
  // controls disappear on failure too -- the mirror cannot drift from the row.
  const [validationEnabled, setValidationEnabled] = useState(
    data.useValidation
  );

  const detailSave = useTrackedSave(
    "Could not save your validation rules. DataPipe is still checking " +
      "submissions against the previous rules -- check your connection and " +
      "try again."
  );

  // The last values Firestore is known to hold, so a failed write can put the
  // form back to the truth rather than leaving it showing rules that are not
  // in force. Seeded from the document and updated only after a write lands.
  const committed = useRef({
    validationSettings: validationOptionsArray,
    fieldsArray: data.requiredFields,
  });

  // The old version of this effect had two defects. It listed `data` in its
  // dependency array, so ANY parent re-render carrying a new document identity
  // re-wrote all four validation fields to Firestore -- wasteful, and it also
  // fired on mount, which is why the component had no save feedback it could
  // honestly give (a "Saved" on arrival means nothing). And its write ended in
  // `catch (error) { }`, so a rejected write left the checkboxes and the
  // required-fields box describing rules that were never applied.
  //
  // Now: keyed to the values that actually changed plus the experiment id,
  // skipped on the first run, awaited, reverted on failure, and reported.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }

    const previous = committed.current;
    const next = {
      validationSettings,
      fieldsArray,
    };

    // Nothing to write when the state already matches what Firestore holds.
    // This is what stops the revert below from re-entering: reverting sets
    // state back to `committed.current`, which re-runs this effect, which
    // would otherwise start a fresh save and wipe the error message the
    // researcher has not read yet.
    const unchanged =
      [...previous.validationSettings].sort().join(",") ===
        [...validationSettings].sort().join(",") &&
      previous.fieldsArray.join(",") === fieldsArray.join(",");
    if (unchanged) return;

    detailSave.save(
      async () => {
        await writeExperiment(data.id, {
          allowJSON: validationSettings.includes("json"),
          allowCSV: validationSettings.includes("csv"),
          requiredFields: fieldsArray,
        });
        committed.current = next;
      },
      () => {
        setValidationSettings(previous.validationSettings);
        setFieldsArray(previous.fieldsArray);
        setRequiredFields(previous.fieldsArray.join(", "));
      }
    );
    // detailSave.save is stable (useCallback over a constant message), and
    // including the whole tracker object would re-run this on every status
    // change -- i.e. write, report saved, write again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationSettings, fieldsArray, data.id]);

  // A one-row SwitchTable rather than a bare Stack, so this switch sits on the
  // same bordered surface as the four in ExperimentActive instead of floating
  // on the page beside them.
  return (
    <SwitchTable>
      <SettingsRow
        label="Check submissions before storing them"
        description="Submissions that do not match the format you expect are rejected before they reach your storage provider, so malformed or unexpected data never lands in your dataset."
        checked={data.useValidation}
        onChange={setValidationEnabled}
        onSave={(next) => writeExperiment(data.id, { useValidation: next })}
        failureMessage="Could not change data validation. Submissions are still being handled the way they were before -- check your connection and try again."
      >
        {validationEnabled && (
          <Stack gap={4} w="100%">
            {/* CONTROLLED (`value`), not `defaultValue`. With an
                uncontrolled group, reverting `validationSettings` after a
                failed write would move the state back without moving the
                checkboxes -- the form would show rules that are not in force
                while claiming they had been restored, which is the same class
                of lie the empty catches told. */}
            {/* One confirmation for the whole detail block -- the checkboxes
                and the required-fields box are written by a single effect, so
                a single flag is the honest granularity. It sits at the top
                right of the block, holding its width, rather than mounting a
                line under the textarea and shoving the section below down
                every time a checkbox is ticked. */}
            <HStack
              justify="space-between"
              alignItems="center"
              w="100%"
              gap={4}
            >
              <CheckboxGroup
                value={validationSettings}
                onValueChange={(values) => {
                  setValidationSettings(values);
                }}
              >
                <Stack gap={6} direction="row">
                  <Checkbox.Root value="json" colorPalette="brandGreen">
                    <Checkbox.HiddenInput />
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <Checkbox.Label>Allow JSON</Checkbox.Label>
                  </Checkbox.Root>
                  <Checkbox.Root value="csv" colorPalette="brandGreen">
                    <Checkbox.HiddenInput />
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <Checkbox.Label>Allow CSV</Checkbox.Label>
                  </Checkbox.Root>
                </Stack>
              </CheckboxGroup>
              <SavedFlag
                saved={detailSave.saved}
                savedLabel="Validation rules saved"
              />
            </HStack>
            <Field.Root>
              <Field.Label>Required fields</Field.Label>
              <Textarea
                value={requiredFields}
                onChange={(e) => {
                  setRequiredFields(e.target.value);
                }}
                onBlur={() => {
                  const parsed = requiredFields
                    .split(",")
                    .map((field) => field.trim())
                    .filter(Boolean);
                  // Only commit a genuinely different list. `split` returns a
                  // fresh array every blur, and the save effect is keyed to
                  // `fieldsArray` by identity -- so without this, tabbing
                  // through the field without editing it wrote to Firestore.
                  if (parsed.join(",") !== fieldsArray.join(",")) {
                    setFieldsArray(parsed);
                  }
                }}
              />
              {/* `color="gray"` here was the CSS named color #808080, which
                  measures 4.19:1 on the dark page -- below the 4.5:1 body
                  floor, and a raw literal besides (DESIGN.md §8.5). Dropping
                  the prop lets the Field recipe's own fg.muted apply: 8.30:1
                  light / 9.14:1 dark. */}
              <Field.HelperText>
                A comma-separated list of column names that every submission
                must contain.
              </Field.HelperText>
            </Field.Root>
            <SaveError error={detailSave.error} />
          </Stack>
        )}
      </SettingsRow>
    </SwitchTable>
  );
}
