import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// Mock firebase since test env doesn't have NEXT_PUBLIC_FIREBASE_CONFIG
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: null },
  db: {},
}));

// Mock next/font/google since it's not available in test env. Every font
// any rendered component imports must appear here -- a missing export
// crashes the suite at module load (Navbar's Space_Grotesk did exactly
// that when the logo lockup replaced Rubik there).
jest.mock("next/font/google", () => ({
  Rubik: () => ({ className: "mock-rubik" }),
  Space_Grotesk: () => ({ className: "mock-space-grotesk" }),
}));

// Mock context to provide a default user value
jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({ user: null, loading: false }),
}));

// The hero code specimen is a Chakra/Ark Tabs widget, which measures its
// elements. jsdom ships no ResizeObserver, and a missing global there is a
// module-load crash rather than a test failure.
if (typeof global.ResizeObserver === "undefined") {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import Home from "../pages/index";

function renderHome() {
  return render(
    <ChakraProvider value={system}>
      <Home />
    </ChakraProvider>
  );
}

describe("Home", () => {
  it("renders Home component", () => {
    renderHome();
    // The hero CTA and the closing CTA are the same door, twice.
    expect(screen.getAllByText("Create an account").length).toBeGreaterThan(0);
  });

  it("labels each CTA with the page it actually opens", () => {
    renderHome();
    // Signed out, the primary goes to /signup, so it may not promise a guide.
    // "Get started" did.
    expect(screen.queryByText("Get started")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /create an account/i }).length)
      .toBeGreaterThan(0);
    // The secondary goes to /getting-started and now says so, in the same
    // words faq.js and the closing band use for that page.
    expect(
      screen.getByRole("link", { name: /read the getting started guide/i })
    ).toHaveAttribute("href", "/getting-started");
  });

  it("keeps the code specimen inside the hero band", () => {
    renderHome();
    // The specimen is the first thing that shows the actual product, so it
    // belongs beside the claim rather than in a section below it. Asserted
    // structurally: the h1 and the tablist share the hero, so the tabs must
    // appear before the "Three steps" heading that opens the next ground.
    const h1 = screen.getByRole("heading", { level: 1 });
    const tabs = screen.getByRole("tablist");
    const steps = screen.getByRole("heading", {
      name: /three steps to start collecting data/i,
    });
    // Node.compareDocumentPosition: 4 = DOCUMENT_POSITION_FOLLOWING.
    expect(h1.compareDocumentPosition(tabs) & 4).toBeTruthy();
    expect(tabs.compareDocumentPosition(steps) & 4).toBeTruthy();
  });

  it("describes the providers DataPipe actually ships", () => {
    renderHome();
    // The phrase appears in the deck AND in step 1 -- both deliberate, so
    // assert presence, not uniqueness.
    expect(
      screen.getAllByText(/Google Drive, Dataverse, or Zenodo/).length
    ).toBeGreaterThan(0);
    // The page used to say "the Open Science Framework" in the deck and "OSF"
    // in two of the three steps. OSF now appears only in the wind-down notice.
    expect(
      screen.queryByText(/directly to the Open Science Framework/)
    ).not.toBeInTheDocument();
  });

  it("leads with the shipped product in the headline", () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Experiment data, straight to storage you control."
    );
  });

  it("gives the code specimen user-controlled tabs and a copy button", () => {
    renderHome();
    // Replaces a 6s auto-advancing carousel (WCAG 2.2.2). Both snippet labels
    // are permanently visible and exposed as real tabs.
    expect(screen.getByRole("tab", { name: "jsPsych" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "JavaScript" })).toBeInTheDocument();
    // The traffic-light costume is gone; the visitor's next action is here.
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });
});
