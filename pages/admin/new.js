import AuthCheck from "../../components/AuthCheck";
import { doc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useContext, useEffect, useRef, useState } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import Link from "next/link";
import Router from "next/router";
import { createProviderExperiment } from "../../lib/experiment-creation";
import { pickDriveFolder } from "../../lib/google-picker";
import { STORAGE_PROVIDERS } from "../../lib/provider-config";
import { normalizeContactEmail } from "../../lib/contact-email";
import { PROVIDER_ICONS } from "../../components/ProviderIcons";
import {
  Button,
  Stack,
  HStack,
  Field,
  Input,
  Textarea,
  Skeleton,
  RadioGroup,
  VStack,
  Text,
  Alert,
} from "@chakra-ui/react";
import PageHeader from "../../components/ui/PageHeader";
import GuidanceLine from "../../components/ui/GuidanceLine";
import FormErrorAlert from "../../components/ui/FormErrorAlert";

// The title survives the round trip to account settings and back.
//
// A new signup cannot create an experiment until a storage provider is
// connected, so the most common path through this form is: type a title, be
// told to connect a provider, leave, come back. Before this, the typed title
// was simply gone, and the researcher had no sign they had been mid-task.
// sessionStorage (not localStorage) so it is scoped to the tab and the visit.
const DRAFT_TITLE_KEY = "datapipe:new-experiment-title";

function readDraftTitle() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(DRAFT_TITLE_KEY) || "";
  } catch {
    // Private-browsing modes and locked-down profiles can throw on access.
    // A lost draft is a nuisance; a crashed create form is a blocked
    // researcher, so this failure is genuinely ignorable.
    return "";
  }
}

function writeDraftTitle(value) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(DRAFT_TITLE_KEY, value);
    else window.sessionStorage.removeItem(DRAFT_TITLE_KEY);
  } catch {
    /* see readDraftTitle */
  }
}

// OSF is deliberately absent from this form. It is shutting down its projects
// feature, so no new experiment may be created against it -- a rule enforced
// in firestore.rules (the experiments `allow create` requires a
// storageProvider that is not 'osf'), not merely by the options offered here.
// Existing OSF experiments keep collecting; see lib/osf-sunset.js.
const DEFAULT_PROVIDER = Object.keys(STORAGE_PROVIDERS)[0];

// One labelling rule for every field on this form: required fields carry a
// bare label, optional ones say so. Before this the only field that admitted
// to being optional was the Drive folder picker -- and it said so by
// hardcoding "(optional)" into its label string -- so Subject and Affiliation
// looked exactly as mandatory as Description, which really is required.
function FieldLabel({ children, optional }) {
  return (
    <Field.Label>
      {children}
      {optional && (
        <Text as="span" color="fg.muted" fontWeight="normal" ms={1}>
          (optional)
        </Text>
      )}
    </Field.Label>
  );
}

// Account-level values that seed a provider field, so a researcher does not
// retype what DataPipe already holds.
//
// Deliberately narrow. `contactEmail` is the only containerInput field with an
// unambiguous account-level counterpart: users/{uid}.contactEmail is mandatory
// and gated by ContactEmailGate (components/AuthCheck.js), so it is always
// present by the time this form renders. Author name, collection alias and
// affiliation are just as stable per researcher, but nothing stores them yet
// -- putting them on the provider connection is the follow-up this map is
// shaped to absorb.
//
// A seed is a starting value, never a lock: Dataverse publishes datasetContact
// on the dataset, and the address a researcher wants public is not always the
// one DataPipe emails them at, so the field stays editable.
function prefillFor(fieldName, userDoc) {
  if (fieldName === "contactEmail") {
    return normalizeContactEmail(userDoc?.contactEmail) || "";
  }
  return "";
}

function seedContainerValues(providerId, userDoc) {
  const seeded = {};
  for (const field of STORAGE_PROVIDERS[providerId]?.containerInputFields || []) {
    const value = prefillFor(field.name, userDoc);
    if (value) seeded[field.name] = value;
  }
  return seeded;
}

export default function NewExperimentPage({}) {
  return (
    <AuthCheck>
      <NewExperimentForm />
    </AuthCheck>
  );
}

