import { STORAGE_PROVIDERS } from "../lib/provider-config";

describe("STORAGE_PROVIDERS.gdrive", () => {
  it("isConnected is true when the user doc has connectedAccounts.gdrive", () => {
    expect(
      STORAGE_PROVIDERS.gdrive.isConnected({
        connectedAccounts: { gdrive: true },
      })
    ).toBe(true);
  });

  it("isConnected is false when connectedAccounts.gdrive is absent", () => {
    expect(STORAGE_PROVIDERS.gdrive.isConnected({ connectedAccounts: {} })).toBe(
      false
    );
    expect(STORAGE_PROVIDERS.gdrive.isConnected({})).toBe(false);
    expect(STORAGE_PROVIDERS.gdrive.isConnected(undefined)).toBe(false);
    expect(STORAGE_PROVIDERS.gdrive.isConnected(null)).toBe(false);
  });

  it("containerLink builds the Google Drive folder URL from providerContainer.folderId", () => {
    const url = STORAGE_PROVIDERS.gdrive.containerLink({
      providerContainer: { folderId: "folder-abc-123" },
    });
    expect(url).toBe(
      "https://drive.google.com/drive/folders/folder-abc-123"
    );
  });

  it("exposes a human-readable name and container label", () => {
    expect(STORAGE_PROVIDERS.gdrive.name).toBe("Google Drive");
    expect(STORAGE_PROVIDERS.gdrive.containerLabel).toBe(
      "Google Drive Folder"
    );
    expect(STORAGE_PROVIDERS.gdrive.containerLinkText).toBe("Open folder");
    expect(STORAGE_PROVIDERS.gdrive.id).toBe("gdrive");
  });

  it("declares authMethod oauth2 so the connect UI runs the redirect flow", () => {
    expect(STORAGE_PROVIDERS.gdrive.authMethod).toBe("oauth2");
  });

  it("does NOT include osf in the provider map (osf keeps its bespoke legacy UI)", () => {
    expect(STORAGE_PROVIDERS.osf).toBeUndefined();
  });
});

describe("STORAGE_PROVIDERS.dataverse", () => {
  it("declares authMethod static-token and needs a server URL (it is federated)", () => {
    expect(STORAGE_PROVIDERS.dataverse.authMethod).toBe("static-token");
    expect(STORAGE_PROVIDERS.dataverse.needsServerUrl).toBe(true);
  });

  it("isConnected tracks connectedAccounts.dataverse", () => {
    expect(
      STORAGE_PROVIDERS.dataverse.isConnected({
        connectedAccounts: { dataverse: true },
      })
    ).toBe(true);
    expect(
      STORAGE_PROVIDERS.dataverse.isConnected({ connectedAccounts: {} })
    ).toBe(false);
    expect(STORAGE_PROVIDERS.dataverse.isConnected(undefined)).toBe(false);
  });

  it("containerLink takes the host from the container, not a constant, and encodes the DOI", () => {
    // Dataverse is federated, so the dataset lives on whichever installation
    // the researcher connected -- the URL cannot be built from a fixed host.
    // Persistent ids contain slashes, so the DOI must be encoded to survive
    // as a query parameter.
    const url = STORAGE_PROVIDERS.dataverse.containerLink({
      providerContainer: {
        serverUrl: "https://dataverse.harvard.edu",
        persistentId: "doi:10.5072/FK2/J8SJZB",
      },
    });
    expect(url).toBe(
      "https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi%3A10.5072%2FFK2%2FJ8SJZB"
    );
  });

  it("exposes a human-readable name and container label", () => {
    expect(STORAGE_PROVIDERS.dataverse.name).toBe("Dataverse");
    expect(STORAGE_PROVIDERS.dataverse.containerLabel).toBe("Dataverse Dataset");
    expect(STORAGE_PROVIDERS.dataverse.containerLinkText).toBe("Open dataset");
    expect(STORAGE_PROVIDERS.dataverse.id).toBe("dataverse");
  });
});
