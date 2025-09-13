import AuthCheck from "../../components/AuthCheck";
import { doc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useContext, useState } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import Link from "next/link";
import Router from "next/router";
import { createExperiment } from "../../lib/experiment-creation";
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

  const isValid = data && (data.usingPersonalToken ? data.osfTokenValid : data.refreshToken !== "");

  return (
    <>
      {loading && <Spinner color="green.500" size={"xl"} />}
      {isValid && (
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
            <Select defaultValue="us" sx={{'> option': {background: 'black', color: 'white'}}}>
              <option value="us">United States</option>
              <option value="de-1">Germany - Frankfurt</option>
              <option value="au-1">Australia - Sydney</option>
              <option value="ca-1">Canada - Montreal</option>
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
      {!isValid && (
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
  const osfRepo = document.querySelector("#osf-repo").value;
  const region = document.querySelector("#osf-component-region").value;
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

  try {
    // Use the shared experiment creation utility
    const result = await createExperiment({
      title: title,
      osfRepo: osfRepo,
      osfComponentName: osfComponentName,
      region: region,
      uid: user.uid,
      nConditions: nConditions,
      useValidation: useValidation,
      allowJSON: allowJSON,
      allowCSV: allowCSV,
      useSessionLimit: useSessionLimit,
      maxSessions: maxSessions
    });

    Router.push(`/admin/${result.experimentId}`);
  } catch (error) {
    console.log(error);
    setIsSubmitting(false);
    setOsfError(true);
  }
}
