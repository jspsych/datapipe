import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// Mock firebase since test env doesn't have NEXT_PUBLIC_FIREBASE_CONFIG.
// auth.currentUser mirrors a signed-in user with a working getIdToken().
const mockGetIdToken = jest.fn(() => Promise.resolve("id-token-123"));
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1", getIdToken: () => mockGetIdToken() } },
  db: {},
}));

// Mock context to provide a signed-in user (this page is wrapped in AuthCheck).
jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({
    user: { uid: "user-1" },
    loading: false,
  }),
}));

// lib/experiment-creation.js (imported transitively by pages/admin/new.js)
// pulls in `nanoid`, which ships ESM-only and isn't transformed by Jest by
// default (`Cannot use import statement outside a module`). Mock it out
// rather than touching jest.config.js's transformIgnorePatterns.
jest.mock("nanoid", () => ({
  customAlphabet: () => () => "mocked-id",
}));

// firebase/firestore's `doc` (and friends used transitively by
// lib/experiment-creation.js) must not touch a real Firestore instance.
jest.mock("firebase/firestore", () => ({
  doc: jest.fn(() => ({})),
  writeBatch: jest.fn(() => ({
    set: jest.fn(),
    update: jest.fn(),
    commit: jest.fn(() => Promise.resolve()),
  })),
  arrayUnion: jest.fn((v) => v),
  setDoc: jest.fn(() => Promise.resolve()),
}));

// The page navigates via the `Router` singleton default export (see
// pages/admin/new.js: `import Router from "next/router"`), while AuthCheck
// uses the `useRouter()` hook. Mock both from the same module.
const mockPush = jest.fn();
jest.mock("next/router", () => ({
  __esModule: true,
  default: { push: (...args) => mockPush(...args) },
  useRouter: () => ({ push: mockPush, pathname: "/admin/new", query: {} }),
}));

jest.mock("react-firebase-hooks/firestore", () => ({
  useDocumentData: jest.fn(),
}));

// pickDriveFolder loads Google's Picker SDK from the network; stub it so the
// folder-selection flow is drivable in jsdom.
const mockPickDriveFolder = jest.fn();
jest.mock("../lib/google-picker", () => ({
  pickDriveFolder: (...args) => mockPickDriveFolder(...args),
}));

import { useDocumentData } from "react-firebase-hooks/firestore";
import NewExperimentPage from "../pages/admin/new";

function renderPage() {
  return render(
    <ChakraProvider value={system}>
      <NewExperimentPage />
    </ChakraProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdToken.mockClear();
  mockGetIdToken.mockImplementation(() => Promise.resolve("id-token-123"));
  global.fetch = jest.fn();
});

