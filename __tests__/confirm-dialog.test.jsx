import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import "@testing-library/jest-dom";
import { system } from "../lib/theme";
import ConfirmDialog from "../components/ui/ConfirmDialog";

// A thin controlled wrapper, the same shape every real caller uses
// (Dialog.Root's open/onOpenChange contract), so the dialog can be opened,
// closed, and reopened the way DeleteAccount/ProviderConnections drive it.
function Harness({ onConfirm, destructive }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Reopen</button>
      <ConfirmDialog
        open={open}
        onOpenChange={(e) => setOpen(e.open)}
        title="Disconnect Google Drive?"
        confirmLabel="Disconnect"
        destructive={destructive}
        onConfirm={onConfirm}
      >
        <p>3 experiments are currently sending data to Google Drive.</p>
      </ConfirmDialog>
    </>
  );
}

function renderDialog(props) {
  return render(
    <ChakraProvider value={system}>
      <Harness {...props} />
    </ChakraProvider>
  );
}

describe("ConfirmDialog", () => {
  it("renders the title, body, and both actions", () => {
    renderDialog({ onConfirm: jest.fn() });

    expect(screen.getByText("Disconnect Google Drive?")).toBeInTheDocument();
    expect(
      screen.getByText(/3 experiments are currently sending data/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Disconnect" })
    ).toBeInTheDocument();
  });

  it("Cancel is always the neutral outline button, never brandTeal solid", () => {
    renderDialog({ onConfirm: jest.fn() });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    // Chakra v3 recipes resolve variant/colorPalette into data attributes
    // rather than literal class names, so assert on those rather than on
    // computed colors (jsdom does not run the CSS engine).
    expect(cancel).not.toHaveAttribute("data-colorPalette", "brandTeal");
  });

  it("calls onConfirm and closes on success", async () => {
    const onConfirm = jest.fn(() => Promise.resolve());
    renderDialog({ onConfirm });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("Disconnect Google Drive?")).not.toBeInTheDocument()
    );
  });

  it("keeps the dialog open and shows error.message when onConfirm throws", async () => {
    const onConfirm = jest.fn(() =>
      Promise.reject(new Error("Could not reach DataPipe. Check your connection and try again."))
    );
    renderDialog({ onConfirm });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(
      await screen.findByText(/Could not reach DataPipe/i)
    ).toBeInTheDocument();
    // Still open: the title and Cancel button are still on screen.
    expect(screen.getByText("Disconnect Google Drive?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("clears a previous error when reopened", async () => {
    const onConfirm = jest.fn(() => Promise.reject(new Error("Something went wrong.")));
    renderDialog({ onConfirm });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await screen.findByText("Something went wrong.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText("Disconnect Google Drive?")).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    // Chakra's Dialog (Ark UI/zag-js underneath) opens through its own state
    // machine, asynchronously relative to the click that triggers it, so
    // this is awaited like any other async UI update.
    expect(await screen.findByText("Disconnect Google Drive?")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  });
});
