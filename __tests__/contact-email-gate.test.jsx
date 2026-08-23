import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// Same mocking shape as __tests__/provider-connections.test.jsx: mock
// ../lib/firebase, ../lib/context, firebase/firestore, and
// react-firebase-hooks/firestore, then wrap in ChakraProvider.
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1" } },
  db: {},
}));

const mockUser = { uid: "user-1", email: "researcher@example.edu" };
jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({ user: null, loading: true }),
}));

const mockSetDoc = jest.fn(() => Promise.resolve());
jest.mock("firebase/firestore", () => ({
  doc: jest.fn(() => ({})),
  setDoc: (...args) => mockSetDoc(...args),
}));

jest.mock("react-firebase-hooks/firestore", () => ({
  useDocumentData: jest.fn(),
}));

// AuthCheck reads useRouter for the pathname passed to SignInForm and an
// effect that pushes fallbackRoute when signed out -- neither path is
// exercised by these tests (every case here is signed in), but the module
// still has to resolve.
jest.mock("next/router", () => ({
  __esModule: true,
  default: { push: jest.fn() },
  useRouter: () => ({ push: jest.fn(), pathname: "/admin" }),
}));

import { UserContext } from "../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import AuthCheck from "../components/AuthCheck";

function renderGated(userValue = { user: mockUser, loading: false }) {
  return render(
    <ChakraProvider value={system}>
      <UserContext.Provider value={userValue}>
        <AuthCheck>
          <div>Protected dashboard content</div>
        </AuthCheck>
      </UserContext.Provider>
    </ChakraProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetDoc.mockClear();
  mockSetDoc.mockResolvedValue();
});

describe("AuthCheck's contact-email gate", () => {
  it("users/{uid} doc with no contactEmail: gate copy renders, children absent", () => {
    useDocumentData.mockReturnValue([{ email: "" }, false, undefined]);

    renderGated();

    expect(screen.getByText("Add an email address")).toBeInTheDocument();
    expect(
      screen.getByText(/DataPipe needs a way to reach you/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Protected dashboard content")
    ).not.toBeInTheDocument();
  });

  it("users/{uid} doc with a valid contactEmail: children render, gate absent", () => {
    useDocumentData.mockReturnValue([
      { contactEmail: "lab@example.edu", contactEmailVerified: false },
      false,
      undefined,
    ]);

    renderGated();

    expect(screen.getByText("Protected dashboard content")).toBeInTheDocument();
    expect(screen.queryByText("Add an email address")).not.toBeInTheDocument();
  });

  it("synthetic OSF fallback address does not satisfy the gate", () => {
    // The case a naive truthiness check gets wrong -- oauth2-callback.ts
    // seeds this exact shape as a fallback, and it is undeliverable.
    useDocumentData.mockReturnValue([
      { contactEmail: "user-abc12@osf.io", email: "user-abc12@osf.io" },
      false,
      undefined,
    ]);

    renderGated();

    expect(screen.getByText("Add an email address")).toBeInTheDocument();
    expect(
      screen.queryByText("Protected dashboard content")
    ).not.toBeInTheDocument();
  });

  it("loading users/{uid}: neither the gate nor the children render", () => {
    useDocumentData.mockReturnValue([undefined, true, undefined]);

    renderGated();

    expect(screen.queryByText("Add an email address")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Protected dashboard content")
    ).not.toBeInTheDocument();
  });

  it("a users/{uid} read error fails OPEN: children render, not the gate", () => {
    useDocumentData.mockReturnValue([
      undefined,
      false,
      new Error("permission-denied"),
    ]);

    renderGated();

    expect(screen.getByText("Protected dashboard content")).toBeInTheDocument();
    expect(screen.queryByText("Add an email address")).not.toBeInTheDocument();
  });

  it("malformed input shows a field error and never calls setDoc", () => {
    useDocumentData.mockReturnValue([{ email: "" }, false, undefined]);

    renderGated();

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save and continue/i }));

    expect(screen.getByText(/Enter a valid email address/i)).toBeInTheDocument();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("a valid submit writes exactly the four allowed keys, contactEmailVerified false", async () => {
    useDocumentData.mockReturnValue([{ email: "" }, false, undefined]);

    renderGated();

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: "researcher@example.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save and continue/i }));

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled());

    const [, payload, options] = mockSetDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(
      [
        "contactEmail",
        "contactEmailVerified",
        "contactEmailUpdatedAt",
        "contactEmailSource",
      ].sort()
    );
    expect(payload.contactEmail).toBe("researcher@example.edu");
    expect(payload.contactEmailVerified).toBe(false);
    expect(options).toEqual({ merge: true });
  });

  it("has no control labelled Skip or Later -- there is no skip", () => {
    useDocumentData.mockReturnValue([{ email: "" }, false, undefined]);

    renderGated();

    expect(screen.queryByText(/^Skip$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Later$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /skip/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /later/i })
    ).not.toBeInTheDocument();
  });

  it("/admin/account's requireContactEmail={false} bypasses the gate entirely", () => {
    // Doc has no contactEmail at all -- would trip the gate on any other
    // route -- but requireContactEmail={false} must render children
    // unconditionally, without even subscribing to useDocumentData.
    useDocumentData.mockReturnValue([undefined, false, undefined]);

    render(
      <ChakraProvider value={system}>
        <UserContext.Provider value={{ user: mockUser, loading: false }}>
          <AuthCheck requireContactEmail={false}>
            <div>Account settings content</div>
          </AuthCheck>
        </UserContext.Provider>
      </ChakraProvider>
    );

    expect(screen.getByText("Account settings content")).toBeInTheDocument();
    expect(screen.queryByText("Add an email address")).not.toBeInTheDocument();
  });
});
