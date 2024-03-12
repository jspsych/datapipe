import { customAlphabet } from "nanoid";
import AuthCheck from "../../components/AuthCheck";
import { doc, getDoc, writeBatch, arrayUnion } from "firebase/firestore";
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
  FormErrorMessage,
  FormHelperText,
  VStack,
  Text,
  Select,
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
  const [titleError, setTitleError] = useState(false);
  const [dataComponentError, setDataComponentError] = useState(false);

  const [data, loading, error] = useDocumentData(doc(db, "users", user.uid));

  return (
    <>
      {loading && <Spinner color="green.500" size={"xl"} />}
      {data && data.osfTokenValid && (
        <Stack spacing={6} maxWidth="540px">
          <Heading>Create a New Experiment</Heading>
          <FormControl id="title" isInvalid={titleError}>
            <FormLabel>Title</FormLabel>
            <Input type="text" onChange={() => setTitleError(false)} />
            <FormErrorMessage color={"red"}>
              This field is required
            </FormErrorMessage>
          </FormControl>
          <FormControl id="osf-repo" isInvalid={osfError}>
            <FormLabel>Existing OSF Project</FormLabel>
            <InputGroup>
              <InputLeftAddon bgColor={"greyBackground"}>
                https://osf.io/
              </InputLeftAddon>
              <Input type="text" />
            </InputGroup>
            <FormErrorMessage color={"red"}>
              Cannot connect to this OSF component
            </FormErrorMessage>
          </FormControl>
          <FormControl id="osf-component-name" isInvalid={dataComponentError}>
            <FormLabel>New OSF Data Component Name</FormLabel>
            <Input type="text" onChange={() => setDataComponentError(false)} />
            <FormErrorMessage color={"red"}>
              This field is required
            </FormErrorMessage>
            <FormHelperText color="gray">
              DataPipe will create a new component with this name in the OSF
              project and store all data in it.
            </FormHelperText>
          </FormControl>
          <FormControl id="osf-component-region">
            <FormLabel>Storage Location</FormLabel>
            <Select placeholder="Select region">
              <option value="us">US</option>
              <option value="de-1">EU</option>
            </Select>
            <FormHelperText color="gray">
              Choose the region where the data will be stored.
            </FormHelperText>
          </FormControl>
          <Button
            onClick={() =>
              handleCreateExperiment(
                setIsSubmitting,
                setOsfError,
                setTitleError,
                setDataComponentError
              )
            }
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

async function handleCreateExperiment(
  setIsSubmitting,
  setOsfError,
  setTitleError,
  setDataComponentError
) {
  setIsSubmitting(true);
  setOsfError(false);

  const user = auth.currentUser;
  const title = document.querySelector("#title").value;
  let osfRepo = document.querySelector("#osf-repo").value;
  const osfComponentName = document.querySelector("#osf-component-name").value;
  const nConditions = 1;
  const useValidation = true;
  const allowJSON = true;
  const allowCSV = true;
  const useSessionLimit = false;
  const maxSessions = 1;

  if (title.length === 0) {
    setTitleError(true);
    setIsSubmitting(false);
    return;
  }

  if (osfComponentName.length === 0) {
    setDataComponentError(true);
    setIsSubmitting(false);
    return;
  }

  const nanoid = customAlphabet(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    12
  );
  const id = nanoid();

  // check if OSF repo string contains https://osf.io/
  // and remove it if it does
  if (osfRepo.includes("https://osf.io/")) {
    osfRepo = osfRepo.replace("https://osf.io/", "");
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

    if (nodeData.errors) {
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
      activeConditionAssignment: false,
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
      requiredFields: ["trial_type"],
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
