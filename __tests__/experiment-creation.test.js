// nanoid v5 ships ESM-only and isn't transformed by the default Jest config
// (node_modules is excluded); experiment-creation.js imports it at the top
// level for the (untested-here) OSF path, so it must be mocked even though
// createProviderExperiment itself never calls it.
jest.mock("nanoid", () => ({
  customAlphabet: () => () => "mocked-id",
}));

jest.mock("../lib/firebase", () => ({
  auth: { currentUser: null },
  db: {},
}));

// firebase/firestore's doc/writeBatch/arrayUnion (used by the untested-here
// OSF path in this module) must not touch a real Firestore instance.
jest.mock("firebase/firestore", () => ({
  doc: jest.fn(() => ({})),
  writeBatch: jest.fn(() => ({
    set: jest.fn(),
    update: jest.fn(),
    commit: jest.fn(() => Promise.resolve()),
  })),
  arrayUnion: jest.fn((v) => v),
}));

import { createProviderExperiment } from "../lib/experiment-creation";
import { auth } from "../lib/firebase";

function mockUser({ uid = "user-123", idToken = "id-token-abc" } = {}) {
  return {
    uid,
    getIdToken: jest.fn().mockResolvedValue(idToken),
  };
}

describe("createProviderExperiment", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
    auth.currentUser = null;
  });

  it("omits parentFolderId from the request body when not provided", async () => {
    auth.currentUser = mockUser();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ experimentID: "exp-1" }),
    });

    const result = await createProviderExperiment("gdrive", "My Experiment");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/createexperiment");
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      provider: "gdrive",
      title: "My Experiment",
      uid: "user-123",
      idToken: "id-token-abc",
    });
    expect(body.parentFolderId).toBeUndefined();
    expect(result).toEqual({ experimentId: "exp-1" });
  });

  it("forwards parentFolderId in the request body when provided", async () => {
    auth.currentUser = mockUser();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ experimentID: "exp-2" }),
    });

    const result = await createProviderExperiment(
      "gdrive",
      "My Experiment",
      "folder-xyz"
    );

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.parentFolderId).toBe("folder-xyz");
    expect(body).toEqual({
      provider: "gdrive",
      title: "My Experiment",
      uid: "user-123",
      idToken: "id-token-abc",
      parentFolderId: "folder-xyz",
    });
    expect(result).toEqual({ experimentId: "exp-2" });
  });

  it("omits parentFolderId when it is falsy (empty string)", async () => {
    auth.currentUser = mockUser();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ experimentID: "exp-3" }),
    });

    await createProviderExperiment("gdrive", "My Experiment", "");

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.parentFolderId).toBeUndefined();
  });

  it("throws when the user is not authenticated", async () => {
    auth.currentUser = null;

    await expect(
      createProviderExperiment("gdrive", "My Experiment")
    ).rejects.toThrow("User not authenticated");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws the server error message when the request fails", async () => {
    auth.currentUser = mockUser();
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    });

    await expect(
      createProviderExperiment("gdrive", "My Experiment")
    ).rejects.toThrow("Forbidden");
  });
});
