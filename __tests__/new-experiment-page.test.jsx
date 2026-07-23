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

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = global.fetch.mock.calls[0];
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
