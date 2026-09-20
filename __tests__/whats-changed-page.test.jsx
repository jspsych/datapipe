import fs from "fs";
import path from "path";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// The page imports DocsLayout for its getLayout, and DocsLayout imports the
// Navbar -- so the module graph reaches firebase, the fonts and the user
// context even though none of them render here. Same mocks as
// citation-page.test.jsx, for the same reason: a missing export is a module-
// load crash, not a failing assertion.
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: null },
  db: {},
}));

jest.mock("next/font/google", () => ({
  Rubik: () => ({ className: "mock-rubik" }),
  Space_Grotesk: () => ({ className: "mock-space-grotesk" }),
}));

jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({ user: null, loading: false }),
}));

import WhatsChangedPage from "../pages/docs/whats-changed";

function renderPage() {
  return render(
    <ChakraProvider value={system}>
      <WhatsChangedPage />
    </ChakraProvider>
  );
}

// Same routing rule as __tests__/docs-nav.test.js's pageFileFor: a /docs href
// is either a page file or a directory index under pages/.
function internalDocsHrefResolves(href) {
  const withoutLeadingSlash = href.replace(/^\//, "").split("#")[0];
  const asFile = path.join(process.cwd(), "pages", `${withoutLeadingSlash}.js`);
  if (fs.existsSync(asFile)) return true;
  const asIndex = path.join(process.cwd(), "pages", withoutLeadingSlash, "index.js");
  return fs.existsSync(asIndex);
}

describe("WhatsChangedPage", () => {
  it("renders the title and the lead paragraph", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: "What's changed", level: 1 })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/DataPipe had a large update in September 2026/i)
    ).toBeInTheDocument();
  });

  it("puts the renamed error codes first, under Changes that can affect your code", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Changes that can affect your code" })
    ).toBeInTheDocument();
    expect(screen.getByText("FILE_EXISTS")).toBeInTheDocument();
    expect(screen.getByText("UPLOAD_ERROR")).toBeInTheDocument();
    expect(screen.getByText("UPLOAD_EXCEPTION")).toBeInTheDocument();
  });

  it("every internal /docs/... link on the page points at a page that exists", () => {
    renderPage();
    const docsLinks = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href) => href && href.startsWith("/docs/"));

    expect(docsLinks.length).toBeGreaterThan(0);
    for (const href of docsLinks) {
      expect(internalDocsHrefResolves(href)).toBe(true);
    }
  });
});
