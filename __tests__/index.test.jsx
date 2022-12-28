import { render, screen } from "@testing-library/react";
import Home from "../pages/index";
import "@testing-library/jest-dom";

describe("Home", () => {
  it("renders Home component", () => {
    render(<Home />);
    expect(screen.getByText("Create an account")).toBeInTheDocument();
  });
});
