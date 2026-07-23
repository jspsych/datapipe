import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

const mockGetIdToken = jest.fn(() => Promise.resolve("id-token-123"));
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1", getIdToken: () => mockGetIdToken() } },
  db: {},
}));

jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({
    user: { uid: "user-1" },
    loading: false,
  }),
}));

jest.mock("firebase/firestore", () => ({
  doc: jest.fn(() => ({})),
  setDoc: jest.fn(() => Promise.resolve()),
}));

jest.mock("react-firebase-hooks/firestore", () => ({
  useDocumentData: jest.fn(),
}));

import { useDocumentData } from "react-firebase-hooks/firestore";
import ProviderConnections from "../components/account/ProviderConnections";

function renderComponent() {
  return render(
    <ChakraProvider value={system}>
      <ProviderConnections />
    </ChakraProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdToken.mockClear();
  mockGetIdToken.mockImplementation(() => Promise.resolve("id-token-123"));
  global.fetch = jest.fn();
  localStorage.clear();

  // window.location.assign is not implemented by jsdom's navigation stub
  // (calling the real one throws "Not implemented: navigation"). Replace
  // the whole `location` object with a plain mock so `.assign` is spy-able;
  // `delete` + reassignment is the standard jsdom workaround since
  // `window.location` is configurable on jsdom's global (unlike real
  // browsers).
  delete window.location;
  window.location = { assign: jest.fn(), href: "" };
});

describe("ProviderConnections", () => {
  it("7. not connected: Connect click generates state, stores CSRF+flow, and redirects", async () => {
    useDocumentData.mockReturnValue([{ connectedAccounts: {} }, false, undefined]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          state: "state-abc",
          authorizeUrl: "https://accounts.google.com/o/oauth2/authorize?client_id=x",
        }),
    });

    renderComponent();

    expect(
      screen.getByRole("button", { name: /Connect/i })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Connect/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(process.env.NEXT_PUBLIC_GENERATE_STATE);
    expect(JSON.parse(options.body)).toEqual({ provider: "gdrive" });

    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/authorize?client_id=x"
      )
    );
    expect(localStorage.getItem("latestCSRFToken")).toBe("state-abc");
    expect(localStorage.getItem("providerConnectFlow")).toBe("gdrive");
  });

  it("8. connected: shows Connected status + Disconnect; click posts to disconnectprovider", async () => {
    useDocumentData.mockReturnValue([
      { connectedAccounts: { gdrive: true } },
      false,
      undefined,
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    renderComponent();

    expect(screen.getByText(/Connected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Disconnect/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/disconnectprovider");
    expect(JSON.parse(options.body)).toEqual({
      provider: "gdrive",
      uid: "user-1",
      idToken: "id-token-123",
    });
  });
});
