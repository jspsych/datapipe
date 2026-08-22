import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import SettingsSection from "../components/ui/SettingsSection";

function renderWithChakra(ui) {
  return render(<ChakraProvider value={system}>{ui}</ChakraProvider>);
}

describe("SettingsSection", () => {
  it("renders the title as a heading (h2)", () => {
    renderWithChakra(<SettingsSection title="Storage providers" />);

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Storage providers",
    });
    expect(heading).toBeInTheDocument();
  });

  it("renders the description when given", () => {
    renderWithChakra(
      <SettingsSection
        title="Storage providers"
        description="Where your experiment data lands. At least one is required."
      />
    );

    expect(
      screen.getByText(
        "Where your experiment data lands. At least one is required."
      )
    ).toBeInTheDocument();
  });

  it("renders no description text when not given", () => {
    renderWithChakra(<SettingsSection title="Storage providers" />);

    // Nothing beyond the heading should render -- no stray empty paragraph.
    expect(screen.queryByText(/./, { selector: "p" })).not.toBeInTheDocument();
  });

  it("renders children inside the section", () => {
    renderWithChakra(
      <SettingsSection title="Storage providers">
        <div>provider list</div>
      </SettingsSection>
    );

    expect(screen.getByText("provider list")).toBeInTheDocument();
  });

  it("default variant does not add a bordered container", () => {
    const { container } = renderWithChakra(
      <SettingsSection title="Sign-in methods">
        <div>content</div>
      </SettingsSection>
    );

    // The default variant's wrapping Box carries no borderWidth -- only
    // the danger variant (tested below) gets the "different rules apply
    // here" bordered treatment.
    const wrapper = container.firstChild;
    const style = window.getComputedStyle(wrapper);
    expect(["", "0px"]).toContain(style.borderWidth);
  });

  it("danger variant wraps the section content in a bordered container", () => {
    renderWithChakra(
      <SettingsSection title="Danger zone" variant="danger">
        <div>Delete account</div>
      </SettingsSection>
    );

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Danger zone",
    });
    const content = screen.getByText("Delete account");

    // The bordered container is an ancestor of both the heading and the
    // content -- find the nearest common ancestor with a borderWidth style.
    let node = content;
    let borderedAncestor = null;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      if (
        style.borderWidth &&
        style.borderWidth !== "0px" &&
        node.contains(heading)
      ) {
        borderedAncestor = node;
        break;
      }
      node = node.parentElement;
    }

    expect(borderedAncestor).not.toBeNull();
  });
});
