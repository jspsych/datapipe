import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// The page imports DocsLayout for its getLayout, and DocsLayout imports the
// Navbar -- so the module graph reaches firebase, the fonts and the user
// context even though none of them render here. Same three mocks as
// index.test.jsx, for the same reason: a missing export is a module-load
// crash, not a failing assertion.
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

import CitationPage from "../pages/docs/citation";
import { CITATION, CITATION_APA, CITATION_BIBTEX } from "../lib/citation";

// The page component only, without its DocsLayout getLayout wrapper -- the
// same scope 404.test.jsx uses. The layout brings the sidebar and a router,
// and neither is what this page's behavior lives in.
function renderCitationPage() {
  return render(
    <ChakraProvider value={system}>
      <CitationPage />
    </ChakraProvider>
  );
}

// jsdom has no clipboard. `navigator.clipboard` is not configurable in every
// jsdom version, so it is defined rather than assigned.
function mockClipboard(writeText) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

describe("CitationPage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the reference in APA and BibTeX", () => {
    renderCitationPage();

    expect(screen.getByRole("heading", { name: "APA" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "BibTeX" })).toBeInTheDocument();
    // The rendered APA reference is assembled from fields rather than from
    // CITATION_APA, so this checks the two agree on the part most likely to
    // drift if someone edits one of them.
    expect(screen.getByText(/2499–2506/)).toBeInTheDocument();
    expect(screen.getByText(/@article\{deleeuw2024datapipe/)).toBeInTheDocument();
  });

  it("copies the plain-text APA reference", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);

    renderCitationPage();
    fireEvent.click(screen.getByRole("button", { name: /copy apa citation/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CITATION_APA));
    // Confirmation is a visible label, not only the icon swap.
    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  });

  it("copies the BibTeX entry", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);

    renderCitationPage();
    fireEvent.click(screen.getByRole("button", { name: /copy code/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CITATION_BIBTEX));
  });

  it("says what to do instead when the clipboard rejects", async () => {
    // Insecure origin, or clipboard permission denied. The old unawaited
    // write reported success here; the button must not.
    const writeText = jest.fn().mockRejectedValue(new Error("denied"));
    mockClipboard(writeText);
    jest.spyOn(console, "error").mockImplementation(() => {});

    renderCitationPage();
    fireEvent.click(screen.getByRole("button", { name: /copy apa citation/i }));

    await waitFor(() =>
      expect(screen.getByText(/could not copy/i)).toBeInTheDocument()
    );
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("builds the BibTeX entry from the same fields as the APA reference", () => {
    // Not a rendering test: the point of lib/citation.js is that one paper
    // cannot be two papers. A page range typed twice is exactly how that
    // fails, so both formats are checked against the single field.
    expect(CITATION_APA).toContain(CITATION.pages);
    expect(CITATION_BIBTEX).toContain(CITATION.pages.replace("–", "--"));
    expect(CITATION_APA).toContain(CITATION.journal);
    expect(CITATION_BIBTEX).toContain(CITATION.journal);
    expect(CITATION_APA).toContain(CITATION.doi);
    expect(CITATION_BIBTEX).toContain(CITATION.doi);
  });
});
