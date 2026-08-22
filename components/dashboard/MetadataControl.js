import { Badge } from "@chakra-ui/react";

import { setDoc, doc } from "firebase/firestore";

import { db } from "../../lib/firebase";
import SettingsRow from "../ui/SettingsRow";

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

export default function MetadataControl({ data }) {
  return (
    <SettingsRow
      label="Generate Psych-DS metadata"
      checked={data.metadataActive}
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
  );
}