function NewExperimentForm() {
  const { user } = useContext(UserContext);

  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [providerTitle, setProviderTitle] = useState("");
  // Restored after mount rather than as lazy initial state: this page is
  // server-rendered, and reading sessionStorage during the first render would
  // produce a hydration mismatch.
  useEffect(() => {
    const draft = readDraftTitle();
    if (draft) setProviderTitle(draft);
  }, []);
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

  const [data, loading] = useDocumentData(doc(db, "users", user.uid));

  const providerConnected = STORAGE_PROVIDERS[provider]?.isConnected(data);

  // Whether the researcher has picked a provider by hand (clicked a radio),
  // as opposed to `provider` merely holding whatever this component's own
  // defaulting logic put there. Read by the pre-selection effect below so a
  // user's own choice -- even one made in the instant before the account
  // snapshot resolves -- is never clobbered by it.
  const userPickedProviderRef = useRef(false);

  // Seed the account-level prefills, and pre-select a connected storage
  // provider, ONCE, when the user document first arrives. handleProviderChange
  // re-seeds every later provider switch itself, so this only covers the
  // initial render, where `data` is still undefined.
  //
  // The pre-selection rule: with exactly one connected provider, preselect
  // it; with several, preselect the first in the radio group's own
  // left-to-right display order (Object.values(STORAGE_PROVIDERS) -- the same
  // order the JSX below iterates to render the radios); with none connected,
  // `provider` is left exactly as it already was (DEFAULT_PROVIDER) -- there
  // is nothing connected to prefer, so this is a no-op over today's behavior.
  // Never overrides a provider the researcher already picked by hand.
  //
  // Guarded by a ref rather than re-running on every `data` snapshot: this
  // page holds a live Firestore subscription, and any unrelated field changing
  // on users/{uid} mid-form would otherwise push the stored address (or the
  // pre-selected provider) back over whatever the researcher had already
  // typed or chosen. `...prev` last for the same reason.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !data) return;
    seededRef.current = true;

    // The provider whose container fields get seeded below: the one this
    // effect is about to select, if it selects one, otherwise whatever
    // `provider` already is. Computed rather than read back from state
    // because setProvider below will not be reflected in `provider` until the
    // next render, and seedContainerValues needs to seed the RIGHT provider's
    // fields in this same pass.
    let initialProvider = provider;
    if (!userPickedProviderRef.current) {
      const connected = Object.values(STORAGE_PROVIDERS).filter((p) =>
        p.isConnected(data)
      );
      if (connected.length > 0) {
        initialProvider = connected[0].id;
        setProvider(initialProvider);
      }
    }
    setContainerValues((prev) => ({
      ...seedContainerValues(initialProvider, data),
      ...prev,
    }));
  }, [data, provider]);

  const handleProviderChange = (newProvider) => {
    userPickedProviderRef.current = true;
    setProvider(newProvider);
    // Reset, then re-seed from the account for the NEW provider -- a bare {}
    // here would drop the prefilled contact email the moment someone switched
    // provider and switched back.
    setContainerValues(seedContainerValues(newProvider, data));
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
  // change, and on initial mount when an already-connected provider is
  // preselected. Never fires while the provider is not yet connected (there
  // is no resolvable token to check against). A failed fetch is silent
  // (console only) -- this is advisory only and must never block or error
  // the form.
  useEffect(() => {
    if (!providerConnected) {
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

  const handleProviderSubmit = async () => {
    setProviderSubmitting(true);
    setProviderError(null);

    // Trimmed, not raw. This value becomes the name of a real folder/dataset/
    // deposition in the researcher's own account, and a title of " " passed
    // both this check (length 1) and the server's (`!title` is false for a
    // space), creating a container named with a single space that DataPipe
    // then offers no way to rename.
    const trimmedTitle = providerTitle.trim();
    if (trimmedTitle.length === 0) {
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
    // never spread arbitrary containerValues state. Values are sent TRIMMED,
    // matching the check above: a field validated on its trimmed value and
    // then sent raw meant trailing whitespace reached provider metadata (a
    // Dataverse author of "Smith, Jane " is what gets cited).
    const researcherInput = {};
    for (const field of fields) {
      const value = containerValues[field.name];
      if (value && value.trim().length > 0) {
        researcherInput[field.name] = value.trim();
      }
    }

    try {
      const result = await createProviderExperiment(
        provider,
        trimmedTitle,
        selectedFolder?.id,
        researcherInput
      );
      writeDraftTitle("");
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
      {/* A bare centered spinner with no layout container made the page jump
          when content arrived (DESIGN.md §7: skeletons for content loading in
          place, spinners for actions). This holds the form's shape. */}
      {loading && (
        <Stack gap={6} w="100%" maxW="560px">
          <Skeleton height="40px" width="60%" />
          <Skeleton height="80px" />
          <Skeleton height="80px" />
        </Stack>
      )}
      {!loading && (
        // 560px, DESIGN.md §4's single-subject column. Was a stray 540px.
        <Stack gap={6} w="100%" maxW="560px">
          <PageHeader
            title="Create an experiment"
            purpose="An experiment gives you an ID to paste into your study, and a folder for its data to land in."
            backHref="/admin"
            backLabel="Back to experiments"
            mb={0}
          />

          {/* Chakra RadioGroup, not raw `<input type="radio">`. The native
              inputs inherited no focus ring, no palette and no sizing from
              the theme while sitting beside themed Switch controls.

              The group labels itself with `RadioGroup.Label` rather than
              sitting inside a `Field.Root` + `Field.Label`. Field.Label
              renders `htmlFor` pointing at the field's own control id, and
              RadioGroup does not consume field context -- so that label
              pointed at an element that does not exist, leaving the group
              with no accessible name at all. RadioGroup.Label wires
              `aria-labelledby` on the real `role="radiogroup"`. This also
              retires the hand-written `role="radiogroup"` + `aria-label` the
              old markup carried, which duplicated the visible label for
              screen readers. */}
          {/* mt={4} on top of the stack's gap={6} = 40px, DESIGN.md §4's
              routine-section distance. This page was ONE flat gap={6}: the
              page title, the provider decision, every field and the submit
              button were all 24px apart, so nothing on it was grouped. */}
          <RadioGroup.Root
            mt={4}
            name="storage-provider"
            value={provider}
            onValueChange={(e) => handleProviderChange(e.value)}
            colorPalette="brandGreen"
          >
            <RadioGroup.Label fontWeight="medium" color="fg">
              Where should data be stored?
            </RadioGroup.Label>
            <HStack gap={6} flexWrap="wrap" mt={2}>
              {Object.values(STORAGE_PROVIDERS).map((p) => {
                const Icon = PROVIDER_ICONS[p.id];
                return (
                  <RadioGroup.Item key={p.id} value={p.id}>
                    <RadioGroup.ItemHiddenInput />
                    {/* ItemIndicator, NOT a bare ItemControl. `ItemControl` is
                        an empty `aria-hidden` div: the recipe styles the ring
                        on it but the mark itself lives in `& .dot`, which only
                        Chakra's Radiomark renders -- and Radiomark is what
                        ItemIndicator mounts, with the item's `checked` state
                        passed in. With a bare ItemControl the selected provider
                        showed as a filled disc with no radio dot, reading as a
                        checkbox rather than a radio. */}
                    <RadioGroup.ItemIndicator />
                    {/* The icon is aria-hidden (baked into each mark in
                        components/ProviderIcons.js) and purely decorative --
                        ItemText's own text is what gives the item its
                        accessible name, unchanged from before this icon
                        existed. */}
                    <RadioGroup.ItemText>
                      <HStack gap={1.5} display="inline-flex">
                        {Icon && <Icon size="1.25em" />}
                        <Text as="span">{p.name}</Text>
                      </HStack>
                    </RadioGroup.ItemText>
                  </RadioGroup.Item>
                );
              })}
            </HStack>
            <GuidanceLine mt={2}>
              Data goes straight from your participants to this account.
              DataPipe never keeps a copy.
            </GuidanceLine>
          </RadioGroup.Root>

          {!providerConnected && (
            <VStack gap={3} mt={4} align="flex-start">
              <GuidanceLine>
                You cannot create an experiment until DataPipe has somewhere to
                put its data. Connecting your{" "}
                {STORAGE_PROVIDERS[provider]?.name} account takes a minute, and
                the title you have typed here will still be waiting when you
                come back.
              </GuidanceLine>
              <Button asChild variant="solid" colorPalette="brandGreen" size="md">
                {/* `next` is a forward-compatible hint for account settings to
                    offer a "return to creating your experiment" affordance.
                    It is inert until that page reads it; the sessionStorage
                    draft above is what actually saves the researcher's work
                    today. */}
                <Link href="/admin/account?next=/admin/new">
                  Connect {STORAGE_PROVIDERS[provider]?.name}
                </Link>
              </Button>
            </VStack>
          )}

          {providerConnected && (
            // A Stack, not a bare fragment: "describe the experiment" is a
            // section distinct from "choose where data goes" above it, and
            // mt={4} over the parent gap gives it the same 40px break.
            <Stack gap={6} mt={4}>
              {/* Was a bare `<Text color="red.400">` -- no role="alert", no
                  icon, no mapping, a raw adapter string shown verbatim.
                  FormErrorAlert is the app's one error surface (DESIGN.md
                  §6). */}
              <FormErrorAlert>{providerError}</FormErrorAlert>
              {providerWarnings.map((warning, index) => (
                <Alert.Root
                  key={index}
                  status="warning"
                  colorPalette="brandOrange"
                  variant="subtle"
                  borderRadius="md"
                >
                  <Alert.Indicator />
                  <Alert.Description>{warning}</Alert.Description>
                </Alert.Root>
              ))}
              <Field.Root invalid={providerTitleError}>
                <FieldLabel>Title</FieldLabel>
                <Input
                  type="text"
                  value={providerTitle}
                  onChange={(e) => {
                    setProviderTitle(e.target.value);
                    writeDraftTitle(e.target.value);
                    setProviderTitleError(false);
                  }}
                />
                {/* The one field on this form that names something in the
                    researcher's OWN account, and it said only "Title". What it
                    names differs per provider (folder / dataset / deposition)
                    and it is fixed at creation, so the copy comes from the
                    provider -- see containerTitleHelp in lib/provider-config.js. */}
                <Field.HelperText>
                  {STORAGE_PROVIDERS[provider]?.containerTitleHelp}
                </Field.HelperText>
                {/* `color="red.400"` dropped -- the Field recipe already owns
                    error text coloring, and the literal was a raw palette
                    step (DESIGN.md §8.5). */}
                <Field.ErrorText>This field is required</Field.ErrorText>
              </Field.Root>

              {STORAGE_PROVIDERS[provider]?.containerInputFields.map((field) => (
                <Field.Root key={field.name} invalid={!!containerFieldErrors[field.name]}>
                  <FieldLabel optional={!field.required}>{field.label}</FieldLabel>
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
                  {/* Every provider field now explains what the provider does
                      with it. These asks are not arbitrary -- all four required
                      Dataverse fields are ones Dataverse itself rejects a
                      dataset without -- but the form gave no way to tell that
                      from a field DataPipe invented, and "Collection alias"
                      was explained only in /docs/experiments. */}
                  {field.helperText && (
                    <Field.HelperText>{field.helperText}</Field.HelperText>
                  )}
                  <Field.ErrorText>This field is required</Field.ErrorText>
                </Field.Root>
              ))}

              {/* The Google Picker "choose a folder" UI stays gated to gdrive
                  specifically -- it is a Google product loaded from Google's
                  JS SDK, not a generic provider capability, so it does not
                  belong in the containerInputFields render above. */}
              {provider === "gdrive" && (
                <Field.Root>
                  {/* "(optional)" comes from FieldLabel now, not from a
                      hardcoded label string, so this field marks itself
                      optional the same way Subject and Affiliation do. */}
                  <FieldLabel optional>Parent Drive folder</FieldLabel>
                  <HStack gap={3}>
                    {/* Neutral outline, not green. DESIGN.md §5: one primary
                        per screen, and on this form the primary is Create.
                        Every other action is outline or ghost on gray. */}
                    <Button
                      variant="outline"
                      colorPalette="gray"
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
                  {/* `color="gray"` was the CSS named color #808080 --
                      4.19:1 on the dark page, under the body floor, and a raw
                      literal. The recipe's own fg.muted is 8.30:1 light /
                      9.14:1 dark. */}
                  <Field.HelperText>
                    {selectedFolder
                      ? "The experiment's data folder will be created inside this folder."
                      : "If not set, the experiment's data folder will be created in My Drive/DataPipe."}
                  </Field.HelperText>
                </Field.Root>
              )}

              {/* The submit sat exactly as far from the last field as the
                  fields sat from each other. */}
              <Button
                onClick={handleProviderSubmit}
                loading={providerSubmitting}
                colorPalette="brandGreen"
                mt={4}
              >
                Create experiment
              </Button>
            </Stack>
          )}
        </Stack>
      )}
    </>
  );
}
