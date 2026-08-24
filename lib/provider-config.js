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
    // What the Title field on pages/admin/new.js actually names. Purely
    // presentational and client-only (like containerLabel above), with no
    // server counterpart: create-experiment.ts injects `title` into every
    // provider's containerInput generically and never knows what the provider
    // does with it.
    //
    // The second sentence is not a nicety. `title` is fixed at creation:
    // renaming an experiment (components/dashboard/Title.js) writes Firestore
    // only, and NO adapter implements a container rename -- so DataPipe's
    // title and the container's title diverge permanently after a rename,
    // and DataPipe never displays the container's real name. Until a rename
    // path exists, saying so here is the only warning a researcher gets.
    containerTitleHelp:
      "Names the folder DataPipe creates in your Drive. Renaming the experiment later will not rename the folder.",
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
    // See gdrive's containerTitleHelp for why the rename caveat is here.
    containerTitleHelp:
      "Names the dataset DataPipe creates in your collection. Renaming the experiment later will not retitle the dataset.",
    // Mirrors functions/src/providers/dataverse.ts's containerInput exactly
    // (labels, required-ness, placeholders, helper text). `description` gets
    // `multiline` because the server declares it inputType "textarea".
    containerInputFields: [
      {
        name: "collectionAlias",
        label: "Collection alias",
        required: true,
        placeholder: "my-lab",
        helperText:
          "The short name in your collection's URL -- the my-lab in dataverse.harvard.edu/dataverse/my-lab.",
      },
      {
        name: "authorName",
        label: "Author name",
        required: true,
        placeholder: "Lastname, Firstname",
        helperText: "Recorded as the dataset's author in its citation metadata.",
      },
      {
        name: "contactEmail",
        label: "Contact email",
        required: true,
        placeholder: "you@example.edu",
        helperText:
          "Dataverse publishes this on the dataset as the contact for questions about the data.",
      },
      {
        name: "description",
        label: "Description",
        required: true,
        multiline: true,
        helperText:
          "Shown on the dataset page. A sentence about what the experiment collects is enough.",
      },
      {
        name: "subject",
        label: "Subject",
        required: false,
        placeholder: "Social Sciences",
        helperText: "Dataverse requires one. Left blank, DataPipe sends Social Sciences.",
      },
    ],
  },
  zenodo: {
    id: "zenodo",
    name: "Zenodo",
    // OAuth2 since 2026-08-21, previously a pasted personal access token.
    // The switch is not cosmetic: an OAuth client_id is registered against ONE
    // Zenodo installation, so which Zenodo this deployment talks to is now
    // fixed by NEXT_PUBLIC_ZENODO_ENV ("" -> zenodo.org, "sandbox." -> the
    // sandbox) and by the matching server-side client credentials, rather than
    // being sent along with the researcher's token at connect time. Same
    // host-prefix shape as NEXT_PUBLIC_OSF_ENV, and for the same reason:
    // without it the test deployment writes real depositions to the live
    // service using the researcher's real account.
    authMethod: "oauth2",
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
    // See gdrive's containerTitleHelp for why the rename caveat is here. The
    // title is also editable on Zenodo itself while the deposition is still a
    // draft, which is the escape hatch DataPipe cannot offer yet.
    containerTitleHelp:
      "Names the deposition DataPipe creates in your Zenodo account. Renaming the experiment later will not retitle the deposition.",
    // Mirrors functions/src/providers/zenodo.ts's containerInput exactly --
    // including the "Author name" label on `creatorName`, which is unified
    // with Dataverse's `authorName` on purpose. See that adapter's comment.
    containerInputFields: [
      {
        name: "creatorName",
        label: "Author name",
        required: true,
        placeholder: "Lastname, Firstname",
        helperText: "Recorded as the deposition's creator. Zenodo needs one before you can publish.",
      },
      {
        name: "description",
        label: "Description",
        required: true,
        multiline: true,
        helperText:
          "Shown on the deposition page. A sentence about what the experiment collects is enough.",
      },
      {
        name: "affiliation",
        label: "Affiliation",
        required: false,
        placeholder: "Your institution",
        helperText: "Listed next to the author name on the deposition.",
      },
    ],
  },
};
