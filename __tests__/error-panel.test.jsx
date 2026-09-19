import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// Same shape as finalize-control.test.jsx: ErrorPanel calls /api/clearerrors
// with a Bearer token from auth.currentUser.
const mockGetIdToken = jest.fn(() => Promise.resolve("id-token-123"));
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1", getIdToken: () => mockGetIdToken() } },
  db: {},
}));

import ErrorPanel from "../components/dashboard/ErrorPanel";

function renderPanel(props) {
  return render(
    <ChakraProvider value={system}>
      <ErrorPanel experimentId="exp-1" {...props} />
    </ChakraProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdToken.mockClear();
  mockGetIdToken.mockImplementation(() => Promise.resolve("id-token-123"));
  global.fetch = jest.fn();
});

const recentTimestamp = { seconds: Math.floor(Date.now() / 1000) - 60 * 60 * 3, nanoseconds: 0 };

describe("ErrorPanel — rendering", () => {
  it("renders nothing when there is nothing to show", () => {
    const { container } = renderPanel({ errors: [], totalCount: 0 });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the visible count is 0 because everything has been cleared", () => {
    const { container } = renderPanel({
      errors: [{ error: "A", time: recentTimestamp }],
      totalCount: 1,
      logErrorCleared: 1,
      errorsClearedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the singular headline for one rejection", () => {
    renderPanel({ errors: [{ error: "A", time: recentTimestamp }], totalCount: 1 });
    expect(
      screen.getByText("One submission to this experiment was rejected.")
    ).toBeInTheDocument();
  });

  it("renders the plural headline with the count SINCE THE LAST CLEAR, not the lifetime count", () => {
    renderPanel({
      errors: [{ error: "A", time: recentTimestamp }],
      totalCount: 9,
      logErrorCleared: 5,
    });
    expect(
      screen.getByText("4 submissions to this experiment were rejected.")
    ).toBeInTheDocument();
  });

  it("renders a relative-time sentence and never the retired 'running record' copy", () => {
    renderPanel({ errors: [{ error: "A", time: recentTimestamp }], totalCount: 1 });
    expect(screen.getByText(/The most recent was/i)).toBeInTheDocument();
    // The relative phrase itself renders in its own element (it carries a
    // `title` with the absolute time), so it is queried separately.
    expect(screen.getByText(/hours? ago/i)).toBeInTheDocument();
    expect(screen.queryByText(/running record/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/live alarm/i)).not.toBeInTheDocument();
  });

  it("puts the absolute time on the relative phrase as a title attribute", () => {
    renderPanel({ errors: [{ error: "A", time: recentTimestamp }], totalCount: 1 });
    const relative = screen.getByText(/hours? ago/i);
    expect(relative).toHaveAttribute("title");
    expect(relative.getAttribute("title")).not.toBe("");
  });

  it("renders just the first sentence when count > 0 but no row has a usable time", () => {
    renderPanel({ errors: [], totalCount: 2 });
    expect(
      screen.getByText("These submissions did not reach your storage provider.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/The most recent was/i)).not.toBeInTheDocument();
  });

  it("renders 'on <string>' for a legacy preformatted time, since a relative time is impossible for it", () => {
    renderPanel({ errors: [{ error: "A", time: "19/09/2026, 13:00:18 GMT-4" }], totalCount: 1 });
    // Whole-sentence match: unlike the relative-time case, this branch has
    // no nested element (no title-bearing span), so the entire sentence is
    // one run of sibling text nodes under the same <Text>.
    expect(
      screen.getByText(
        "These submissions did not reach your storage provider. The most recent was on 19/09/2026, 13:00:18 GMT-4."
      )
    ).toBeInTheDocument();
  });

  it("renders no filled error Alert -- the quiet SectionPanel/StatusIndicator treatment has no role=alert element", () => {
    renderPanel({ errors: [{ error: "A", time: recentTimestamp }], totalCount: 1 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the headline but no accordion when count > 0 and there are no visible rows", () => {
    renderPanel({ errors: [], totalCount: 3 });
    expect(
      screen.getByText("3 submissions to this experiment were rejected.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Show what was rejected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/most recent of/i)).not.toBeInTheDocument();
  });

  it("still renders a 'Clear this list' button in that no-visible-rows case", () => {
    renderPanel({ errors: [], totalCount: 3 });
    expect(screen.getByRole("button", { name: /clear this list/i })).toBeInTheDocument();
  });
});

describe("ErrorPanel — clearing", () => {
  it("POSTs to /api/clearerrors with the bearer token and experiment ID", async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ message: "Success" }) });

    renderPanel({ errors: [{ error: "A", time: recentTimestamp }], totalCount: 1 });
    fireEvent.click(screen.getByRole("button", { name: /clear this list/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/clearerrors");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer id-token-123");
    expect(JSON.parse(options.body)).toEqual({ experimentID: "exp-1" });
  });

  it("shows an inline error and leaves the list rendered when the request fails", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) });

    renderPanel({ errors: [{ error: "A", time: recentTimestamp }], totalCount: 1 });
    fireEvent.click(screen.getByRole("button", { name: /clear this list/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(
      screen.getByText(/could not clear this list/i)
    ).toBeInTheDocument();
    // The list is untouched -- still showing the same headline.
    expect(
      screen.getByText("One submission to this experiment was rejected.")
    ).toBeInTheDocument();
  });

  it("disables the button while the request is in flight", async () => {
    let resolveFetch;
    global.fetch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    renderPanel({ errors: [{ error: "A", time: recentTimestamp }], totalCount: 1 });
    const button = screen.getByRole("button", { name: /clear this list/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());

    resolveFetch({ ok: true, status: 200, json: () => Promise.resolve({ message: "Success" }) });
    // Let the resulting setClearing(false) settle so it lands inside act().
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
