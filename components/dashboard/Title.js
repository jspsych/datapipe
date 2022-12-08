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

export default function ExperimentTitle({ title, onSubmit }) {
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
      defaultValue={title}
      fontSize="4xl"
      isPreviewFocusable={false}
      onSubmit={onSubmit}
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