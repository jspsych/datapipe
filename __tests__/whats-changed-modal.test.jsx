import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import WhatsChangedModal from "../components/WhatsChangedModal";

const DISMISS_KEY = "datapipe:announcement:whats-changed:v1";

function renderModal() {
  return render(
    <ChakraProvider value={system}>
      <WhatsChangedModal />
    </ChakraProvider>
  );
}

const heading = () => screen.queryByRole("heading", { name: "DataPipe has changed" });

describe("WhatsChangedModal", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders when nothing is stored", async () => {
    renderModal();
    expect(await screen.findByRole("heading", { name: "DataPipe has changed" })).toBeInTheDocument();
    expect(
      screen.getByText(/A large update went out in September 2026/i)
    ).toBeInTheDocument();
  });

  it("is absent when the dismissal key is already set", () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    renderModal();
    expect(heading()).not.toBeInTheDocument();
  });

  it("renders nothing in the server snapshot", () => {
    // useSyncExternalStore's getServerSnapshot always answers "dismissed",
    // regardless of what localStorage holds, so the string React's server
    // renderer produces must never contain the dialog -- otherwise it would
    // flash open for every visitor who already closed it, the instant before
    // hydration reconciles.
    // jsdom does not provide MessageChannel or TextEncoder/TextDecoder, which
    // react-dom's server renderer needs even for a synchronous
    // renderToStaticMarkup call. `require` (rather than a top-of-file
    // `import`, which hoists above these polyfills) is deliberate here --
    // Node's own implementations are drop-ins, the same shape of gap
    // jest.setup.js already papers over for structuredClone.
    // Node's worker_threads MessagePort keeps the event loop alive until
    // explicitly closed -- a browser MessageChannel never needs that, so
    // react-dom's server renderer never closes the one it opens for this
    // call, and the raw class left Jest with an open MESSAGEPORT handle
    // (visible with --detectOpenHandles). Tracking every port this test
    // creates and closing them once the render is done fixes that without
    // touching react-dom itself.
    const openPorts = [];
    if (typeof MessageChannel === "undefined") {
      const { MessageChannel: NodeMessageChannel } = require("worker_threads");
      global.MessageChannel = class extends NodeMessageChannel {
        constructor(...args) {
          super(...args);
          openPorts.push(this.port1, this.port2);
        }
      };
    }
    if (typeof TextEncoder === "undefined") {
      const { TextEncoder, TextDecoder } = require("util");
      global.TextEncoder = TextEncoder;
      global.TextDecoder = TextDecoder;
    }
    const { renderToStaticMarkup } = require("react-dom/server");

    try {
      const markup = renderToStaticMarkup(
        <ChakraProvider value={system}>
          <WhatsChangedModal />
        </ChakraProvider>
      );
      expect(markup).not.toMatch(/DataPipe has changed/);
    } finally {
      openPorts.forEach((port) => port.close?.());
    }
  });

  it("clicking the primary link sets the key and closes the dialog", async () => {
    renderModal();
    await screen.findByRole("heading", { name: "DataPipe has changed" });

    const link = screen.getByRole("link", { name: /see what.s changed/i });
    // jsdom does not implement real navigation, and an uncancelled click on a
    // same-document <a href> logs a "Not implemented: navigation" error and
    // schedules work jsdom never finishes -- neither of which this test cares
    // about. Cancelling it is the same thing a real browser's own navigation
    // (which unmounts this component) would otherwise make moot.
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);

    await waitFor(() => expect(heading()).not.toBeInTheDocument());
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("clicking Dismiss sets the key and closes the dialog", async () => {
    renderModal();
    await screen.findByRole("heading", { name: "DataPipe has changed" });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(heading()).not.toBeInTheDocument());
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("clicking the close (x) control sets the key and closes the dialog", async () => {
    renderModal();
    await screen.findByRole("heading", { name: "DataPipe has changed" });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(heading()).not.toBeInTheDocument());
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("pressing Escape sets the key and closes the dialog", async () => {
    renderModal();
    await screen.findByRole("heading", { name: "DataPipe has changed" });

    // Ark's dismissable-layer setup (the Escape/outside-click tracking) is
    // deferred behind a requestAnimationFrame, so a keydown fired in the
    // same tick as the heading appearing can race it. A macrotask is enough
    // for that frame to have run; using setTimeout rather than calling
    // requestAnimationFrame directly here avoids adding a second rAF request
    // of this test's own on top of zag's.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(heading()).not.toBeInTheDocument());
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("still renders and still closes for the session when localStorage throws", async () => {
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
      renderModal();
      expect(await screen.findByRole("heading", { name: "DataPipe has changed" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      await waitFor(() => expect(heading()).not.toBeInTheDocument());
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
