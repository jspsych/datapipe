// Frontend registry of non-OSF storage providers. OSF is deliberately NOT
// included here -- it keeps its bespoke legacy UI (identity flow, PAT flow,
// existing new-experiment form, existing dashboard links). Adding a new
// provider (e.g. figshare) should only require a new entry in this map.
export const STORAGE_PROVIDERS = {
  gdrive: {
    id: "gdrive",
    name: "Google Drive",
    isConnected: (userDoc) => !!userDoc?.connectedAccounts?.gdrive,
    containerLink: (exp) =>
      `https://drive.google.com/drive/folders/${exp.providerContainer?.folderId}`,
    containerLabel: "Google Drive Folder",
    containerLinkText: "Open folder",
  },
};
