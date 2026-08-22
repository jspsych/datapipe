import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import "@testing-library/jest-dom";
import { system } from "../lib/theme";

const mockUpdatePassword = jest.fn();
jest.mock("firebase/auth", () => ({
  updatePassword: (...args) => mockUpdatePassword(...args),
}));

jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1" } },
}));

import ChangePassword from "../components/account/ChangePassword";

function renderComponent() {
  return render(
    <ChakraProvider value={system}>
      <ChangePassword />
    </ChakraProvider>
  );
}

// Opens the dialog and returns it scoped with `within`. The trigger button
// and the dialog's own submit button share the exact same accessible name
// ("Change Password"), and Chakra hides the background from assistive tech
// asynchronously once the dialog settles -- relying on that timing to
// disambiguate the two is racy, so every query below is scoped to the
// dialog element itself instead.
async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /^Change Password$/i }));
  const dialog = await screen.findByRole("dialog");
  return within(dialog);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Chakra's Dialog (Ark UI/zag-js underneath) opens and closes through its own
// state machine, which updates asynchronously relative to the click that
// triggers it -- so every interaction with it below is awaited (findBy*)
// rather than asserted on synchronously, same as finalize-control.test.jsx.
describe("ChangePassword", () => {
  it("does not show validation errors before the fields are touched", async () => {
    renderComponent();
    const dialog = await openDialog();

    // The critique's exact failure mode: "Password must be at least 12
    // characters" rendering the instant the dialog opens, before a keystroke.
    expect(dialog.getByLabelText(/New Password/i)).toBeInTheDocument();
    expect(
      dialog.queryByText(/Password must be at least 12 characters/i)
    ).not.toBeInTheDocument();
    expect(dialog.queryByText(/Passwords do not match/i)).not.toBeInTheDocument();
  });

  it("shows the length error only after the new-password field is blurred", async () => {
    renderComponent();
    const dialog = await openDialog();

    const newPassword = dialog.getByLabelText(/New Password/i);
    fireEvent.change(newPassword, { target: { value: "short" } });
    expect(
      dialog.queryByText(/Password must be at least 12 characters/i)
    ).not.toBeInTheDocument();

    fireEvent.blur(newPassword);
    expect(
      dialog.getByText(/Password must be at least 12 characters/i)
    ).toBeInTheDocument();
  });

  it("keeps the dialog open and renders the mapped error when updatePassword fails", async () => {
    mockUpdatePassword.mockRejectedValue({ code: "auth/requires-recent-login" });
    renderComponent();
    const dialog = await openDialog();

    fireEvent.change(dialog.getByLabelText(/New Password/i), {
      target: { value: "a-long-enough-password" },
    });
    fireEvent.change(dialog.getByLabelText(/Confirm Password/i), {
      target: { value: "a-long-enough-password" },
    });
    fireEvent.click(dialog.getByRole("button", { name: /^Change Password$/i }));

    expect(
      await dialog.findByText(
        /For security, sign out and sign back in, then change your password\./i
      )
    ).toBeInTheDocument();
    // Still open: the field is still on screen.
    expect(dialog.getByLabelText(/New Password/i)).toBeInTheDocument();
  });

  it("closes and shows a transient success indicator when updatePassword succeeds", async () => {
    mockUpdatePassword.mockResolvedValue();
    renderComponent();
    const dialog = await openDialog();

    fireEvent.change(dialog.getByLabelText(/New Password/i), {
      target: { value: "a-long-enough-password" },
    });
    fireEvent.change(dialog.getByLabelText(/Confirm Password/i), {
      target: { value: "a-long-enough-password" },
    });
    fireEvent.click(dialog.getByRole("button", { name: /^Change Password$/i }));

    await waitFor(() => expect(screen.getByText("Success")).toBeInTheDocument());
    // The dialog's own close is a separate async transition from the submit
    // -- wait for the field to actually leave the DOM rather than asserting
    // synchronously against the exit animation's in-between state.
    await waitFor(() =>
      expect(screen.queryByLabelText(/New Password/i)).not.toBeInTheDocument()
    );
  });
});
