import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import Custom404 from "../pages/404";

// pages/404.js has no getLayout override, so _app.js supplies the Navbar +
// Footer chrome at runtime -- this renders the page component in isolation,
// the same scope index.test.jsx uses for Home. No firebase/context/font
// mocks are needed here: the page imports nothing but Chakra and next/link.
function renderCustom404() {
  return render(
    <ChakraProvider value={system}>
      <Custom404 />
    </ChakraProvider>
  );
}

describe("Custom404", () => {
  it("renders a 'page not found' heading", () => {
    renderCustom404();
    expect(
      screen.getByRole("heading", { name: /page not found/i })
    ).toBeInTheDocument();
  });

  it("links back to the homepage", () => {
    renderCustom404();
    expect(
      screen.getByRole("link", { name: /go to the homepage/i })
    ).toHaveAttribute("href", "/");
  });

  it("links to the documentation", () => {
    renderCustom404();
    expect(
      screen.getByRole("link", { name: /documentation/i })
    ).toHaveAttribute("href", "/docs");
  });
});
