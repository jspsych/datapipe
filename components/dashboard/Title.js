import { useState } from "react";
import { Editable, IconButton, Flex, Stack } from "@chakra-ui/react";

import { Check, X, Pencil } from "lucide-react";

import { db } from "../../lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { SaveStatus, useTrackedSave } from "../ui/SettingsRow";

export default function ExperimentTitle({ data }) {
  // Remount counter for the Editable. See handleCommit.
  const [resetKey, setResetKey] = useState(0);

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

      <SaveStatus
        saved={titleSave.saved}
        error={titleSave.error}
        savedLabel="Name saved"
      />
    </Stack>
  );
}
