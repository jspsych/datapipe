import { useState } from "react";
import { Editable, IconButton, Flex, Stack, Text } from "@chakra-ui/react";

import { Check, X, Pencil } from "lucide-react";

import { db } from "../../lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { STORAGE_PROVIDERS } from "../../lib/provider-config";
import { SaveStatus, useTrackedSave } from "../ui/SettingsRow";

export default function ExperimentTitle({ data }) {
  // Remount counter for the Editable. See handleCommit.
  const [resetKey, setResetKey] = useState(0);
  // Whether the Editable is currently in edit mode, so the caveat below is
  // shown only to someone actually renaming -- it is a footnote about the
  // rename, not a standing fact about the experiment, and a permanent line of
  // small print under the page's H1 would be exactly the wrong weight for it.
  const [editing, setEditing] = useState(false);

  // What a rename does NOT touch. `title` is fixed at creation for every
  // provider: it named the Drive folder / Dataverse dataset / Zenodo
  // deposition when createDataContainer ran, and no adapter implements a
  // container rename, so this write moves DataPipe's title only and the two
  // diverge permanently. The researcher gets told that here rather than
  // discovering it in their storage account months later. Undefined for
  // legacy OSF experiments (STORAGE_PROVIDERS has no osf entry), which simply
  // show no caveat.
  const containerLabel = STORAGE_PROVIDERS[data.storageProvider]?.containerLabel;

  const titleSave = useTrackedSave(
    "Could not rename this experiment. It is still called “" +
      data.title +
      "” -- check your connection and try again."
  );

  // The rename used to end in `catch (error) { }`: the Editable committed the
  // new text to the DOM, the write failed, and the page went on showing a
  // title that existed nowhere but in this browser tab until the next reload
  // silently undid it. `key` is tied to the committed title so a failed write
  // remounts the Editable back to the real value -- Editable owns its own
  // draft internally, and this is the supported way to reset it.
  const handleCommit = (nextTitle) => {
    if (nextTitle === data.title) return;
    titleSave.save(
      () =>
        setDoc(
          doc(db, `experiments/${data.id}`),
          { title: nextTitle },
          { merge: true }
        ),
      () => setResetKey((k) => k + 1)
    );
  };

  return (
    <Stack gap={0} w="100%">
      <Editable.Root
        key={`${data.title}-${resetKey}`}
        textAlign="left"
        defaultValue={data.title}
        fontSize="2xl"
        fontWeight="bold"
        color="fg"
        onValueCommit={(details) => handleCommit(details.value)}
        onEditChange={(details) => setEditing(details.edit)}
        as={Flex}
        align="center"
      >
        <Editable.Preview mr={8} />
        <Editable.Input size="lg" mr={8} />
        <Editable.Control>
          <Editable.EditTrigger asChild>
            {/* All three triggers drop their literal `white` / `green.400` /
                `red.400` + `whiteAlpha.300` props. The default gray outline
                recipe is legible in both modes now (border gray.500: 4.50:1
                light / 3.43:1 dark) and hover uses bg.muted. Cancel-editing
                was `red.400`, which DESIGN.md §5 reserves for irreversible
                destruction -- abandoning an edit is neither. Commit stays
                green because it is the primary action inside this control,
                and brandGreen is the app's one primary (§5). */}
            <IconButton aria-label="Rename experiment" variant="outline" size="sm">
              <Pencil />
            </IconButton>
          </Editable.EditTrigger>
          <Editable.SubmitTrigger asChild>
            <IconButton
              aria-label="Save new name"
              size="sm"
              variant="outline"
              colorPalette="brandGreen"
            >
              <Check />
            </IconButton>
          </Editable.SubmitTrigger>
          <Editable.CancelTrigger asChild>
            <IconButton
              aria-label="Cancel renaming"
              size="sm"
              variant="outline"
              colorPalette="gray"
            >
              <X />
            </IconButton>
          </Editable.CancelTrigger>
        </Editable.Control>
      </Editable.Root>

      {editing && containerLabel && (
        <Text fontSize="sm" color="fg.muted">
          This renames the experiment in DataPipe only. Your{" "}
          {containerLabel.toLowerCase()} keeps the name it was created with.
        </Text>
      )}

      <SaveStatus
        saved={titleSave.saved}
        error={titleSave.error}
        savedLabel="Name saved"
      />
    </Stack>
  );
}
