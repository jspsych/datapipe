import { fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import OsfSunsetBanner from "../components/OsfSunsetBanner";
import { osfSunsetLabel } from "../lib/osf-sunset";

const DISMISS_KEY = "datapipe:announcement:osf-sunset:v1";

function renderBanner() {
  return render(
    <ChakraProvider value={system}>
      <OsfSunsetBanner />
    </ChakraProvider>
  );
}

const heading = () => screen.queryByText(/OSF support is ending/i);

describe("OsfSunsetBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("announces the sunset, naming the date from lib/osf-sunset", () => {
    renderBanner();
    expect(heading()).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(osfSunsetLabel(), "i"))
    ).toBeInTheDocument();
    expect(screen.getByText(/multi-backend/i)).toBeInTheDocument();
  });

  it("links out to the COS announcement, safely", () => {
    renderBanner();
    const link = screen.getByRole("link", { name: /announcement from COS/i });
    expect(link).toHaveAttribute(
      "href",
      "https://www.cos.io/blog/osf-changes-a-note-to-users"
    );
    // Opening in a new tab without noopener hands the COS page a window
    // reference back to DataPipe.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("hides itself when dismissed and records the dismissal", () => {
    renderBanner();

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(heading()).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("stays hidden on a later visit once dismissed", () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    renderBanner();
    expect(heading()).not.toBeInTheDocument();
  });

  it("still renders and still closes when localStorage is unavailable", () => {
    const getItem = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });

    try {
      renderBanner();
      expect(heading()).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
      expect(heading()).not.toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
