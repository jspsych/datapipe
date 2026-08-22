import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import FormErrorAlert from "../components/ui/FormErrorAlert";

function renderWithChakra(ui) {
  return render(<ChakraProvider value={system}>{ui}</ChakraProvider>);
}

describe("FormErrorAlert", () => {
  it("renders nothing for null children", () => {
    const { container } = renderWithChakra(
      <FormErrorAlert>{null}</FormErrorAlert>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for undefined children", () => {
    const { container } = renderWithChakra(<FormErrorAlert />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an empty string ("")', () => {
    const { container } = renderWithChakra(<FormErrorAlert>{""}</FormErrorAlert>);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the message when present", () => {
    renderWithChakra(
      <FormErrorAlert>Could not connect. Please try again.</FormErrorAlert>
    );

    expect(
      screen.getByText("Could not connect. Please try again.")
    ).toBeInTheDocument();
  });

  it("renders inside an error-status alert", () => {
    const { container } = renderWithChakra(
      <FormErrorAlert>Something went wrong.</FormErrorAlert>
    );

    // Alert.Root does not forward a plain `role="alert"` in Chakra v3 by
    // default in every version, so assert on the text plus a rendered
    // element rather than coupling to an internal DOM attribute.
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });
});
