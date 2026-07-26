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
      screen.getByRole("button", { name: /^Connect Google Drive$/i })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Connect Google Drive$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/generateoauthstate");
    expect(JSON.parse(options.body)).toEqual({ provider: "gdrive" });

    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/authorize?client_id=x"
      )
    );
    expect(localStorage.getItem("latestCSRFToken")).toBe("state-abc");
    expect(localStorage.getItem("providerConnectFlow")).toBe("gdrive");
  });

  it("static-token provider: Connect opens an inline form instead of redirecting", async () => {
    useDocumentData.mockReturnValue([{ connectedAccounts: {} }, false, undefined]);

    renderComponent();

    fireEvent.click(screen.getByRole("button", { name: /^Connect Dataverse$/i }));

    // Federated: the researcher must say WHICH installation.
    expect(screen.getByLabelText(/Dataverse server URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/API token/i)).toBeInTheDocument();
    // No OAuth redirect for a static-token provider.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("static-token provider: Save posts token + serverUrl to connectstatictokenprovider", async () => {
    useDocumentData.mockReturnValue([{ connectedAccounts: {} }, false, undefined]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, provider: "dataverse" }),
    });

    renderComponent();
    fireEvent.click(screen.getByRole("button", { name: /^Connect Dataverse$/i }));

    fireEvent.change(screen.getByLabelText(/Dataverse server URL/i), {
      target: { value: "https://dataverse.harvard.edu" },
    });
    fireEvent.change(screen.getByLabelText(/API token/i), {
      target: { value: "  tok-abc  " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^Save Dataverse connection$/i })
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/connectstatictokenprovider");
    expect(JSON.parse(options.body)).toEqual({
      provider: "dataverse",
      uid: "user-1",
      idToken: "id-token-123",
      token: "tok-abc",
      serverUrl: "https://dataverse.harvard.edu",
    });
  });

  it("static-token provider: Save stays disabled until both fields are filled", async () => {
    useDocumentData.mockReturnValue([{ connectedAccounts: {} }, false, undefined]);

    renderComponent();
    fireEvent.click(screen.getByRole("button", { name: /^Connect Dataverse$/i }));

    const save = screen.getByRole("button", {
      name: /^Save Dataverse connection$/i,
    });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/API token/i), {
      target: { value: "tok-abc" },
    });
    // serverUrl still empty -- a federated provider cannot be addressed without it.
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Dataverse server URL/i), {
      target: { value: "https://dataverse.harvard.edu" },
    });
    expect(save).toBeEnabled();
  });

  it("static-token provider: a rejected server URL is explained, not surfaced verbatim", async () => {
    useDocumentData.mockReturnValue([{ connectedAccounts: {} }, false, undefined]);
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Invalid server URL" }),
    });

    renderComponent();
    fireEvent.click(screen.getByRole("button", { name: /^Connect Dataverse$/i }));
    fireEvent.change(screen.getByLabelText(/Dataverse server URL/i), {
      target: { value: "http://10.0.0.1" },
    });
    fireEvent.change(screen.getByLabelText(/API token/i), {
      target: { value: "tok-abc" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^Save Dataverse connection$/i })
    );

    // The backend's opaque "Invalid server URL" becomes actionable guidance,
    // and the form stays open so the value can be corrected.
    await waitFor(() =>
      expect(screen.getByText(/full https:\/\/ address/i)).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/Dataverse server URL/i)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /^Disconnect Google Drive$/i }));

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
