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
  Alert,
  AlertIcon,
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
      {data && (data.osfTokenValid || (data.googleDriveEnabled && data.googleDriveFolderId && data.googleDriveRefreshToken)) && (
        <Stack spacing={6} maxWidth="540px">
          <Heading>Create a New Experiment</Heading>
          
          {/* Export Method Status */}
          {data.osfTokenValid && data.googleDriveEnabled && data.googleDriveFolderId && (
            <Alert status="success">
              <AlertIcon />
              Both OSF and Google Drive export are configured. Data will be exported to both platforms.
            </Alert>
          )}
          
          {data.osfTokenValid && (!data.googleDriveEnabled || !data.googleDriveFolderId) && (
            <Alert status="info">
              <AlertIcon />
              OSF export is configured. Google Drive export is optional and can be configured in your account settings.
            </Alert>
          )}
          
          {!data.osfTokenValid && data.googleDriveEnabled && data.googleDriveFolderId && (
            <Alert status="info">
              <AlertIcon />
              Google Drive export is configured. OSF export is optional and can be configured in your account settings.
            </Alert>
          )}
          
          {data.googleDriveEnabled && !data.googleDriveFolderId && (
            <Alert status="warning">
              <AlertIcon />
              Google Drive export is enabled but no folder is configured. 
              <Link href="/admin/account" ml={2}>
                <Button size="sm" colorScheme="blue">
                  Configure Folder
                </Button>
              </Link>
            </Alert>
          )}
          <FormControl id="title" isInvalid={titleError}>
            <FormLabel>Title</FormLabel>
            <Input type="text" onChange={() => setTitleError(false)} />
            <FormErrorMessage color={"red"}>
              This field is required
            </FormErrorMessage>
          </FormControl>
          
          {/* OSF Configuration Fields - only show if OSF is configured */}
          {data.osfTokenValid && (
            <>
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
            </>
          )}
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
      {data && !data.osfTokenValid && (!data.googleDriveEnabled || !data.googleDriveFolderId) && (
        <VStack>
          <Heading as="h2">Connect your Export Account</Heading>
          <Text>
            Before you can create an experiment, you need to connect either your OSF account or Google Drive account for data export.
          </Text>
          <Link href="/admin/account">
            <Button variant={"solid"} colorScheme={"brandTeal"} size={"md"}>
              Configure Export Settings
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
  
  // Only get OSF field values if OSF is configured
  let osfRepo = "";
  let region = "us";
  let osfComponentName = "";
  
  // Check if user has OSF configured by looking for the form fields
  const osfRepoField = document.querySelector("#osf-repo");
  const regionField = document.querySelector("#osf-component-region");
  const componentNameField = document.querySelector("#osf-component-name");
  
  if (osfRepoField && regionField && componentNameField) {
    // OSF fields exist, so get their values
    osfRepo = osfRepoField.value;
    region = regionField.value;
    osfComponentName = componentNameField.value;
  }
  
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

  // Only validate OSF fields if they exist (user has OSF configured)
  if (osfRepoField && regionField && componentNameField) {
    if (osfComponentName.length === 0) {
      setDataComponentError(true);
      setIsSubmitting(false);
      return;
    }
  }

  const nanoid = customAlphabet(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    12
  );
  const id = nanoid();

  // check if OSF repo string contains https://osf.io/
  // and remove it if it does
  if (osfRepo && osfRepo.includes("https://osf.io/")) {
    osfRepo = osfRepo.replace("https://osf.io/", "");
  }

  try {
    const userdoc = await getDoc(doc(db, `users/${user.uid}`));
    let osfToken = null;
    let hasGoogleDrive = false;
    if (userdoc.exists()) {
      const userData = userdoc.data();
      osfToken = userData.osfToken;
      hasGoogleDrive = userData.googleDriveEnabled && userData.googleDriveFolderId && userData.googleDriveRefreshToken;
    }

    // If no OSF token but Google Drive is configured, we can still create the experiment
    if (!osfToken && !hasGoogleDrive) {
      throw new Error("No export method configured");
    }

    let osfFilesLink = null;
    let osfComponentId = null;

    // Only try to create OSF component if we have an OSF token
    if (osfToken) {
      const osfResult = await fetch(
        `https://api.osf.io/v2/nodes/${osfRepo}/children/?region=${region}`,
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

      osfComponentId = nodeData.data.id;
      const filesLink = nodeData.data.relationships.files.links.related.href;

      const filesResult = await fetch(filesLink, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${osfToken}`,
        },
      });

      const filesData = await filesResult.json();
      osfFilesLink = filesData.data[0].links.upload;
    }

    const batch = writeBatch(db);

    const experimentDoc = doc(db, "experiments", id);
    batch.set(experimentDoc, {
      title: title,
      osfRepo: osfRepo || null,
      osfComponent: osfComponentId || null,
      osfFilesLink: osfFilesLink || null,
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
