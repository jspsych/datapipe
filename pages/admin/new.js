import AuthCheck from "../../components/AuthCheck";
import { doc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useContext, useState } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import Link from "next/link";
import Router from "next/router";
import { createExperiment, createProviderExperiment } from "../../lib/experiment-creation";
import { pickDriveFolder } from "../../lib/google-picker";
import { STORAGE_PROVIDERS } from "../../lib/provider-config";
import {
  Button,
  Stack,
  HStack,
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

  const [title, setTitle] = useState("");
  const [osfRepo, setOsfRepo] = useState("");
  const [osfComponentName, setOsfComponentName] = useState("");
  const [region, setRegion] = useState("us");

  const [provider, setProvider] = useState("osf");
  const [gdriveTitle, setGdriveTitle] = useState("");
  const [gdriveTitleError, setGdriveTitleError] = useState(false);
  const [gdriveSubmitting, setGdriveSubmitting] = useState(false);
  const [gdriveError, setGdriveError] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [folderPickerLoading, setFolderPickerLoading] = useState(false);

  const [data, loading, error] = useDocumentData(doc(db, "users", user.uid));

  const isValid = data && (data.usingPersonalToken ? data.osfTokenValid : data.refreshToken !== "");
  const gdriveConnected = STORAGE_PROVIDERS.gdrive.isConnected(data);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setOsfError(false);

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
        title,
        osfRepo,
        osfComponentName,
        region,
        uid: auth.currentUser.uid,
        nConditions: 1,
        useValidation: true,
        allowJSON: true,
        allowCSV: true,
        useSessionLimit: false,
        maxSessions: 1,
      });

      Router.push(`/admin/${result.experimentId}`);
    } catch (err) {
      console.error(err);
      setIsSubmitting(false);
      setOsfError(true);
    }
  };

  const handleGdriveSubmit = async () => {
    setGdriveSubmitting(true);
    setGdriveError(null);

    if (gdriveTitle.length === 0) {
      setGdriveTitleError(true);
      setGdriveSubmitting(false);
      return;
    }

    try {
      const result = await createProviderExperiment(
        "gdrive",
        gdriveTitle,
        selectedFolder?.id
      );
      Router.push(`/admin/${result.experimentId}`);
    } catch (err) {
      console.error(err);
      setGdriveSubmitting(false);
      setGdriveError(err.message);
    }
  };

  const handleChooseFolder = async () => {
    setFolderPickerLoading(true);
    setGdriveError(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("User not authenticated");
      }
      const idToken = await user.getIdToken();

      const response = await fetch("/api/getprovideraccesstoken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "gdrive",
          uid: user.uid,
          idToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || `Failed to get Google Drive access: ${response.status}`
        );
      }

      const folder = await pickDriveFolder({
        accessToken: data.accessToken,
        apiKey: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
        appId: process.env.NEXT_PUBLIC_GDRIVE_PROJECT_NUMBER,
      });

      if (folder) {
        setSelectedFolder(folder);
      }
    } catch (err) {
      console.error(err);
      setGdriveError(err.message);
    } finally {
      setFolderPickerLoading(false);
    }
  };

  const handleClearFolder = () => {
    setSelectedFolder(null);
  };

  return (
    <>
      {loading && <Spinner color="brandTeal.500" size={"xl"} />}
      {!loading && (
        <Stack gap={6} w="100%" maxW="540px" px={4}>
          <Heading>Create a New Experiment</Heading>

          <Field.Root>
            <Field.Label>Where should data be stored?</Field.Label>
            <HStack gap={6} mt={2} role="radiogroup" aria-label="Where should data be stored?">
              <HStack as="label" gap={2} cursor="pointer">
                <input
                  type="radio"
                  name="storage-provider"
                  value="osf"
                  checked={provider === "osf"}
                  onChange={() => setProvider("osf")}
                />
                <Text>OSF</Text>
              </HStack>
              <HStack as="label" gap={2} cursor="pointer">
                <input
                  type="radio"
                  name="storage-provider"
                  value="gdrive"
                  checked={provider === "gdrive"}
                  onChange={() => setProvider("gdrive")}
                />
                <Text>Google Drive</Text>
              </HStack>
            </HStack>
          </Field.Root>

          {provider === "osf" && isValid && (
            <>
              <Field.Root invalid={titleError}>
                <Field.Label>Title</Field.Label>
                <Input
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleError(false);
                  }}
                />
                <Field.ErrorText color="red.400">
                  This field is required
                </Field.ErrorText>
              </Field.Root>
              <Field.Root invalid={osfError}>
                <Field.Label>Existing OSF Project</Field.Label>
                <Group attached>
                  <InputAddon bgColor={"greyBackground"}>
                    {`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/`}
                  </InputAddon>
                  <Input
                    type="text"
                    value={osfRepo}
                    onChange={(e) => setOsfRepo(e.target.value)}
                  />
                </Group>
                <Field.ErrorText color="red.400">
                  Cannot connect to this OSF component
                </Field.ErrorText>
              </Field.Root>
              <Field.Root invalid={dataComponentError}>
                <Field.Label>New OSF Data Component Name</Field.Label>
                <Input
                  type="text"
                  value={osfComponentName}
                  onChange={(e) => {
                    setOsfComponentName(e.target.value);
                    setDataComponentError(false);
                  }}
                />
                <Field.ErrorText color="red.400">
                  This field is required
                </Field.ErrorText>
                <Field.HelperText color="gray">
                  DataPipe will create a new component with this name in the OSF
                  project and store all data in it.
                </Field.HelperText>
              </Field.Root>
              <Field.Root>
                <Field.Label>Storage Location</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  >
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
                onClick={handleSubmit}
                loading={isSubmitting}
                colorPalette={"brandTeal"}
              >
                Create
              </Button>
            </>
          )}

          {provider === "osf" && !isValid && (
            <VStack gap={3}>
              <Text color="gray.400" textAlign="center">
                DataPipe sends experiment data directly to your OSF project.
                Connect your OSF account to get started.
              </Text>
              <Link href="/admin/account">
                <Button variant={"solid"} colorPalette={"brandTeal"} size={"lg"}>
                  Connect OSF Account
                </Button>
              </Link>
            </VStack>
          )}

          {provider === "gdrive" && !gdriveConnected && (
            <VStack gap={3}>
              <Text color="gray.400" textAlign="center">
                DataPipe sends experiment data directly to your Google Drive.
                Connect your Google Drive account to get started.
              </Text>
              <Link href="/admin/account">
                <Button variant={"solid"} colorPalette={"brandTeal"} size={"lg"}>
                  Connect Google Drive Account
                </Button>
              </Link>
            </VStack>
          )}

          {provider === "gdrive" && gdriveConnected && (
            <>
              {gdriveError && (
                <Text color="red.400" fontSize="sm">
                  {gdriveError}
                </Text>
              )}
              <Field.Root invalid={gdriveTitleError}>
                <Field.Label>Title</Field.Label>
                <Input
                  type="text"
                  value={gdriveTitle}
                  onChange={(e) => {
                    setGdriveTitle(e.target.value);
                    setGdriveTitleError(false);
                  }}
                />
                <Field.ErrorText color="red.400">
                  This field is required
                </Field.ErrorText>
              </Field.Root>
              <Field.Root>
                <Field.Label>Parent Drive Folder (optional)</Field.Label>
                <HStack gap={3}>
                  <Button
                    variant="outline"
                    size="md"
                    loading={folderPickerLoading}
                    onClick={handleChooseFolder}
                  >
                    Choose Drive folder
                  </Button>
                  {selectedFolder && (
                    <HStack gap={2}>
                      <Text fontSize="sm">{selectedFolder.name}</Text>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={handleClearFolder}
                      >
                        Clear
                      </Button>
                    </HStack>
                  )}
                </HStack>
                <Field.HelperText color="gray">
                  {selectedFolder
                    ? "The experiment's data folder will be created inside this folder."
                    : "If not set, the experiment's data folder will be created in My Drive/DataPipe."}
                </Field.HelperText>
              </Field.Root>
              <Button
                onClick={handleGdriveSubmit}
                loading={gdriveSubmitting}
                colorPalette={"brandTeal"}
              >
                Create
              </Button>
            </>
          )}
        </Stack>
      )}
    </>
  );
}
