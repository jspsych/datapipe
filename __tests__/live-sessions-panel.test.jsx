import { render, screen, act, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import LiveSessionsPanel, {
  formatElapsed,
  displayState,
  MAX_ROWS,
  TICK_MS,
} from "../components/dashboard/LiveSessionsPanel";

/**
 * The live-sessions panel on the experiment dashboard. The rows come from the
 * server-kept liveSessions mirror; what is pinned here is how they read --
 * the states, the durations, and the clock that moves them without another
 * write.
 */

const NOW = new Date("2026-09-11T14:30:00Z").getTime();
const MIN = 60_000;

// Firestore hands the page Timestamps; the panel only needs toMillis().
const ts = (ms) => ({ toMillis: () => ms });

function row(id, { startedMinutesAgo, state = "active", recoverInMinutes = null }) {
  return {
    id,
    state,
    startedAt: ts(NOW - startedMinutesAgo * MIN),
    disconnectedAt: state === "disconnected" ? ts(NOW - MIN) : null,
    recoverAfter: recoverInMinutes === null ? null : ts(NOW + recoverInMinutes * MIN),
  };
}

function renderPanel(sessions) {
  return render(
    <ChakraProvider value={system}>
      <LiveSessionsPanel sessions={sessions} />
    </ChakraProvider>
  );
}

const bodyRows = () => within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("formatElapsed", () => {
  it.each([
    [0, "under a minute"],
    [59_999, "under a minute"],
    [60_000, "1 min"],
    [4 * MIN + 30_000, "4 min"],
    [59 * MIN, "59 min"],
    [60 * MIN, "1 h"],
    [72 * MIN, "1 h 12 min"],
    [NaN, "under a minute"],
    [-5000, "under a minute"],
  ])("formats %p ms as %p", (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});

describe("displayState", () => {
  it("reads an active session as in progress", () => {
    expect(displayState({ state: "active" }, NOW)).toEqual({ status: "ok", label: "In progress" });
  });

  it("reads a recent dropout as one that may still resume", () => {
    expect(
      displayState({ state: "disconnected", recoverAfter: ts(NOW + 5 * MIN) }, NOW)
    ).toEqual({ status: "warning", label: "Connection lost — may resume" });
  });

  it("reads a dropout past its grace period as being recovered", () => {
    expect(
      displayState({ state: "disconnected", recoverAfter: ts(NOW - 1) }, NOW)
    ).toEqual({ status: "neutral", label: "Stopped — being recovered" });
  });
});

describe("LiveSessionsPanel", () => {
  it("renders nothing, and runs no clock, when nobody is in progress", () => {
    const { container } = renderPanel([]);
    expect(container).toBeEmptyDOMElement();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("lists sessions longest-running first, each with its state in words", () => {
    renderPanel([
      row("new", { startedMinutesAgo: 2 }),
      row("old", { startedMinutesAgo: 40, state: "disconnected", recoverInMinutes: 6 }),
      row("mid", { startedMinutesAgo: 15 }),
    ]);

    const rows = bodyRows();
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Connection lost — may resume")).toBeInTheDocument();
    expect(within(rows[0]).getByText("40 min")).toBeInTheDocument();
    expect(within(rows[1]).getByText("15 min")).toBeInTheDocument();
    expect(within(rows[2]).getByText("2 min")).toBeInTheDocument();
    expect(screen.getAllByText("In progress")).toHaveLength(2);
  });

  it("moves durations on as time passes, with no new data", () => {
    renderPanel([row("a", { startedMinutesAgo: 4 })]);
    expect(screen.getByText("4 min")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(4 * TICK_MS);
    });

    expect(screen.getByText("5 min")).toBeInTheDocument();
  });

  it("turns a dropout into 'being recovered' when its grace period runs out", () => {
    // Decided from the server-written recoverAfter, on the panel's own clock:
    // no further write is needed for the row to change.
    renderPanel([row("a", { startedMinutesAgo: 10, state: "disconnected", recoverInMinutes: 0.2 })]);
    expect(screen.getByText("Connection lost — may resume")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(TICK_MS);
    });

    expect(screen.getByText("Stopped — being recovered")).toBeInTheDocument();
  });

  it(`shows at most ${MAX_ROWS} rows and says how many more there are`, () => {
    const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) =>
      row(`s${i}`, { startedMinutesAgo: i + 1 })
    );
    renderPanel(many);

    expect(bodyRows()).toHaveLength(MAX_ROWS);
    expect(screen.getByText(/5 more sessions are in\s+progress and not shown/)).toBeInTheDocument();
  });

  it("skips a row with no usable start time rather than crashing", () => {
    renderPanel([{ id: "broken", state: "active", startedAt: null }, row("ok", { startedMinutesAgo: 3 })]);
    expect(bodyRows()).toHaveLength(1);
  });

  it("stops its clock when it goes away", () => {
    const { unmount } = renderPanel([row("a", { startedMinutesAgo: 1 })]);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
