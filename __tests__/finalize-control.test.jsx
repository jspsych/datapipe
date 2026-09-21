import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// FinalizeControl calls /api/finalize with a Bearer token, the same shape
// DeleteAccount uses for /api/deleteaccount -- mock auth.currentUser the same
// way provider-connections.test.jsx does.
const mockGetIdToken = jest.fn(() => Promise.resolve("id-token-123"));
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1", getIdToken: () => mockGetIdToken() } },
  db: {},
}));

import FinalizeControl from "../components/dashboard/FinalizeControl";

function renderControl(data) {
  return render(
    <ChakraProvider value={system}>
      <FinalizeControl data={{ id: "exp1", ...data }} experimentId="exp1" />
    </ChakraProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdToken.mockClear();
  mockGetIdToken.mockImplementation(() => Promise.resolve("id-token-123"));
  global.fetch = jest.fn();
});

describe("FinalizeControl — idle state", () => {
  it("shows a Finalize button when the experiment is not finalized and nothing is in flight", () => {
    renderControl({});
    expect(screen.getByRole("button", { name: /finalize/i })).toBeInTheDocument();
  });

  // Chakra's Dialog (Ark UI/zag-js underneath) opens and closes through its
  // own state machine, which updates asynchronously relative to the click
  // that triggers it -- so every interaction with it below is awaited
  // (findBy*/waitFor) rather than asserted on synchronously, same as any
  // other async UI.
  it("requires an explicit confirmation step before calling the API, and warns plainly about permanence and loose-file deletion", async () => {
    renderControl({});
    fireEvent.click(screen.getByRole("button", { name: /finalize/i }));

    // The confirmation dialog must say, in plain language, that this cannot
    // be undone AND that it deletes the loose files -- not just "are you
    // sure?".
    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();
    expect(
      screen.getByText(/permanently deletes the loose files/i)
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not call the API when the confirmation dialog is cancelled", async () => {
    renderControl({});
    fireEvent.click(screen.getByRole("button", { name: /finalize/i }));
    const cancelButton = await screen.findByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("POSTs to /api/finalize with the bearer token and experimentID once confirmed", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ status: "queued" }),
    });

    renderControl({});
    fireEvent.click(screen.getByRole("button", { name: /finalize/i }));
    const confirmButton = await screen.findByRole("button", { name: /^confirm$/i });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/finalize");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer id-token-123");
    expect(JSON.parse(options.body)).toEqual({ experimentID: "exp1" });
  });

  it("keeps the dialog open and shows the server's message when the API call fails", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Something broke" }),
    });

    renderControl({});
    fireEvent.click(screen.getByRole("button", { name: /finalize/i }));
    const confirmButton = await screen.findByRole("button", { name: /^confirm$/i });
    fireEvent.click(confirmButton);

    // The server's own error message is surfaced verbatim rather than a
    // generic "something went wrong" -- more useful for a researcher trying
    // to figure out what to do next.
    await waitFor(() => {
      expect(screen.getByText(/something broke/i)).toBeInTheDocument();
    });

    // The control now routes through components/ui/ConfirmDialog, whose
    // contract is that a failed onConfirm leaves the dialog OPEN with the
    // error rendered inside it. The hand-rolled dialog this replaced closed
    // on failure, which threw away the researcher's context (what they were
    // about to do) at the exact moment they needed it. Confirm is still
    // there, so the retry is one click.
    expect(
      screen.getByRole("button", { name: /^confirm$/i })
    ).toBeInTheDocument();
  });
});

describe("FinalizeControl — in-progress states", () => {
  it.each(["queued", "running"])(
    "hides the Finalize button and shows progress copy while status is %s",
    (status) => {
      renderControl({ finalization: { status } });
      expect(screen.queryByRole("button", { name: /finalize/i })).not.toBeInTheDocument();
      expect(screen.getByText(/finaliz/i)).toBeInTheDocument();
    }
  );
});

describe("FinalizeControl — finalized state", () => {
  it("shows a finalized notice and no button once finalized is true", () => {
    renderControl({ finalized: true, finalization: { status: "finalized" } });
    expect(screen.queryByRole("button", { name: /finalize/i })).not.toBeInTheDocument();
    expect(screen.getByText(/finalized/i)).toBeInTheDocument();
  });
});

describe("FinalizeControl — queued-uploads-pending", () => {
  it("explains that uploads are still draining rather than showing a generic failure", () => {
    renderControl({
      finalization: {
        status: "queued-uploads-pending",
        detail: "2 upload(s) for this experiment are still queued; finalize once the queue has drained",
      },
    });

    expect(screen.getByText(/drain/i)).toBeInTheDocument();
    // Must not read as a bare, unexplained failure.
    expect(screen.queryByText(/^error$/i)).not.toBeInTheDocument();
    // Retryable once uploads drain.
    expect(screen.getByRole("button", { name: /finalize/i })).toBeInTheDocument();
  });
});

describe("FinalizeControl — failed / other terminal statuses", () => {
  it("shows the failure detail and offers a retry", () => {
    renderControl({
      finalization: { status: "failed", detail: "merged archive checksum mismatch" },
    });

    expect(screen.getByText(/checksum mismatch/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /finalize/i })).toBeInTheDocument();
  });

  it("treats nothing-to-archive as informational rather than an error", () => {
    renderControl({
      finalization: {
        status: "nothing-to-archive",
        detail: "experiment has no collision-cache salt",
      },
    });

    expect(screen.getByRole("button", { name: /finalize/i })).toBeInTheDocument();
  });
});