describe("NewExperimentPage — OSF path (pinned regression)", () => {
  it("2. default render shows the OSF form exactly as today", () => {
    useDocumentData.mockReturnValue([
      { refreshToken: "osf-refresh-token", usingPersonalToken: false },
      false,
      undefined,
    ]);

    renderPage();

    expect(screen.getByText("Existing OSF Project")).toBeInTheDocument();
    expect(
      screen.getByText("New OSF Data Component Name")
    ).toBeInTheDocument();
    expect(screen.getByText("Storage Location")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });
});

describe("NewExperimentPage — Google Drive provider selector", () => {
  // NOTE ON INTERACTION MECHANICS: the spec allows a RadioGroup or a Select
  // for "Where should data be stored?". These assertions target the option
  // label text via getByLabelText, which works for either control as long
  // as the GREEN implementation gives the Google Drive option an
  // accessible name of "Google Drive" (radio input's associated label, or
  // an <option>/aria-label on a Select). Adjust the query, not the intent,
  // if the chosen control needs a different accessible-name strategy.
  function selectGoogleDrive() {
    fireEvent.click(screen.getByLabelText(/Google Drive/i));
  }

  it("3. selecting Google Drive with no connection shows a connect CTA, no title-only submit", () => {
    useDocumentData.mockReturnValue([
      {
        refreshToken: "osf-refresh-token",
        connectedAccounts: {},
      },
      false,
      undefined,
    ]);

    renderPage();
    selectGoogleDrive();

    const cta = screen.getByRole("link", {
      name: /Connect Google Drive Account/i,
    });
    expect(cta).toHaveAttribute("href", "/admin/account");
    expect(
      screen.queryByRole("button", { name: /^Create$/i })
    ).not.toBeInTheDocument();
  });

  it("4. selecting Google Drive while connected shows only the title field + create button", () => {
    useDocumentData.mockReturnValue([
      {
        refreshToken: "osf-refresh-token",
        connectedAccounts: { gdrive: true },
      },
      false,
      undefined,
    ]);

    renderPage();
    selectGoogleDrive();

    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create$/i })).toBeInTheDocument();
    expect(
      screen.queryByText("Existing OSF Project")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("New OSF Data Component Name")
    ).not.toBeInTheDocument();
  });

  it("5. gdrive submit calls /api/createexperiment and navigates to /admin/<id> on success", async () => {
    useDocumentData.mockReturnValue([
      {
        refreshToken: "osf-refresh-token",
        connectedAccounts: { gdrive: true },
      },
      false,
      undefined,
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, experimentID: "exp123" }),
    });

    renderPage();
    selectGoogleDrive();

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "My Study" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));

    // Look up the createexperiment call by URL rather than assuming index 0:
    // selecting a connected provider also fires a background
    // /api/providersetupwarnings fetch (see pages/admin/new.js's
    // setup-warnings effect), which can land in the mock's call log before
    // this one.
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([callUrl]) => callUrl === "/api/createexperiment")
      ).toBe(true)
    );
    const [url, options] = global.fetch.mock.calls.find(
      ([callUrl]) => callUrl === "/api/createexperiment"
    );
    expect(url).toBe("/api/createexperiment");
    expect(JSON.parse(options.body)).toEqual({
      provider: "gdrive",
      title: "My Study",
      uid: "user-1",
      idToken: "id-token-123",
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/admin/exp123")
    );
  });

  it("6. gdrive submit failure renders an error message and does not navigate", async () => {
    useDocumentData.mockReturnValue([
      {
        refreshToken: "osf-refresh-token",
        connectedAccounts: { gdrive: true },
      },
      false,
      undefined,
    ]);
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Could not create Drive folder" }),
    });

    renderPage();
    selectGoogleDrive();

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "My Study" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Could not create Drive folder/i)
      ).toBeInTheDocument()
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("NewExperimentPage — Dataverse provider (provider-generic rendering)", () => {
  function selectDataverse() {
    fireEvent.click(screen.getByLabelText(/^Dataverse$/i));
  }

  function selectGoogleDrive() {
    fireEvent.click(screen.getByLabelText(/Google Drive/i));
  }

  function fillDataverseFields({
    collectionAlias = "my-lab",
    authorName = "Smith, Jane",
    contactEmail = "jane@example.edu",
    description = "A study about things",
    subject = "Social Sciences",
  } = {}) {
    fireEvent.change(screen.getByLabelText(/Collection alias/i), {
      target: { value: collectionAlias },
    });
    fireEvent.change(screen.getByLabelText(/Author name/i), {
      target: { value: authorName },
    });
    fireEvent.change(screen.getByLabelText(/Contact email/i), {
      target: { value: contactEmail },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: description },
    });
    fireEvent.change(screen.getByLabelText(/Subject/i), {
      target: { value: subject },
    });
  }

  it("the provider selector offers Dataverse", () => {
    useDocumentData.mockReturnValue([
      { refreshToken: "osf-refresh-token", connectedAccounts: {} },
      false,
      undefined,
    ]);

    renderPage();

    expect(screen.getByLabelText(/^Dataverse$/i)).toBeInTheDocument();
  });

  it("selecting Dataverse with no connection shows the connect CTA and no create form", () => {
    useDocumentData.mockReturnValue([
      { refreshToken: "osf-refresh-token", connectedAccounts: {} },
      false,
      undefined,
    ]);

    renderPage();
    selectDataverse();

    const cta = screen.getByRole("link", {
      name: /Connect Dataverse Account/i,
    });
    expect(cta).toHaveAttribute("href", "/admin/account");
    expect(
      screen.queryByRole("button", { name: /^Create$/i })
    ).not.toBeInTheDocument();
  });

  it("selecting a CONNECTED Dataverse renders the declared fields alongside Title", () => {
    useDocumentData.mockReturnValue([
      {
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true },
      },
      false,
      undefined,
    ]);

    renderPage();
    selectDataverse();

    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Collection alias/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Author name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Contact email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Subject/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create$/i })).toBeInTheDocument();
  });

  it("submitting with a required field blank does NOT call the API", () => {
    useDocumentData.mockReturnValue([
      {
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true },
      },
      false,
      undefined,
    ]);

    renderPage();
    selectDataverse();

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "My Dataverse Study" },
    });
    // Fill every declared field except the required authorName.
    fireEvent.change(screen.getByLabelText(/Collection alias/i), {
      target: { value: "my-lab" },
    });
    fireEvent.change(screen.getByLabelText(/Contact email/i), {
      target: { value: "jane@example.edu" },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: "A study about things" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("a full submit calls /api/createexperiment with researcherInput carrying exactly the five declared fields, and navigates on success", async () => {
    useDocumentData.mockReturnValue([
      {
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true },
      },
      false,
      undefined,
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, experimentID: "exp-dv-1" }),
    });

    renderPage();
    selectDataverse();

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "My Dataverse Study" },
    });
    fillDataverseFields();

    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));

    // Look up the createexperiment call by URL rather than assuming index 0
    // -- same reasoning as the gdrive submit test above.
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([callUrl]) => callUrl === "/api/createexperiment")
      ).toBe(true)
    );
    const [url, options] = global.fetch.mock.calls.find(
      ([callUrl]) => callUrl === "/api/createexperiment"
    );
    expect(url).toBe("/api/createexperiment");
    const body = JSON.parse(options.body);
    expect(body.provider).toBe("dataverse");
    expect(body.title).toBe("My Dataverse Study");
    expect(Object.keys(body.researcherInput).sort()).toEqual(
      ["authorName", "collectionAlias", "contactEmail", "description", "subject"].sort()
    );
    expect(body.researcherInput).toEqual({
      collectionAlias: "my-lab",
      authorName: "Smith, Jane",
      contactEmail: "jane@example.edu",
      description: "A study about things",
      subject: "Social Sciences",
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/admin/exp-dv-1")
    );
  });

  it("a picked Drive folder does not leak onto a Dataverse create", async () => {
    // Regression guard: selectedFolder is submitted as the top-level
    // parentFolderId, so it must be cleared when the provider changes --
    // otherwise a Drive folder id rides along on a Dataverse request.
    useDocumentData.mockReturnValue([
      {
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true, gdrive: true },
      },
      false,
      undefined,
    ]);
    global.fetch.mockImplementation((url) => {
      if (url.includes("/api/getprovideraccesstoken")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ accessToken: "drive-token" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ experimentId: "exp-no-leak" }),
      });
    });
    mockPickDriveFolder.mockResolvedValue({
      id: "leaky-folder-id",
      name: "leaky-folder",
    });

    renderPage();

    // Pick a Drive folder on the gdrive path.
    selectGoogleDrive();
    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "Leak check" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Choose Drive folder/i }));
    await waitFor(() =>
      expect(screen.getByText("leaky-folder")).toBeInTheDocument()
    );

    // Switch to Dataverse and submit.
    selectDataverse();
    fillDataverseFields();
    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const createCall = global.fetch.mock.calls.find(([url]) =>
      url.includes("/api/createexperiment")
    );
    const body = JSON.parse(createCall[1].body);
    expect(body.provider).toBe("dataverse");
    expect(body.parentFolderId).toBeUndefined();
  });

  it("switching provider away and back clears the entered values (no stale carry-over)", () => {
    useDocumentData.mockReturnValue([
      {
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true, gdrive: true },
      },
      false,
      undefined,
    ]);

    renderPage();
    selectDataverse();
    fillDataverseFields({ collectionAlias: "stale-lab" });

    expect(screen.getByLabelText(/Collection alias/i)).toHaveValue("stale-lab");

    selectGoogleDrive();
    selectDataverse();

    expect(screen.getByLabelText(/Collection alias/i)).toHaveValue("");
    expect(screen.getByLabelText(/Author name/i)).toHaveValue("");
    expect(screen.getByLabelText(/Contact email/i)).toHaveValue("");
    expect(screen.getByLabelText(/Description/i)).toHaveValue("");
    expect(screen.getByLabelText(/Subject/i)).toHaveValue("");
  });
});

