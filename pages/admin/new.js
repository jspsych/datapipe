import AuthCheck from "../../components/AuthCheck";
import { doc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useContext, useEffect, useState } from "react";
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
  Textarea,
  Spinner,
  Group,
  InputAddon,
  VStack,
  Text,
  NativeSelect,
  Alert,
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
  const [providerTitle, setProviderTitle] = useState("");
  const [providerTitleError, setProviderTitleError] = useState(false);
  const [providerSubmitting, setProviderSubmitting] = useState(false);
  const [providerError, setProviderError] = useState(null);
  // Researcher-supplied container fields (see lib/provider-config.js's
  // containerInputFields), keyed by field name. Reset on provider change so
  // switching providers never carries stale values across (e.g. a
  // half-filled Dataverse form leaking into a later Dataverse selection).
  const [containerValues, setContainerValues] = useState({});
  const [containerFieldErrors, setContainerFieldErrors] = useState({});
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [folderPickerLoading, setFolderPickerLoading] = useState(false);
  // Non-blocking, researcher-facing advisories about the connected
  // provider's installation (e.g. a Dataverse server too old to honor
  // tabIngest suppression -- see functions/src/providers/dataverse.ts's
  // setupWarnings). Cleared on every provider change so a warning from one
  // provider never carries over and is momentarily shown against another.
  const [providerWarnings, setProviderWarnings] = useState([]);

  const [data, loading, error] = useDocumentData(doc(db, "users", user.uid));

  const isValid = data && (data.usingPersonalToken ? data.osfTokenValid : data.refreshToken !== "");
  const providerConnected = STORAGE_PROVIDERS[provider]?.isConnected(data);

  const handleProviderChange = (newProvider) => {
    setProvider(newProvider);
    setContainerValues({});
    setContainerFieldErrors({});
    // A picked Drive folder is meaningless to any other provider, and it is
    // sent as the top-level parentFolderId on submit -- without this reset,
    // picking a folder and then switching to Dataverse would post a Drive
    // folder id on a Dataverse create. (The server folds parentFolderId in
    // unconditionally and Dataverse's adapter ignores parentId, so it was
    // harmless, but sending it at all is wrong.) The title deliberately
    // survives a provider change: it describes the study, not the storage.
    setSelectedFolder(null);
    setProviderWarnings([]);
  };

  // Fetch setup warnings for the selected provider: on every provider
  // change, and on initial mount when a non-osf, already-connected provider
  // is preselected. Never fires for osf (it has no StorageProvider adapter,
  // hence no setupWarnings) and never fires while the provider is not yet
  // connected (there is no resolvable token to check against). A failed
  // fetch is silent (console only) -- this is advisory only and must never
  // block or error the form.
  useEffect(() => {
    if (provider === "osf" || !providerConnected) {
      setProviderWarnings([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) return;
        const idToken = await currentUser.getIdToken();

        const response = await fetch("/api/providersetupwarnings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, uid: currentUser.uid, idToken }),
        });
        const body = await response.json();

        if (!cancelled) {
          setProviderWarnings(response.ok && Array.isArray(body.warnings) ? body.warnings : []);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setProviderWarnings([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provider, providerConnected]);

  const handleContainerValueChange = (name, value) => {
    setContainerValues((prev) => ({ ...prev, [name]: value }));
    setContainerFieldErrors((prev) => ({ ...prev, [name]: false }));
  };

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

  const handleProviderSubmit = async () => {
    setProviderSubmitting(true);
    setProviderError(null);

    if (providerTitle.length === 0) {
      setProviderTitleError(true);
      setProviderSubmitting(false);
      return;
    }

    // Client-side required-field check, mirroring create-experiment.ts's own
    // rule (a field is missing when its trimmed value is empty). This is a
    // UX nicety only -- the server still validates authoritatively against
    // its own containerInput declaration.
    const fields = STORAGE_PROVIDERS[provider]?.containerInputFields || [];
    const fieldErrors = {};
    let hasMissingField = false;
    for (const field of fields) {
      const value = containerValues[field.name];
      if (field.required && (!value || value.trim().length === 0)) {
        fieldErrors[field.name] = true;
        hasMissingField = true;
      }
    }

    if (hasMissingField) {
      setContainerFieldErrors(fieldErrors);
      setProviderSubmitting(false);
      return;
    }

    // Send only the declared field names, and omit empty optional fields --
    // never spread arbitrary containerValues state.
    const researcherInput = {};
    for (const field of fields) {
      const value = containerValues[field.name];
      if (value && value.trim().length > 0) {
        researcherInput[field.name] = value;
      }
    }

    try {
      const result = await createProviderExperiment(
        provider,
        providerTitle,
        selectedFolder?.id,
        researcherInput
      );
      Router.push(`/admin/${result.experimentId}`);
    } catch (err) {
      console.error(err);
      setProviderSubmitting(false);
      setProviderError(err.message);
    }
  };

  const handleChooseFolder = async () => {
    setFolderPickerLoading(true);
    setProviderError(null);

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
      setProviderError(err.message);
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
              {/* OSF is deliberately hardcoded here and absent from
                  STORAGE_PROVIDERS -- it keeps its bespoke legacy UI (identity
                  OAuth flow, existing form below) rather than becoming a
                  generic provider option. */}
              <HStack as="label" gap={2} cursor="pointer">
                <input
                  type="radio"
                  name="storage-provider"
                  value="osf"
                  checked={provider === "osf"}
                  onChange={() => handleProviderChange("osf")}
                />
                <Text>OSF</Text>
              </HStack>
              {Object.values(STORAGE_PROVIDERS).map((p) => (
                <HStack as="label" gap={2} cursor="pointer" key={p.id}>
                  <input
                    type="radio"
                    name="storage-provider"
                    value={p.id}
                    checked={provider === p.id}
                    onChange={() => handleProviderChange(p.id)}
                  />
                  <Text>{p.name}</Text>
                </HStack>
              ))}
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

          {provider !== "osf" && !providerConnected && (
            <VStack gap={3}>
              <Text color="gray.400" textAlign="center">
                DataPipe sends experiment data directly to your{" "}
                {STORAGE_PROVIDERS[provider]?.name}. Connect your{" "}
                {STORAGE_PROVIDERS[provider]?.name} account to get started.
              </Text>
              <Link href="/admin/account">
                <Button variant={"solid"} colorPalette={"brandTeal"} size={"lg"}>
                  Connect {STORAGE_PROVIDERS[provider]?.name} Account
                </Button>
              </Link>
            </VStack>
          )}

          {provider !== "osf" && providerConnected && (
            <>
              {providerError && (
                <Text color="red.400" fontSize="sm">
                  {providerError}
                </Text>
              )}
              {providerWarnings.map((warning, index) => (
                <Alert.Root key={index} status="warning" variant="subtle" borderRadius="md">
                  <Alert.Indicator />
                  <Alert.Description>{warning}</Alert.Description>
                </Alert.Root>
              ))}
              <Field.Root invalid={providerTitleError}>
                <Field.Label>Title</Field.Label>
                <Input
                  type="text"
                  value={providerTitle}
                  onChange={(e) => {
                    setProviderTitle(e.target.value);
                    setProviderTitleError(false);
                  }}
                />
                <Field.ErrorText color="red.400">
                  This field is required
                </Field.ErrorText>
              </Field.Root>

              {STORAGE_PROVIDERS[provider]?.containerInputFields.map((field) => (
                <Field.Root key={field.name} invalid={!!containerFieldErrors[field.name]}>
                  <Field.Label>{field.label}</Field.Label>
                  {field.multiline ? (
                    <Textarea
                      value={containerValues[field.name] || ""}
                      placeholder={field.placeholder}
                      onChange={(e) =>
                        handleContainerValueChange(field.name, e.target.value)
                      }
                    />
                  ) : (
                    <Input
                      type="text"
                      value={containerValues[field.name] || ""}
                      placeholder={field.placeholder}
                      onChange={(e) =>
                        handleContainerValueChange(field.name, e.target.value)
                      }
                    />
                  )}
                  <Field.ErrorText color="red.400">
                    This field is required
                  </Field.ErrorText>
                </Field.Root>
              ))}

              {/* The Google Picker "choose a folder" UI stays gated to gdrive
                  specifically -- it is a Google product loaded from Google's
                  JS SDK, not a generic provider capability, so it does not
                  belong in the containerInputFields render above. */}
              {provider === "gdrive" && (
                <Field.Root>
                  <Field.Label>Parent Drive Folder (optional)</Field.Label>
                  <HStack gap={3}>
                    <Button
                      variant="outline"
                      colorPalette="brandTeal"
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
              )}

              <Button
                onClick={handleProviderSubmit}
                loading={providerSubmitting}
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
