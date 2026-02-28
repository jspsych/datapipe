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
  Field,
  Input,
  Spinner,
  Group,
  InputAddon,
  VStack,
  Text,
  NativeSelect,
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
        <Stack gap={6} maxWidth="540px">
          <Heading>Create a New Experiment</Heading>
          <Field.Root id="title" invalid={titleError}>
            <Field.Label>Title</Field.Label>
            <Input type="text" onChange={() => setTitleError(false)} />
            <Field.ErrorText color={"red"}>
              This field is required
            </Field.ErrorText>
          </Field.Root>
          <Field.Root id="osf-repo" invalid={osfError}>
            <Field.Label>Existing OSF Project</Field.Label>
            <Group attached>
              <InputAddon bgColor={"greyBackground"}>
                {`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/`}
              </InputAddon>
              <Input type="text" />
            </Group>
            <Field.ErrorText color={"red"}>
              Cannot connect to this OSF component
            </Field.ErrorText>
          </Field.Root>
          <Field.Root id="osf-component-name" invalid={dataComponentError}>
            <Field.Label>New OSF Data Component Name</Field.Label>
            <Input type="text" onChange={() => setDataComponentError(false)} />
            <Field.ErrorText color={"red"}>
              This field is required
            </Field.ErrorText>
            <Field.HelperText color="gray">
              DataPipe will create a new component with this name in the OSF
              project and store all data in it.
            </Field.HelperText>
          </Field.Root>
          <Field.Root id="osf-component-region">
            <Field.Label>Storage Location</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field defaultValue="us">
                <option value="us">United States</option>
                <option value="de-1">Germany - Frankfurt</option>
                <option value="au-1">Australia - Sydney</option>
                <option value="ca-1">Canada - Montreal</option>
              </NativeSelect.Field>
            </NativeSelect.Root>
            <Field.HelperText color="gray">
              Choose the region where the data will be stored.
            </Field.HelperText>
          </Field.Root>
          <Button
            onClick={() =>
              handleCreateExperiment(
                setIsSubmitting,
                setOsfError,
                setTitleError,
                setDataComponentError
              )
            }
            loading={isSubmitting}
            colorPalette={"brandTeal"}
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
            <Button variant={"solid"} colorPalette={"brandTeal"} size={"md"}>
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
