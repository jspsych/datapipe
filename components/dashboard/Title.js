import {
  Editable,
  HStack,
  IconButton,
  Flex,
} from "@chakra-ui/react";

import { Check, X, Pencil } from "lucide-react";

import { db } from "../../lib/firebase";
import { doc, setDoc } from "firebase/firestore";

export default function ExperimentTitle({ data }) {
  return (
    <Editable.Root
      textAlign="left"
      defaultValue={data.title}
      fontSize="4xl"
      onValueCommit={(details) => updateExperimentTitle(details.value, data.id, data.title)}
      as={Flex}
      align="center"
    >
      <Editable.Preview mr={8} />
      <Editable.Input size="lg" mr={8} />
      <Editable.Control>
        <Editable.EditTrigger asChild>
          <IconButton
            variant="outline"
            colorPalette={"whiteAlpha"}
            size="sm"
          >
            <Pencil />
          </IconButton>
        </Editable.EditTrigger>
        <Editable.SubmitTrigger asChild>
          <IconButton
            size="sm"
            variant="outline"
            colorPalette={"brandTeal"}
          >
            <Check />
          </IconButton>
        </Editable.SubmitTrigger>
        <Editable.CancelTrigger asChild>
          <IconButton
            size="sm"
            variant="outline"
            colorPalette={"red"}
          >
            <X />
          </IconButton>
        </Editable.CancelTrigger>
      </Editable.Control>
    </Editable.Root>
  );
}

async function updateExperimentTitle(newTitle, expId, oldTitle) {
  if (newTitle === oldTitle) return;
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        title: newTitle,
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}
