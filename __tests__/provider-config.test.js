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

describe("zenodo: which Zenodo a deployment points at", () => {
  // NEXT_PUBLIC_ZENODO_ENV is read at module scope, so each case has to
  // re-import with the value already set. jest.resetModules + a dynamic
  // require is the only way to exercise more than one deployment shape.
  function loadWith(zenodoEnv) {
    let mod;
    jest.isolateModules(() => {
      const prior = process.env.NEXT_PUBLIC_ZENODO_ENV;
      if (zenodoEnv === undefined) {
        delete process.env.NEXT_PUBLIC_ZENODO_ENV;
      } else {
        process.env.NEXT_PUBLIC_ZENODO_ENV = zenodoEnv;
      }
      mod = require("../lib/provider-config").STORAGE_PROVIDERS;
      if (prior === undefined) {
        delete process.env.NEXT_PUBLIC_ZENODO_ENV;
      } else {
        process.env.NEXT_PUBLIC_ZENODO_ENV = prior;
      }
    });
    return mod;
  }

  it("points production at the real zenodo.org", () => {
    expect(loadWith("").zenodo.containerLink({})).toBe(
      "https://zenodo.org/deposit/undefined"
    );
  });

  it("points the test deployment at the sandbox", () => {
    // The whole reason this setting exists: without it the test site creates
    // real depositions on the live service using the researcher's real
    // account.
    expect(loadWith("sandbox.").zenodo.containerLink({})).toBe(
      "https://sandbox.zenodo.org/deposit/undefined"
    );
  });

  it("falls back to production when the variable is absent entirely", () => {
    // An unset variable must never resolve to something like
    // "https://undefinedzenodo.org", and defaulting to sandbox would be worse
    // -- a misconfigured production deploy would silently write nowhere real.
    expect(loadWith(undefined).zenodo.containerLink({})).toBe(
      "https://zenodo.org/deposit/undefined"
    );
  });

  it("containerLink follows the container's host, not the current deployment", () => {
    // Same rule as dataverse above. An experiment created before a deployment
    // was switched still lives where it was created, so its link has to follow
    // the data rather than today's configuration.
    const url = loadWith("sandbox.").zenodo.containerLink({
      providerContainer: {
        serverUrl: "https://zenodo.org",
        depositionId: 5551212,
      },
    });
    expect(url).toBe("https://zenodo.org/deposit/5551212");
  });

  it("containerLink falls back to the deployment host for a container with no serverUrl", () => {
    const url = loadWith("sandbox.").zenodo.containerLink({
      providerContainer: { depositionId: 42 },
    });
    expect(url).toBe("https://sandbox.zenodo.org/deposit/42");
  });
});
