import { render, screen, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

const mockGetIdToken = jest.fn(() => Promise.resolve("id-token-123"));
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1", getIdToken: () => mockGetIdToken() } },
  db: {},
}));

// UserContext is re-provided per test via <UserContext.Provider value={...}>
// so signed-in vs signed-out can vary within this file without re-mocking
// the module.
jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({ user: null, loading: false }),
}));

const mockPush = jest.fn();
let mockQuery = {};
jest.mock("next/router", () => ({
  useRouter: () => ({ query: mockQuery, push: mockPush, isReady: true }),
}));

import { UserContext } from "../lib/context";
import ConnectCallbackPage from "../pages/oauth2/connect";

function renderPage({ user = { uid: "user-1" } } = {}) {
  return render(
    <ChakraProvider value={system}>
      <UserContext.Provider value={{ user, loading: false }}>
        <ConnectCallbackPage />
      </UserContext.Provider>
    </ChakraProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdToken.mockClear();
  mockGetIdToken.mockImplementation(() => Promise.resolve("id-token-123"));
  global.fetch = jest.fn();
  localStorage.clear();
  mockQuery = {};
});

describe("oauth2/connect callback page", () => {
  it("9. happy path posts to connectprovider and routes to /admin/account on success", async () => {
    mockQuery = { code: "auth-code-1", state: "state-abc" };
    localStorage.setItem("latestCSRFToken", "state-abc");
    localStorage.setItem("providerConnectFlow", "gdrive");
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    renderPage();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/connectprovider");
    expect(JSON.parse(options.body)).toEqual({
      provider: "gdrive",
      code: "auth-code-1",
      state: "state-abc",
      uid: "user-1",
      idToken: "id-token-123",
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/admin/account")
    );
  });

  it("10. state mismatch shows error UI and does not call connectprovider", async () => {
    mockQuery = { code: "auth-code-1", state: "state-abc" };
    localStorage.setItem("latestCSRFToken", "different-state");
    localStorage.setItem("providerConnectFlow", "gdrive");
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    renderPage();

    // Copy changed from the raw "Invalid state parameter. Possible CSRF
    // attack." to a calm, actionable message (DESIGN.md / PRODUCT.md
    // "consequence before mechanism") -- assert on the new wording rather
    // than the old machine text.
    await waitFor(() =>
      expect(
        screen.getByText(/expired|out of order/i)
      ).toBeInTheDocument()
    );
    expect(
      screen.getByRole("link", { name: /admin.*account|account/i })
    ).toHaveAttribute("href", "/admin/account");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("11. signed-out user shows error UI with a sign-in link and does not call connectprovider", async () => {
    mockQuery = { code: "auth-code-1", state: "state-abc" };
    localStorage.setItem("latestCSRFToken", "state-abc");
    localStorage.setItem("providerConnectFlow", "gdrive");
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    renderPage({ user: null });

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /sign in/i })
      ).toBeInTheDocument()
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("12. a provider's access_denied is a neutral cancellation, not an error alert", async () => {
    mockQuery = { error: "access_denied" };

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/cancelled the connection/i)).toBeInTheDocument()
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("13. opening the page with no code/state shows an error with a way back instead of spinning forever", async () => {
    mockQuery = {};

    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText(/start the connection again/i)
      ).toBeInTheDocument()
    );
    expect(
      screen.getByRole("link", { name: /account/i })
    ).toHaveAttribute("href", "/admin/account");
  });
});
