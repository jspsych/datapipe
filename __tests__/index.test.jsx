import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import Home from "../pages/index";
import "@testing-library/jest-dom";

describe("Home", () => {
  it("renders Home component", () => {
    render(
      <ChakraProvider value={system}>
        <Home />
      </ChakraProvider>
    );
    expect(screen.getByText("Create an account")).toBeInTheDocument();
  });
});
