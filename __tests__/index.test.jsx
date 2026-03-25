import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// Mock firebase since test env doesn't have NEXT_PUBLIC_FIREBASE_CONFIG
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: null },
  db: {},
}));

// Mock next/font/google since it's not available in test env
jest.mock("next/font/google", () => ({
  Rubik: () => ({ className: "mock-rubik" }),
}));

// Mock context to provide a default user value
jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({ user: null, loading: false }),
}));

import Home from "../pages/index";

describe("Home", () => {
  it("renders Home component", () => {
    render(
      <ChakraProvider value={system}>
        <Home />
      </ChakraProvider>
    );
    expect(screen.getByText("Get started")).toBeInTheDocument();
  });
});
