import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import StatusIndicator from "../components/ui/StatusIndicator";

function renderWithChakra(ui) {
  return render(<ChakraProvider value={system}>{ui}</ChakraProvider>);
}

describe("StatusIndicator", () => {
  it.each([
    ["ok", "Connected"],
    ["warning", "Re-authentication required"],
    ["error", "Not connected"],
    ["neutral", "Not applicable"],
  ])("renders the visible label text for status=%s", (status, label) => {
    renderWithChakra(<StatusIndicator status={status} label={label} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("marks the icon as decorative (aria-hidden)", () => {
    const { container } = renderWithChakra(
      <StatusIndicator status="ok" label="Connected" />
    );

    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("does not apply role=status (static display, not a live region)", () => {
    renderWithChakra(<StatusIndicator status="ok" label="Connected" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("warns when rendered without a label", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    renderWithChakra(<StatusIndicator status="ok" />);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("`label` is required")
    );

    consoleError.mockRestore();
  });

  it("warns when the label is an empty string", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    renderWithChakra(<StatusIndicator status="warning" label="" />);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("`label` is required")
    );

    consoleError.mockRestore();
  });

  it("does not warn when a label is provided", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    renderWithChakra(<StatusIndicator status="ok" label="Connected" />);

    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
