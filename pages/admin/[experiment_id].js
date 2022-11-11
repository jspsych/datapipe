import AuthCheck from "../../components/AuthCheck";
import { useRouter } from "next/router";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { db, auth } from "../../lib/firebase";
import { doc, setDoc } from "firebase/firestore";

import {
  FormControl,
  Stack,
  Spinner,
  Input,
  InputGroup,
  InputLeftAddon,
  Checkbox,
  FormLabel,
  Button,
  ButtonGroup,
  IconButton,
  Editable,
  EditableInput,
  EditablePreview,
  Flex,
  Link,
  Text,
  Tag,
  TagLabel,
} from "@chakra-ui/react";
import { useEditableControls } from "@chakra-ui/react";
import {
  EditIcon,
  CheckIcon,
  CloseIcon,
  ExternalLinkIcon,
} from "@chakra-ui/icons";

export default function ExperimentPage() {
  const router = useRouter();
  const { experiment_id } = router.query;

  return (
    <AuthCheck>
      <ExperimentEditForm expId={experiment_id} />
    </AuthCheck>
  );
}

function ExperimentEditForm({ expId }) {
  const [data, loading, error, snapshot, reload] = useDocumentData(
    doc(db, `experiments/${expId}`)
  );
  return (
    <>
      {loading && <Spinner color="green.500" size={"xl"} />}
      {data && (
        <Stack>
          <ExperimentTitle title={data.title} onSubmit={(newTitle)=>updateExperimentTitle(newTitle, expId)} />
          <Text>Experiment ID</Text>
          <Text>{data.id}</Text>
          <Text>Parent OSF Project</Text>
          <Link href={`https://osf.io/${data.osfRepo}`} isExternal>
            {`https://osf.io/${data.osfRepo}`} <ExternalLinkIcon mx="2px" />
          </Link>
          <Text>OSF Data Component</Text>
          <Link href={`https://osf.io/${data.osfComponent}`} isExternal>
            {`https://osf.io/${data.osfComponent}`}{" "}
            <ExternalLinkIcon mx="2px" />
          </Link>
          <Text>Completed Sessions</Text>
          <Text>{data.sessions}</Text>
          <Text>Number of Conditions</Text>
          <Text>{data.nConditions}</Text>
          <Text>
            This experiment is currently{" "}
            <Tag
              size="sm"
              variant="solid"
              colorScheme={data.active ? "green" : "red"}
            >
              <TagLabel>{data.active ? "Active" : "Inactive"}</TagLabel>
            </Tag>
          </Text>
          {data.active ? (
            <Button
              variant={"solid"}
              colorScheme="red"
              onClick={()=>deactivateExperiment(expId)}
            >
              Deactivate Experiment
            </Button>
          ) : (
            <Button
              variant={"solid"}
              colorScheme="green"
              onClick={()=>activateExperiment(expId)}
            >
              Activate Experiment
            </Button>
          )}
        </Stack>
      )}
    </>
  );
}

function ExperimentTitle({ title, onSubmit }) {
 
  function EditableControls() {
    const {
      isEditing,
      getSubmitButtonProps,
      getCancelButtonProps,
      getEditButtonProps,
    } = useEditableControls();

    return isEditing ? (
      <>
        <IconButton icon={<CheckIcon />} {...getSubmitButtonProps()} />
        <IconButton icon={<CloseIcon />} {...getCancelButtonProps()} />
      </>
    ) : (
      <IconButton size="sm" icon={<EditIcon />} {...getEditButtonProps()} />
    );
  }

  return (
    <Editable
      textAlign="left"
      defaultValue={title}
      fontSize="2xl"
      isPreviewFocusable={false}
      onSubmit={onSubmit}
    >
      <EditablePreview />
      {/* Here is the custom input */}
      <Input as={EditableInput} />
      <EditableControls />
    </Editable>
  );
}


async function activateExperiment(expId){
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        active: true,
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}

async function deactivateExperiment(expId){
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        active: false,
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}

async function updateExperimentTitle(newTitle, expId){
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        title: newTitle
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}