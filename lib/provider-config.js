// Frontend registry of non-OSF storage providers. OSF is deliberately NOT
// included here -- it keeps its bespoke legacy UI (identity flow, PAT flow,
// existing new-experiment form, existing dashboard links). Adding a new
// provider (e.g. figshare) should only require a new entry in this map.
//
// `authMethod` mirrors the backend StorageProvider field of the same name and
// tells the connect UI which flow to run: "oauth2" redirects to the provider's
// consent screen, "static-token" collects a pasted token (and, for federated
// providers, a server URL) in a form. See components/account/ProviderConnections.js.
//
// `containerInputFields` mirrors the SERVER-side `containerInput` declared on
// each adapter in functions/src/providers/*.ts (see ContainerInputField in
// functions/src/providers/types.ts). THE SERVER IS AUTHORITATIVE:
// create-experiment.ts validates a createDataContainer request against its
// own provider's containerInput and returns a 400 naming exactly the missing
// fields, regardless of what this file says. This client-side copy is
// PRESENTATIONAL ONLY -- it just decides which inputs pages/admin/new.js
// renders and does client-side required-field validation as a UX nicety --
// and it must be kept in sync by hand with functions/src/providers/*.ts
// whenever containerInput changes there. The duplication is deliberate:
// lib/ is bundled into the Next.js app and cannot import from functions/src/.
// Which Zenodo this DEPLOYMENT points at: "" on production -> zenodo.org,
// "sandbox." on the test site -> sandbox.zenodo.org. Same host-prefix shape as
// NEXT_PUBLIC_OSF_ENV.
//
// Resolved once, here, rather than inline at each use. The two uses below are
// evaluated at different times -- defaultServerUrl when this module loads,
// containerLink when it is called -- so reading process.env separately in each
// would let them disagree. Next inlines NEXT_PUBLIC_* at build time so that
// cannot bite in the browser, but it does in tests, which is where it showed
// up.
const ZENODO_HOST = `https://${process.env.NEXT_PUBLIC_ZENODO_ENV ?? ""}zenodo.org`;

export const STORAGE_PROVIDERS = {
  gdrive: {
    id: "gdrive",
    name: "Google Drive",
    authMethod: "oauth2",
    isConnected: (userDoc) => !!userDoc?.connectedAccounts?.gdrive,
    containerLink: (exp) =>
      `https://drive.google.com/drive/folders/${exp.providerContainer?.folderId}`,
    containerLabel: "Google Drive Folder",
    containerLinkText: "Open folder",
    // gdrive's only containerInput field (parentId) is "hidden" server-side --
    // supplied by the Google Picker, never typed into a rendered field -- so
    // there is nothing here for the new-experiment page to render.
    containerInputFields: [],
  },
  dataverse: {
    id: "dataverse",
    name: "Dataverse",
    authMethod: "static-token",
    // Dataverse is FEDERATED -- Harvard, Borealis, DataverseNL and the rest are
    // separate installations -- so the researcher supplies their server URL at
    // connect time and it is stored per-connection.
    needsServerUrl: true,
    serverUrlLabel: "Dataverse server URL",
    serverUrlPlaceholder: "https://dataverse.harvard.edu",
    tokenLabel: "API token",
    tokenHelp:
      "Create one under your Dataverse account's API Token tab. Tokens expire (often yearly) and cannot be renewed automatically, so you will need to reconnect when yours lapses.",
    isConnected: (userDoc) => !!userDoc?.connectedAccounts?.dataverse,
    // The dataset landing page lives on whichever installation holds it, so
    // the host comes off the container rather than a constant. The DOI is
    // encoded because persistent ids contain slashes
    // (doi:10.5072/FK2/J8SJZB).
    containerLink: (exp) =>
      `${exp.providerContainer?.serverUrl}/dataset.xhtml?persistentId=${encodeURIComponent(
        exp.providerContainer?.persistentId ?? ""
      )}`,
    containerLabel: "Dataverse Dataset",
    containerLinkText: "Open dataset",
    // Mirrors functions/src/providers/dataverse.ts's containerInput exactly
    // (labels, required-ness, placeholders). `description` gets `multiline`
    // because the server declares it inputType "textarea".
    containerInputFields: [
      { name: "collectionAlias", label: "Collection alias", required: true, placeholder: "my-lab" },
      { name: "authorName", label: "Author name", required: true, placeholder: "Lastname, Firstname" },
      { name: "contactEmail", label: "Contact email", required: true, placeholder: "you@example.edu" },
      { name: "description", label: "Description", required: true, multiline: true },
      { name: "subject", label: "Subject", required: false, placeholder: "Social Sciences" },
    ],
  },
  zenodo: {
    id: "zenodo",
    name: "Zenodo",
    authMethod: "static-token",
    // NOT federated, unlike Dataverse: a researcher never picks an
    // installation, so no field is rendered and this value is sent on their
    // behalf (see ProviderConnections.js's handleTokenConnect).
    //
    // It is still per-DEPLOYMENT, which is what NEXT_PUBLIC_ZENODO_ENV
    // controls: "" on production -> zenodo.org, "sandbox." on the test site ->
    // sandbox.zenodo.org. Same host-prefix shape as NEXT_PUBLIC_OSF_ENV, and
    // for the same reason -- without it the test deployment writes real
    // depositions to the live service using the researcher's real account.
    // The two Zenodos have entirely separate accounts and tokens, so a
    // sandbox token pasted into a production-pointed deployment is rejected
    // at connect time rather than silently misfiling data.
    needsServerUrl: false,
    defaultServerUrl: ZENODO_HOST,
    tokenLabel: "Personal access token",
    tokenHelp:
      "Create one under Applications → Personal access tokens in your Zenodo account settings. It needs the deposit:write and deposit:actions scopes. Zenodo tokens do not expire.",
    isConnected: (userDoc) => !!userDoc?.connectedAccounts?.zenodo,
    // Zenodo depositions stay unpublished while data is being collected, so
    // the researcher-facing link is the deposit editor rather than a public
    // record page (which does not exist until they publish).
    // Host comes from the CONTAINER, not from the env above, matching
    // dataverse's containerLink. The env only decides where NEW connections
    // point; an experiment created before the deployment was switched still
    // lives wherever it was created, and its link has to follow the data
    // rather than the current configuration.
    containerLink: (exp) =>
      `${exp.providerContainer?.serverUrl ?? ZENODO_HOST}/deposit/${exp.providerContainer?.depositionId}`,
    containerLabel: "Zenodo Deposition",
    containerLinkText: "Open deposition",
    // Mirrors functions/src/providers/zenodo.ts's containerInput exactly.
    containerInputFields: [
      { name: "creatorName", label: "Creator name", required: true, placeholder: "Lastname, Firstname" },
      { name: "description", label: "Description", required: true, multiline: true },
      { name: "affiliation", label: "Affiliation", required: false, placeholder: "Your institution" },
    ],
  },
};
