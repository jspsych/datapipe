import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// Same isolation strategy as __tests__/contact-email-gate.test.jsx: mock
// every collaborator SignInForm talks to directly, and stub out the
// federated-provider subtree entirely -- AuthProviderButtons pulls in
// lib/auth-providers.js, which reads real firebase/auth provider classes
// (GoogleAuthProvider.PROVIDER_ID etc.) at module load time, and this file
// only needs to exercise the email/password path.
const mockSignIn = jest.fn();
jest.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: (...args) => mockSignIn(...args),
}));

jest.mock("../lib/firebase", () => ({
  auth: {},
}));

const mockEnsureUserDocument = jest.fn();
jest.mock("../lib/user-bootstrap", () => ({
  ensureUserDocument: (...args) => mockEnsureUserDocument(...args),
}));

const mockPush = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: mockPush, pathname: "/admin" }),
}));

jest.mock("../components/auth/AuthProviderButtons", () => () => null);
jest.mock("../components/SignInWithOSF", () => () => null);

import SignInForm from "../components/SignInForm";

function renderForm() {
  return render(
    <ChakraProvider value={system}>
      <SignInForm routeAfterSignIn="/admin" />
    </ChakraProvider>
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/^Email$/i), {
    target: { value: "researcher@example.edu" },
  });
  fireEvent.change(screen.getByLabelText(/^Password$/i), {
    target: { value: "correct-horse-battery" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("SignInForm's password path", () => {
  it("calls ensureUserDocument with the signed-in user before navigating", async () => {
    const signedInUser = { uid: "user-1", email: "researcher@example.edu" };
    mockSignIn.mockResolvedValue({ user: signedInUser });
    mockEnsureUserDocument.mockResolvedValue(true);

    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/admin"));

    expect(mockEnsureUserDocument).toHaveBeenCalledWith(signedInUser);
    // Bootstrap must land before the app navigates into a route that reads
    // users/{uid} (AuthCheck) -- a push issued first could race the read.
    expect(mockEnsureUserDocument.mock.invocationCallOrder[0]).toBeLessThan(
      mockPush.mock.invocationCallOrder[0]
    );
  });

  it("a bootstrap failure surfaces as a generic sign-in error and does not navigate, exactly like AuthProviderButtons' federated path", async () => {
    const signedInUser = { uid: "user-1", email: "researcher@example.edu" };
    mockSignIn.mockResolvedValue({ user: signedInUser });
    mockEnsureUserDocument.mockRejectedValue(new Error("permission-denied"));

    renderForm();
    fillAndSubmit();

    expect(
      await screen.findByText("Could not sign you in. Please try again.")
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
