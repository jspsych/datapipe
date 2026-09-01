import { Badge } from "@chakra-ui/react";

import { setDoc, doc } from "firebase/firestore";

import { db } from "../../lib/firebase";
import SettingsRow from "../ui/SettingsRow";
import { SwitchTable } from "./SectionPanel";

// Returns the promise uncaught -- see the note in ExperimentActive.js. The two
// empty catches that used to live here (activateMetadata / deactivateMetadata)
// meant a failed write left the switch showing metadata production as on while
// Firestore said off.
function writeMetadataActive(expId, active) {
  return setDoc(
    doc(db, `experiments/${expId}`),
    { metadataActive: active },
    { merge: true }
  );
}

// Whether this experiment has already collected data, and therefore whether
// the metadata setting is frozen.
//
// The setting decides WHERE a submission is stored -- at the container root
// with it off, under data/raw/ with it on (uploadPathFor in
// functions/src/metadata-derived-files.ts) -- and which namespace the
// duplicate-detection cache claims in. Flipping it mid-collection therefore
// strands everything already written at the old location and resets duplicate
// detection against it, so a participant resubmitting a filename from before
// the flip gets a second file instead of being recognised. Before the first
// submission none of that exists yet and the choice is free, which is why the
// lock is "has data", not "was created".
//
// `sessions` is the honest signal. `collisionCache` is the tamper-resistant
// one -- it is server-managed and firestore.rules forbids clients touching it
// -- and covers an experiment whose sessions counter was somehow reset. The
// matching server rule is the gate that actually enforces this; this function
// only decides what the UI offers.
function hasCollectedData(data) {
  return (typeof data.sessions === "number" && data.sessions > 0) || !!data.collisionCache;
}

export default function MetadataControl({ data }) {
  const locked = hasCollectedData(data);

  // One-row SwitchTable: same bordered surface as every other switch on the
  // page (components/dashboard/SectionPanel.js).
  return (
    <SwitchTable>
      <SettingsRow
        label="Generate Psych-DS metadata"
        checked={data.metadataActive}
        disabled={locked}
        description={
          locked
            ? "Locked because this experiment has collected data. This setting decides where files are stored, so changing it now would separate new submissions from the ones you already have. Create a new experiment to collect with a different setting."
            : undefined
        }
        onSave={(next) => writeMetadataActive(data.id, next)}
        failureMessage="Could not change metadata production. The setting is unchanged -- check your connection and try again."
        badge={
          // Outline, not solid. DESIGN.md §1's caveat on brandGreen: Chakra's
          // `subtle`/`surface` variants paint colorPalette.fg on
          // colorPalette.subtle, which in dark mode is 300-on-900 = 3.91:1,
          // under the body floor. An outline chip uses brandGreen.fg for text
          // (4.77:1 light / 6.71:1 dark) and brandGreen.border for the rule
          // (3.83:1 / 7.00:1) and clears both floors. The previous
          // `colorPalette="green" variant="solid"` was also the second green
          // (#22c55e) that DESIGN.md §1 retires.
          <Badge colorPalette="brandGreen" variant="outline" px={2}>
            Recommended
          </Badge>
        }
      />
    </SwitchTable>
  );
}
