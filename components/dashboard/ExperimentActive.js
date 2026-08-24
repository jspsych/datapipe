import { Field, NumberInput } from "@chakra-ui/react";

import { useState } from "react";

import { setDoc, doc } from "firebase/firestore";

import { db } from "../../lib/firebase";
import SettingsRow, { SaveStatus, useTrackedSave } from "../ui/SettingsRow";
import { SwitchTable } from "./SectionPanel";

// Every writer below returns the setDoc promise UNCAUGHT. That is the point of
// this file's rewrite: each one used to end in `catch (error) { }` -- seven
// empty catches, one per write -- so a rejected write looked exactly like a
// successful one and the switch stayed where the researcher put it while
// Firestore held the opposite value. See components/ui/SettingsRow.js for the
// full argument; the short version is that a data-collection switch which can
// silently lie about whether collection is on is the worst failure this
// product has, and PRODUCT.md Principle 5 / DESIGN.md §8.7 both forbid it.
//
// The rejection is now the signal. SettingsRow (and useTrackedSave, for the
// numeric fields) awaits these, reverts the control on failure, and renders a
// human message. Do not reintroduce a catch here.
function writeExperiment(expId, fields) {
  return setDoc(doc(db, `experiments/${expId}`), fields, { merge: true });
}

export default function ExperimentActive({ data }) {
  const [sessionLimitActive, setSessionLimitActive] = useState(
    data.limitSessions
  );
  const [conditionActive, setConditionActive] = useState(
    "activeConditionAssignment" in data
      ? data.activeConditionAssignment
      : data.nConditions > 1
  );
  const [maxSessions, setMaxSessions] = useState(data.maxSessions);
  const [nConditions, setNConditions] = useState(data.nConditions);

  // The two numeric fields are not switch rows, so they use the same write
  // tracking directly. Each keeps its own tracker: a failed session-limit
  // write must not put an error message under the conditions field.
  const nConditionsSave = useTrackedSave(
    "Could not save the number of conditions. Your experiment is still " +
      "assigning conditions using the previous value -- check your " +
      "connection and try again."
  );
  const maxSessionsSave = useTrackedSave(
    "Could not save the session limit. Your experiment is still using the " +
      "previous limit -- check your connection and try again."
  );

  // SwitchTable, not the bare SettingsRowGroup this used to be: four switches
  // stacked on the page with nothing but `gap={4}` around them read as four
  // unrelated controls, and each one's description ran straight into the next
  // one's label. One bordered panel, one hairline-separated row per switch.
  // See components/dashboard/SectionPanel.js.
  return (
    <SwitchTable label="Data collection settings">
      <SettingsRow
        label="Accept new data"
        description="While this is on, your experiment ID accepts submissions from participants. Turning it off stops new submissions immediately; data you have already collected is not affected."
        checked={data.active}
        onSave={(next) => writeExperiment(data.id, { active: next })}
        failureMessage="Could not change data collection. Your experiment is still set the way it was before -- check your connection and try again."
        savedLabel="Data collection setting saved"
      />

      <SettingsRow
        label="Accept base64 file uploads"
        description="Needed only if your experiment sends binary files -- audio, video or images -- rather than CSV or JSON data."
        checked={data.activeBase64 || false}
        onSave={(next) => writeExperiment(data.id, { activeBase64: next })}
        failureMessage="Could not change base64 uploads. The setting is unchanged -- check your connection and try again."
      />

      <SettingsRow
        label="Assign conditions in sequence"
        description="DataPipe hands each participant the next condition number in order, so your conditions stay balanced."
        checked={conditionActive}
        onChange={setConditionActive}
        onSave={(next) =>
          writeExperiment(data.id, { activeConditionAssignment: next })
        }
        failureMessage="Could not change condition assignment. The setting is unchanged -- check your connection and try again."
      >
        {conditionActive && (
          <Field.Root id="n-conditions">
            <Field.Label>How many conditions?</Field.Label>
            <NumberInput.Root
              value={String(nConditions)}
              min={2}
              onValueChange={(e) => {
                const previous = nConditions;
                setNConditions(e.value);
                if (e.value !== "" && parseInt(e.value) >= 0) {
                  nConditionsSave.save(
                    () =>
                      writeExperiment(data.id, {
                        nConditions: parseInt(e.value),
                      }),
                    () => setNConditions(previous)
                  );
                }
              }}
            >
              <NumberInput.Input />
              <NumberInput.Control>
                <NumberInput.IncrementTrigger />
                <NumberInput.DecrementTrigger />
              </NumberInput.Control>
            </NumberInput.Root>
            <SaveStatus
              saved={nConditionsSave.saved}
              error={nConditionsSave.error}
            />
          </Field.Root>
        )}
      </SettingsRow>

      <SettingsRow
        label="Stop after a set number of sessions"
        description="Once the limit is reached your experiment stops accepting data, so a study cannot overrun its recruitment target."
        checked={sessionLimitActive}
        onChange={setSessionLimitActive}
        onSave={(next) => writeExperiment(data.id, { limitSessions: next })}
        failureMessage="Could not change the session limit setting. It is unchanged -- check your connection and try again."
      >
        {sessionLimitActive && (
          <Field.Root id="session-limit">
            <Field.Label>How many total sessions?</Field.Label>
            <NumberInput.Root
              value={String(maxSessions)}
              min={0}
              onValueChange={(e) => {
                const previous = maxSessions;
                setMaxSessions(e.value);
                if (e.value !== "" && parseInt(e.value) >= 0) {
                  maxSessionsSave.save(
                    () =>
                      writeExperiment(data.id, {
                        maxSessions: parseInt(e.value),
                      }),
                    () => setMaxSessions(previous)
                  );
                }
              }}
            >
              <NumberInput.Input />
              <NumberInput.Control>
                <NumberInput.IncrementTrigger />
                <NumberInput.DecrementTrigger />
              </NumberInput.Control>
            </NumberInput.Root>
            <SaveStatus
              saved={maxSessionsSave.saved}
              error={maxSessionsSave.error}
            />
          </Field.Root>
        )}
      </SettingsRow>
    </SwitchTable>
  );
}
