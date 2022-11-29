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
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  VStack,
  HStack,
  Code,
  Switch,
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
      <ExperimentPageContent experiment_id={experiment_id} />
    </AuthCheck>
  );
}

function ExperimentPageContent({ experiment_id }) {
  const [data, loading, error, snapshot, reload] = useDocumentData(
    doc(db, `experiments/${experiment_id}`)
  );

  return (
    <>
      {loading && <Spinner color="green.500" size={"xl"} />}
      {data && (
        <VStack align="start">
          <ExperimentTitle
            title={data.title}
            onSubmit={(newTitle) => {
              if (data.title !== newTitle) {
                updateExperimentTitle(newTitle, experiment_id);
              }
            }}
          />
          <Flex>
            <ExperimentEditForm data={data} />
            <CodeHints expId={experiment_id} />
          </Flex>
        </VStack>
      )}
    </>
  );
}

function ExperimentEditForm({ data }) {
  return (
    <Stack w="50%" pr={8} spacing={2}>
      <HStack justify="space-between">
        <Text fontSize="xl">Experiment ID</Text>
        <Text>{data.id}</Text>
      </HStack>
      <HStack justify="space-between">
        <Text>OSF Project</Text>
        <Link href={`https://osf.io/${data.osfRepo}`} isExternal>
          {`https://osf.io/${data.osfRepo}`} <ExternalLinkIcon mx="2px" />
        </Link>
      </HStack>
      <HStack justify="space-between">
        <Text>OSF Data Component</Text>
        <Link href={`https://osf.io/${data.osfComponent}`} isExternal>
          {`https://osf.io/${data.osfComponent}`} <ExternalLinkIcon mx="2px" />
        </Link>
      </HStack>
      <HStack justify="space-between">
        <Text>Completed Sessions</Text>
        <Text>{data.sessions}</Text>
      </HStack>
      <HStack justify="space-between">
        <Text>Number of Conditions</Text>
        <Text>{data.nConditions}</Text>
      </HStack>
      <FormControl as={HStack} justify="space-between">
        <FormLabel>Enable data collection?</FormLabel>
        <Switch colorScheme="green" size="md" isChecked={data.active} onChange={()=>toggleExperimentActive(data.id, data.active)}/>
      </FormControl>
    </Stack>
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
      <HStack spacing={2}>
        <IconButton
          size="sm"
          icon={<CheckIcon />}
          {...getSubmitButtonProps()}
        />
        <IconButton
          size="sm"
          icon={<CloseIcon />}
          {...getCancelButtonProps()}
        />
      </HStack>
    ) : (
      <IconButton size="sm" icon={<EditIcon />} {...getEditButtonProps()} />
    );
  }

  return (
    <Editable
      textAlign="left"
      defaultValue={title}
      fontSize="6xl"
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

async function toggleExperimentActive(expId, active){
  if(active){
    deactivateExperiment(expId)
  } else {
    activateExperiment(expId)
  }
}

async function activateExperiment(expId) {
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

async function deactivateExperiment(expId) {
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

async function updateExperimentTitle(newTitle, expId) {
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

function CodeHints({ expId }) {
  return (
    <Tabs variant="soft-rounded">
      <TabList>
        <Tab>jsPsych</Tab>
        <Tab>JavaScript</Tab>
      </TabList>

      <TabPanels>
        <TabPanel>
          <VStack alignItems={"start"}>
          <Text>Load the pipe plugin:</Text>
          <Code display="block">
            {`<script src="https://unpkg.com/@jspsych-contrib/jspsych-pipe"></script>`}
          </Code>
          <Text>Generate a unique filename:</Text>
          <Code display="block" whiteSpace={"pre-line"}>
            {`const subject_id = jsPsych.randomization.randomID(10);
              const filename = \`\${subject_id}.csv\`;
            `}
          </Code>
          <Text>To save data, add this trial to your timeline after all data is collected:</Text>
          <Code display="block" whiteSpace={"pre"}>
            {`
              const save_data = {
                type: jsPsychPipe,
                experiment_id: "${expId}",
                filename: filename,
                data: ()=>jsPsych.data.get().csv()
              };`
            }
          </Code>
          </VStack>
        </TabPanel>
        <TabPanel>
          <Text>
            To use this experiment in JavaScript, you will need to add the
            following code to your experiment:
          </Text>
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
