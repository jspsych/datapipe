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
    expect(STORAGE_PROVIDERS.gdrive.id).toBe("gdrive");
  });

  it("does NOT include osf in the provider map (osf keeps its bespoke legacy UI)", () => {
    expect(STORAGE_PROVIDERS.osf).toBeUndefined();
  });
});