describe("NewExperimentPage — provider setup warnings (Dataverse)", () => {
  function selectDataverse() {
    fireEvent.click(screen.getByLabelText(/^Dataverse$/i));
  }

  it("selecting a connected Dataverse shows a warning returned by /api/providersetupwarnings", async () => {
    useDocumentData.mockReturnValue([
      { refreshToken: "osf-refresh-token", connectedAccounts: { dataverse: true } },
      false,
      undefined,
    ]);
    // Dispatch by URL, per the file's existing convention (see the
    // Google-Drive-folder-leak test above), rather than a blanket
    // mockResolvedValue -- this endpoint is called alongside others.
    global.fetch.mockImplementation((url) => {
      if (url.includes("/api/providersetupwarnings")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              warnings: [
                "This Dataverse installation reports version 5.10, which predates Dataverse 5.11.",
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    renderPage();
    selectDataverse();

    await waitFor(() =>
      expect(screen.getByText(/predates Dataverse 5\.11/i)).toBeInTheDocument()
    );
  });

  it("an empty warnings array shows nothing", async () => {
    useDocumentData.mockReturnValue([
      { refreshToken: "osf-refresh-token", connectedAccounts: { dataverse: true } },
      false,
      undefined,
    ]);
    global.fetch.mockImplementation((url) => {
      if (url.includes("/api/providersetupwarnings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ warnings: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    renderPage();
    selectDataverse();

    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([callUrl]) => callUrl.includes("/api/providersetupwarnings"))
      ).toBe(true)
    );

    expect(screen.queryByText(/predates Dataverse/i)).not.toBeInTheDocument();
    // The rest of the connected-provider form still renders normally.
    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
  });

  it("a failed warnings fetch is silent -- the form still renders and submission is not blocked", async () => {
    useDocumentData.mockReturnValue([
      { refreshToken: "osf-refresh-token", connectedAccounts: { dataverse: true } },
      false,
      undefined,
    ]);
    global.fetch.mockImplementation((url) => {
      if (url.includes("/api/providersetupwarnings")) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, experimentID: "exp-warn-fail" }),
      });
    });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    renderPage();
    selectDataverse();

    // Let the failed warnings fetch settle before interacting further.
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([callUrl]) => callUrl.includes("/api/providersetupwarnings"))
      ).toBe(true)
    );

    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
    expect(screen.queryByText(/predates Dataverse/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "My Dataverse Study" },
    });
    fireEvent.change(screen.getByLabelText(/Collection alias/i), { target: { value: "my-lab" } });
    fireEvent.change(screen.getByLabelText(/Author name/i), { target: { value: "Smith, Jane" } });
    fireEvent.change(screen.getByLabelText(/Contact email/i), {
      target: { value: "jane@example.edu" },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: "A study about things" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));

    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([callUrl]) => callUrl === "/api/createexperiment")
      ).toBe(true)
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/admin/exp-warn-fail"));

    consoleErrorSpy.mockRestore();
  });
});
