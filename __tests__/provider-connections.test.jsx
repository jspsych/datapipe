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

// ProviderConnections reads router.query.connected (set by
// pages/oauth2/connect.js on a successful redirect back from a provider's
// consent screen) to show its "Linked <Provider> successfully." banner, and
// calls router.replace to strip the param afterward. `mockRouterQuery` is
// read live by the `useRouter` mock below, so a test sets it before
// rendering rather than passing it as a prop -- this component has no such
// prop, exactly like the real next/router hook it replaces.
let mockRouterQuery = {};
const mockRouterReplace = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({
    isReady: true,
    pathname: "/admin/account",
    query: mockRouterQuery,
    replace: (...args) => mockRouterReplace(...args),
  }),
}));

const mockGetDocs = jest.fn(() =>
  Promise.resolve({ docs: [] })
);
jest.mock("firebase/firestore", () => ({
  doc: jest.fn(() => ({})),
  setDoc: jest.fn(() => Promise.resolve()),
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  getDocs: (...args) => mockGetDocs(...args),
}));

import ProviderConnections from "../components/account/ProviderConnections";

// The users/{uid} document arrives as a PROP now -- pages/admin/account.js
// owns the single subscription and passes it down, so there is no
// useDocumentData call left in this component to mock.
function renderComponent(data = { connectedAccounts: {} }) {
  return render(
    <ChakraProvider value={system}>
      <ProviderConnections data={data} />
    </ChakraProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdToken.mockClear();
  mockGetIdToken.mockImplementation(() => Promise.resolve("id-token-123"));
  mockGetDocs.mockClear();
  mockGetDocs.mockResolvedValue({ docs: [] });
  mockRouterQuery = {};
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

  it("static-token provider: Save success shows a dismissible 'Linked ... successfully.' banner", async () => {
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
      target: { value: "tok-abc" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^Save Dataverse connection$/i })
    );

    await waitFor(() =>
      expect(
        screen.getByText("Linked Dataverse successfully.")
      ).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /^Dismiss$/i }));
    expect(
      screen.queryByText("Linked Dataverse successfully.")
    ).not.toBeInTheDocument();
  });

  it("OAuth2 redirect return: a `connected` query param shows the banner and is stripped via router.replace", async () => {
    // Mirrors what pages/oauth2/connect.js does on a successful redirect
    // round trip: it pushes back here with ?connected=<providerId> because
    // it unmounts entirely (the researcher left for the provider's consent
    // screen), so a query param is the only channel back to this component.
    mockRouterQuery = { connected: "gdrive", next: "/admin/new" };

    renderComponent();

    expect(
      screen.getByText("Linked Google Drive successfully.")
    ).toBeInTheDocument();

    // The param is stripped immediately so a refresh never replays the
    // banner -- other params (e.g. `next`) are preserved.
    expect(mockRouterReplace).toHaveBeenCalledWith(
      { pathname: "/admin/account", query: { next: "/admin/new" } },
      undefined,
      { shallow: true }
    );

    fireEvent.click(screen.getByRole("button", { name: /^Dismiss$/i }));
    expect(
      screen.queryByText("Linked Google Drive successfully.")
    ).not.toBeInTheDocument();
  });

  it("static-token provider: Save stays disabled until both fields are filled", async () => {
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

  it("8. connected: shows Connected status; Disconnect opens a confirmation dialog, and confirming posts to disconnectprovider", async () => {
    const connectedData = { connectedAccounts: { gdrive: true } };
    mockGetDocs.mockResolvedValue({
      docs: [{ data: () => ({ storageProvider: "gdrive" }) }],
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    renderComponent(connectedData);

    expect(screen.getByText(/Connected/i)).toBeInTheDocument();

    // Clicking Disconnect only opens the confirmation dialog -- no request
    // yet, and the row button is neutral now (red is reserved for
    // irreversible actions), not the confirm button inside the dialog.
    fireEvent.click(screen.getByRole("button", { name: /^Disconnect Google Drive$/i }));
    expect(global.fetch).not.toHaveBeenCalled();

    expect(
      await screen.findByText(/1 experiment is set up to send data to Google Drive/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/disconnectprovider");
    expect(JSON.parse(options.body)).toEqual({
      provider: "gdrive",
      uid: "user-1",
      idToken: "id-token-123",
    });
  });

  it("disconnect dialog: zero experiments shows the reassuring zero-count copy", async () => {
    const connectedData = { connectedAccounts: { gdrive: true } };
    mockGetDocs.mockResolvedValue({ docs: [] });

    renderComponent(connectedData);
    fireEvent.click(screen.getByRole("button", { name: /^Disconnect Google Drive$/i }));

    expect(
      await screen.findByText(/No experiments are currently using this connection/i)
    ).toBeInTheDocument();
  });

  it(
    "disconnect dialog: a failed disconnect stays open and shows the error",
    async () => {
    const connectedData = { connectedAccounts: { gdrive: true } };
      mockGetDocs.mockResolvedValue({ docs: [] });
      global.fetch.mockResolvedValue({ ok: false });

      renderComponent(connectedData);
      fireEvent.click(screen.getByRole("button", { name: /^Disconnect Google Drive$/i }));
      await screen.findByText(/No experiments are currently using this connection/i);

      fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/i }));

      expect(
        await screen.findByText(/Could not reach DataPipe/i)
      ).toBeInTheDocument();
      // Dialog is still open -- Cancel is still on screen.
      expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeInTheDocument();
    },
    // This test's full round trip -- open, resolve the count query, submit,
    // reject the fetch, re-render the error inside the dialog -- occasionally
    // outran Jest's default 5000ms per-test budget under a heavily parallel
    // full-suite run (many worker processes contending for CPU), even though
    // it passes quickly in isolation. The component isn't slow; the CI
    // scheduler sometimes is, so this test gets more room rather than being
    // left flaky.
    15000
  );
});
