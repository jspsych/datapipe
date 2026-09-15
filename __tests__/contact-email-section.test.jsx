import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// Same mocking shape as __tests__/provider-connections.test.jsx: mock
// ../lib/firebase (auth.currentUser.getIdToken, matching DeleteAccount.js /
// FinalizeControl.js's fetch-with-bearer-token idiom, NOT a Firestore write --
// this file only calls the two P3 HTTP endpoints), ../lib/context (for
// user.uid, used only by the P1 edit-form's setDoc call), and firebase/firestore.
const mockGetIdToken = jest.fn(() => Promise.resolve("id-token-123"));
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1", getIdToken: () => mockGetIdToken() } },
  db: {},
}));

jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({ user: { uid: "user-1" }, loading: false }),
}));

const mockSetDoc = jest.fn(() => Promise.resolve());
jest.mock("firebase/firestore", () => ({
  doc: jest.fn(() => ({})),
  setDoc: (...args) => mockSetDoc(...args),
}));

import ContactEmail from "../components/account/ContactEmail";

function renderComponent(data) {
  return render(
    <ChakraProvider value={system}>
      <ContactEmail data={data} />
    </ChakraProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdToken.mockClear();
  mockGetIdToken.mockImplementation(() => Promise.resolve("id-token-123"));
  mockSetDoc.mockClear();
  mockSetDoc.mockResolvedValue();
  global.fetch = jest.fn();
});

describe("ContactEmail — states", () => {
  it("verified: shows StatusIndicator ok/Confirmed, no Verify or Resend affordance", () => {
    renderComponent({ contactEmail: "researcher@example.edu", contactEmailVerified: true });

    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.queryByText("Not confirmed yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Verify$/i })).not.toBeInTheDocument();
  });

  it("unverified: shows StatusIndicator neutral/Not confirmed yet plus a Verify action", () => {
    renderComponent({ contactEmail: "researcher@example.edu", contactEmailVerified: false });

    expect(screen.getByText("Not confirmed yet")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Verify$/i })).toBeInTheDocument();
  });

  it("no address on file: neither Confirmed, Not confirmed yet, nor Verify render", () => {
    renderComponent({ contactEmail: "" });

    expect(screen.getByText("No address on file")).toBeInTheDocument();
    expect(screen.queryByText("Not confirmed yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Verify$/i })).not.toBeInTheDocument();
  });
});

describe("ContactEmail — sending a code", () => {
  it("Verify calls sendcontactemailverification with the bearer token, then opens the code form", async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });

    renderComponent({ contactEmail: "researcher@example.edu", contactEmailVerified: false });
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/sendcontactemailverification");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer id-token-123");
    expect(mockGetIdToken).toHaveBeenCalled();

    expect(await screen.findByLabelText(/Verification code/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Enter the 6-digit code we sent to researcher@example\.edu/i)
    ).toBeInTheDocument();
    // The Verify button that triggered the send is gone once the form is
    // open -- Resend (inside the form) replaces it.
    expect(screen.queryByRole("button", { name: /^Verify$/i })).not.toBeInTheDocument();
  });

  it("a send failure (e.g. no contact email) is shown via FormErrorAlert, in human copy, and does not open the form", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          error: "Add a contact email address before requesting a code.",
          code: "no-contact-email",
        }),
    });

    renderComponent({ contactEmail: "researcher@example.edu", contactEmailVerified: false });
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/i }));

    expect(
      await screen.findByText(/Add a contact email address before requesting a code/i)
    ).toBeInTheDocument();
    // The raw machine code must never reach the page.
    expect(screen.queryByText(/no-contact-email/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Verification code/i)).not.toBeInTheDocument();
  });

  it("a rate-limited resend still opens the code form -- a code is already out there and usable", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: () =>
        Promise.resolve({
          error: "Please wait a moment before requesting another code.",
          code: "rate-limited",
        }),
    });

    renderComponent({ contactEmail: "researcher@example.edu", contactEmailVerified: false });
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/i }));

    expect(await screen.findByLabelText(/Verification code/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Please wait a moment before requesting another code/i)
    ).toBeInTheDocument();
  });
});

describe("ContactEmail — entering a code", () => {
  async function openCodeForm() {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    renderComponent({ contactEmail: "researcher@example.edu", contactEmailVerified: false });
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/i }));
    await screen.findByLabelText(/Verification code/i);
  }

  it("Confirm calls verifycontactemail with the bearer token and the entered code", async () => {
    await openCodeForm();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    fireEvent.change(screen.getByLabelText(/Verification code/i), {
      target: { value: "482913" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const [url, options] = global.fetch.mock.calls[1];
    expect(url).toBe("/api/verifycontactemail");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer id-token-123");
    expect(JSON.parse(options.body)).toEqual({ code: "482913" });

    // Success closes the form; contactEmailVerified itself flips only via
    // the parent's live users/{uid} subscription (a prop update this test
    // does not simulate), so the form closing is the observable effect here.
    await waitFor(() =>
      expect(screen.queryByLabelText(/Verification code/i)).not.toBeInTheDocument()
    );
  });

  it("non-digit input is stripped and the field is capped at 6 characters", async () => {
    await openCodeForm();

    const input = screen.getByLabelText(/Verification code/i);
    fireEvent.change(input, { target: { value: "4a8b2c913x" } });

    expect(input.value).toBe("482913");
  });

  it("a wrong-code failure surfaces through FormErrorAlert with human copy, never the raw error code", async () => {
    await openCodeForm();
    global.fetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "That code is incorrect.", code: "invalid-code" }),
    });

    fireEvent.change(screen.getByLabelText(/Verification code/i), {
      target: { value: "000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/i }));

    expect(await screen.findByText(/That code is incorrect/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid-code/i)).not.toBeInTheDocument();
    // Stays open so the researcher can retry without re-requesting a code.
    expect(screen.getByLabelText(/Verification code/i)).toBeInTheDocument();
  });

  it("an expired-code failure maps to its own human sentence", async () => {
    await openCodeForm();
    global.fetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "That code has expired.", code: "expired" }),
    });

    fireEvent.change(screen.getByLabelText(/Verification code/i), {
      target: { value: "000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/i }));

    expect(await screen.findByText(/expired. Request a new one/i)).toBeInTheDocument();
  });

  it("submitting fewer than 6 digits is refused client-side, with no request sent", async () => {
    await openCodeForm();
    global.fetch.mockClear();

    fireEvent.change(screen.getByLabelText(/Verification code/i), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/i }));

    // Exact string: the helper line says "Enter the 6-digit code we sent
    // to..." so a loose regex would double-match.
    expect(await screen.findByText("Enter the 6-digit code.")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Resend re-calls sendcontactemailverification and clears the entered code", async () => {
    await openCodeForm();
    fireEvent.change(screen.getByLabelText(/Verification code/i), {
      target: { value: "111111" },
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    fireEvent.click(screen.getByRole("button", { name: /^Resend$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(global.fetch.mock.calls[1][0]).toBe("/api/sendcontactemailverification");
    await waitFor(() => expect(screen.getByLabelText(/Verification code/i).value).toBe(""));
  });

  it("Cancel closes the form without calling verify", async () => {
    await openCodeForm();
    global.fetch.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(screen.queryByLabelText(/Verification code/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Verify$/i })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
