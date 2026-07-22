import {
  registerProvider,
  getProvider,
  listProviders,
  clearProvidersForTesting,
} from "../../lib/providers/registry.js";

function makeFakeProvider(id) {
  return {
    id,
    authMethod: "static-token",
    capabilities: {
      nativeSubfolders: false,
      supportsRegion: false,
      maxFileSizeBytes: null,
      quotaNote: null,
    },
    createDataContainer: async () => ({ provider: id }),
    writeSessionFile: async () => ({
      success: true,
      fileRef: { name: "test" },
      storedFilename: "test",
    }),
    updateFile: async () => ({
      success: true,
      fileRef: { name: "test" },
      storedFilename: "test",
    }),
    listFiles: async () => [],
  };
}

describe("providers registry", () => {
  beforeEach(() => {
    clearProvidersForTesting();
  });

  it("returns a registered provider from getProvider", () => {
    const provider = makeFakeProvider("osf");

    registerProvider(provider);

    expect(getProvider("osf")).toBe(provider);
  });

  it("throws when getProvider is called with an unknown id", () => {
    expect(() => getProvider("gdrive")).toThrow("Unknown storage provider: gdrive");
  });

  it("throws when registering a duplicate id", () => {
    registerProvider(makeFakeProvider("figshare"));

    expect(() => registerProvider(makeFakeProvider("figshare"))).toThrow(
      "Storage provider already registered: figshare"
    );
  });

  it("reflects registrations in listProviders", () => {
    expect(listProviders()).toEqual([]);

    registerProvider(makeFakeProvider("osf"));
    registerProvider(makeFakeProvider("dataverse"));

    expect(listProviders()).toEqual(["osf", "dataverse"]);
  });
});
