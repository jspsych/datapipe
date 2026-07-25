import { pickDriveFolder } from "../lib/google-picker";

// Flushes the microtask queue (all chained Promise .then callbacks that were
// already scheduled) without needing to know exactly how many hops deep the
// module's internal promise chain is.
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("pickDriveFolder", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete window.gapi;
    delete window.google;
  });

  it("injects the Google API script only once across multiple calls, and resolves/cancels via the picker callback", async () => {
    const appendChildSpy = jest.spyOn(document.body, "appendChild");

    let capturedCallback;
    const fakePicker = { setVisible: jest.fn() };
    const fakeGoogle = {
      picker: {
        ViewId: { FOLDERS: "folders" },
        Action: { PICKED: "picked", CANCEL: "cancel" },
        DocsView: jest.fn().mockImplementation(() => ({
          setMimeTypes: jest.fn().mockReturnThis(),
          setSelectFolderEnabled: jest.fn().mockReturnThis(),
          setIncludeFolders: jest.fn().mockReturnThis(),
        })),
        PickerBuilder: jest.fn().mockImplementation(() => ({
          addView: jest.fn().mockReturnThis(),
          setOAuthToken: jest.fn().mockReturnThis(),
          setDeveloperKey: jest.fn().mockReturnThis(),
          setAppId: jest.fn().mockReturnThis(),
          setCallback: jest.fn(function (cb) {
            capturedCallback = cb;
            return this;
          }),
          build: jest.fn(() => fakePicker),
        })),
      },
    };
    const fakeGapi = {
      load: jest.fn((_name, { callback }) => callback()),
    };

    // Simulate the real <script src="apis.google.com/js/api.js"> tag: once
    // it's appended to the DOM, it would set window.gapi and fire "load".
    appendChildSpy.mockImplementation((node) => {
      if (node.tagName === "SCRIPT") {
        window.gapi = fakeGapi;
        window.google = fakeGoogle;
        node.dispatchEvent(new Event("load"));
      }
      return node;
    });

    // First call: user cancels the picker.
    const firstPick = pickDriveFolder({
      accessToken: "token-1",
      apiKey: "key",
      appId: "app-id",
    });
    await flushMicrotasks();
    expect(typeof capturedCallback).toBe("function");
    capturedCallback({ action: fakeGoogle.picker.Action.CANCEL });
    await expect(firstPick).resolves.toBeNull();

    // Second call: user picks a folder.
    const secondPick = pickDriveFolder({
      accessToken: "token-2",
      apiKey: "key",
      appId: "app-id",
    });
    await flushMicrotasks();
    capturedCallback({
      action: fakeGoogle.picker.Action.PICKED,
      docs: [{ id: "folder-1", name: "My Folder" }],
    });
    await expect(secondPick).resolves.toEqual({
      id: "folder-1",
      name: "My Folder",
    });

    const scriptAppends = appendChildSpy.mock.calls.filter(
      ([node]) => node.tagName === "SCRIPT"
    );
    expect(scriptAppends).toHaveLength(1);
  });
});
