import { customAlphabet } from "nanoid";
import AuthCheck from "../../components/AuthCheck";
import {
  doc,
  setDoc,
  getDoc,
  writeBatch,
  arrayUnion,
} from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useContext, useState } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import Link from "next/link";
import Router from "next/router";
import {
  Button,
  Stack,
  Heading,
  FormControl,
  FormLabel,
  Input,
  Spinner,
  InputGroup,
  InputLeftAddon,
  Switch,
  NumberInputStepper,
  NumberInputField,
  NumberIncrementStepper,
  NumberDecrementStepper,
  NumberInput,
  CheckboxGroup,
  Checkbox,
  FormErrorMessage,
  VStack,
  Text,
} from "@chakra-ui/react";

export default function NewExperimentPage({}) {
  return (
    <AuthCheck>
      <NewExperimentForm />
    </AuthCheck>
  );
}

function NewExperimentForm() {
  const { user } = useContext(UserContext);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [osfError, setOsfError] = useState(false);
  const [conditionToggle, setConditionToggle] = useState(false);
  const [sessionToggle, setSessionToggle] = useState(false);
  const [validationToggle, setValidationToggle] = useState(true);
  const [validationSettings, setValidationSettings] = useState(['json']);

  const [data, loading, error] = useDocumentData(doc(db, "users", user.uid));

  return (
    <>
      {loading && <Spinner color="green.500" size={"xl"} />}
      {data && data.osfTokenValid && (
        <Stack>
          <Heading>Create a New Experiment</Heading>
          <FormControl id="title">
            <FormLabel>Title</FormLabel>
            <Input type="text" />
          </FormControl>
          <FormControl id="osf-repo" isInvalid={osfError}>
            <FormLabel>Existing OSF Project</FormLabel>
            <InputGroup>
              <InputLeftAddon bgColor={"greyBackground"}>https://osf.io/</InputLeftAddon>
              <Input type="text" />
            </InputGroup>
            <FormErrorMessage color={"red"}>Cannot connect to this OSF component</FormErrorMessage>
          </FormControl>
          <FormControl id="osf-component-name">
            <FormLabel>New OSF Data Component Name</FormLabel>
            <Input type="text" />
          </FormControl>
          <FormControl id="enable-condition-assignment">
            <FormLabel>Enable condition assignment?</FormLabel>
            <Switch colorScheme={"brandTeal"} onChange={(e) => setConditionToggle(e.target.checked)} />
          </FormControl>
          {conditionToggle && (
            <FormControl id="condition-assignment">
              <FormLabel>How many conditions?</FormLabel>
              <NumberInput defaultValue={2} min={2}>
                <NumberInputField />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
            </FormControl>
          )}
          <FormControl id="enable-validation">
            <FormLabel>Enable data validation?</FormLabel>
            <Switch colorScheme={"brandTeal"} defaultChecked onChange={(e) => setValidationToggle(e.target.checked)} />
          </FormControl>
          {validationToggle && (
            <CheckboxGroup id="validation-settings" defaultValue={['json']} onChange={setValidationSettings} colorScheme="brandTeal">
              <Stack spacing={5} direction='row'>
                <Checkbox value='json'>Allow JSON</Checkbox>
                <Checkbox value='csv'>Allow CSV</Checkbox>
              </Stack>
            </CheckboxGroup>
          )}
          <FormControl id="enable-session-limit">
            <FormLabel>Enable session limit?</FormLabel>
            <Switch colorScheme={"brandTeal"} onChange={(e) => setSessionToggle(e.target.checked)} />
          </FormControl>
          {sessionToggle && (
            <FormControl id="session-limit">
              <FormLabel>How many total sessions?</FormLabel>
              <NumberInput defaultValue={100} min={1}>
                <NumberInputField />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
            </FormControl>
          )}
          <Button
            onClick={() => handleCreateExperiment(setIsSubmitting, setOsfError, validationSettings)}
            isLoading={isSubmitting}
            colorScheme={"brandTeal"}
          >
            Create
          </Button>
        </Stack>
      )}
      {data && !data.osfTokenValid && (
        <VStack>
          <Heading as="h2">Connect your OSF Account</Heading>
          <Text>
            Before you can create an experiment, you need to connect your OSF
            account. 
          </Text>
          <Link href="/admin/account">
            <Button variant={"solid"} colorScheme={"brandTeal"} size={"md"}>
              Connect OSF Account
            </Button>
          </Link>
        </VStack>
      )}
    </>
  );
}

async function handleCreateExperiment(setIsSubmitting, setOsfError, validationSettings) {
  setIsSubmitting(true);
  setOsfError(false);

  const user = auth.currentUser;
  const title = document.querySelector("#title").value;
  let osfRepo = document.querySelector("#osf-repo").value;
  const osfComponentName = document.querySelector("#osf-component-name").value;
  const nConditions = document.querySelector("#enable-condition-assignment").checked ? document.querySelector("#condition-assignment").value : 1;
  const useValidation = document.querySelector("#enable-validation").checked;
  const allowJSON = validationSettings.includes('json');
  const allowCSV = validationSettings.includes('csv');
  const useSessionLimit = document.querySelector("#enable-session-limit").checked;
  const maxSessions = document.querySelector("#enable-session-limit").checked ? document.querySelector("#session-limit").value : 0;

  const nanoid = customAlphabet(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    12
  );
  const id = nanoid();

  // check if OSF repo string contains https://osf.io/
  // and remove it if it does
  if(osfRepo.includes('https://osf.io/')){
    osfRepo = osfRepo.replace('https://osf.io/', '');
  }

  try {
    const userdoc = await getDoc(doc(db, `users/${user.uid}`));
    let osfToken = null;
    if (userdoc.exists()) {
      osfToken = userdoc.data().osfToken;
    }

    const osfResult = await fetch(
      `https://api.osf.io/v2/nodes/${osfRepo}/children/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${osfToken}`,
        },
        body: JSON.stringify({
          data: {
            type: "nodes",
            attributes: {
              title: osfComponentName,
              category: "data",
              description:
                "This node was automatically generated by DataPipe (https://pipe.jspsych.org/)",
            },
          },
        }),
      }
    );

    const nodeData = await osfResult.json();
    console.log(nodeData);

    if(nodeData.errors) {
      throw new Error(nodeData.errors);
    }

    const filesLink = nodeData.data.relationships.files.links.related.href;

    const filesResult = await fetch(filesLink, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${osfToken}`,
      },
    });

    const filesData = await filesResult.json();
    const uploadLink = filesData.data[0].links.upload;

    const batch = writeBatch(db);

    const experimentDoc = doc(db, "experiments", id);
    batch.set(experimentDoc, {
      title: title,
      osfRepo: osfRepo,
      osfComponent: nodeData.data.id,
      osfFilesLink: uploadLink,
      active: false,
      activeBase64: false,
      activeConditionAssignment: nConditions > 1,
      sessions: 0,
      limitSessions: useSessionLimit,
      maxSessions: maxSessions,
      id: id,
      owner: user.uid,
      nConditions: nConditions,
      currentCondition: 0,
      useValidation: useValidation,
      allowJSON: allowJSON,
      allowCSV: allowCSV,
      requiredFields: ['trial_type']
    });

    const userDoc = doc(db, `users/${user.uid}`);
    batch.update(userDoc, {
      experiments: arrayUnion(id),
    });

    await batch.commit();

    Router.push(`/admin/${id}`);
  } catch (error) {
    setIsSubmitting(false);
    //TODO: are there other errors that could be thrown here?
    setOsfError(true);
  }
}
