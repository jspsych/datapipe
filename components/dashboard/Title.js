import {
  Editable,
  EditableInput,
  EditablePreview,
  useEditableControls,
  HStack,
  IconButton,
  Input,
  Flex,
} from "@chakra-ui/react";

import { CheckIcon, CloseIcon, EditIcon } from "@chakra-ui/icons";

import { db } from "../../lib/firebase";
import { doc, setDoc } from "firebase/firestore";

export default function ExperimentTitle({ data }) {
  function EditableControls() {
    const {
      isEditing,
      getSubmitButtonProps,
      getCancelButtonProps,
      getEditButtonProps,
    } = useEditableControls();

    return isEditing ? (
      <HStack spacing={2}>
        <IconButton
          size="sm"
          variant="outline" colorScheme={"brandTeal"}
          icon={<CheckIcon />}
          {...getSubmitButtonProps()}
        />
        <IconButton
          size="sm"
          variant="outline" colorScheme={"red"}
          icon={<CloseIcon />}
          {...getCancelButtonProps()}
        />
      </HStack>
    ) : (
      <IconButton variant="outline" colorScheme={"whiteAlpha"} size="sm" icon={<EditIcon />} {...getEditButtonProps()} />
    );
  }

  return (
    <Editable
      textAlign="left"
      defaultValue={data.title}
      fontSize="4xl"
      isPreviewFocusable={false}
      onSubmit={(value)=>updateExperimentTitle(value, data.id, data.title)}
      as={Flex}
      align="center"
    >
      <EditablePreview mr={8} />
      {/* Here is the custom input */}
      <Input as={EditableInput} size="lg" mr={8} />
      <EditableControls />
    </Editable>
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