import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_CONFIG,
  flushedTrials,
  mockFetch,
  resetRtdbMocks,
  routeFetch,
  rtdb,
} from "./mocks";
import { setBaseURL } from "../src/http.js";
import { DataPipeSession, createSession, startSession } from "../src/session.js";

/** A started session backed by the mocked SDK. */
async function newSession(overrides: Partial<typeof SESSION_CONFIG> = {}) {
  mockFetch(() => ({ ...SESSION_CONFIG, ...overrides }));
  return startSession({ experimentID: "EXP12345", filename: "p01.csv" });
}

/** A fetch mock whose response is released by calling the returned function. */
function deferredFetch(): (result: any) => void {
  let release!: (result: any) => void;
  const gate = new Promise<any>((resolve) => {
    release = resolve;
  });
  (globalThis as any).fetch = vi.fn(async () => {
    const result = await gate;
    return { ok: result?.ok ?? true, status: result?.status ?? 200, json: async () => result };
  });
  return release;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRtdbMocks();
  setBaseURL("");
});

afterEach(() => {
  delete (globalThis as any).fetch;
});

describe("startSession", () => {
  it("posts the experiment id and filename, and arms disconnect detection", async () => {
    const fetchMock = mockFetch(() => SESSION_CONFIG);

    const session = await startSession({ experimentID: "EXP12345", filename: "p01.csv" });

    expect(fetchMock.mock.calls[0][0]).toBe("https://pipe.jspsych.org/api/session/");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      experimentID: "EXP12345",
      filename: "p01.csv",
    });
    expect(session.enabled).toBe(true);
    expect(session.sessionId).toBe("SESSION123");
    // Firebase's servers, not a heartbeat, are what detect abandonment -- on
    // the first connection's own slot.
    expect(rtdb.armedPaths).toEqual(["staging/SESSION123/meta/disconnects/1"]);
  });

  // Every one of these is a way a session could be broken by a feature whose
  // entire purpose is to prevent data loss. They must all degrade to "submit
  // once at the end", silently.
  it.each([
    ["the endpoint refuses", () => mockFetch(() => ({ ok: false, status: 400 }))],
    [
      "the endpoint is unreachable",
      () => {
        (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error("offline"));
      },
    ],
    ["the response is incomplete", () => mockFetch(() => ({ sessionId: "x" }))],
  ])("returns an inert session when %s", async (_label, setup) => {
    setup();

    const session = await startSession({ experimentID: "EXP12345" });

    expect(session).toBeInstanceOf(DataPipeSession);
    expect(session.enabled).toBe(false);
    expect(session.sessionId).toBe("");
    // And using it does nothing, rather than throwing.
    expect(() => session.record({ rt: 1 })).not.toThrow();
    await expect(session.flush()).resolves.toBeUndefined();
    await expect(session.close()).resolves.toBeUndefined();
    expect(rtdb.update).not.toHaveBeenCalled();
  });

  it("returns an inert session with no experiment id", async () => {
    const session = await startSession({ experimentID: "" });

    expect(session.enabled).toBe(false);
  });
});

describe("createSession (synchronous, pre-start buffering)", () => {
  it("stages trials recorded before the start round trip resolves", async () => {
    const release = deferredFetch();

    const session = createSession({ experimentID: "EXP12345", filename: "p01.csv" });
    expect(session.enabled).toBe(false);
    session.record({ trial: 0 });
    session.record({ trial: 1 });
    expect(rtdb.update).not.toHaveBeenCalled();

    release(SESSION_CONFIG);
    await vi.waitFor(() => expect(session.enabled).toBe(true));
    await vi.waitFor(() => expect(rtdb.update).toHaveBeenCalledTimes(1));

    expect(session.sessionId).toBe("SESSION123");
    expect(flushedTrials(0)).toEqual([
      ["trials/0", '{"trial":0}'],
      ["trials/1", '{"trial":1}'],
    ]);
  });

  it("discards buffered trials and stays disabled when the start fails", async () => {
    const release = deferredFetch();

    const session = createSession({ experimentID: "EXP12345" });
    session.record({ trial: 0 });
    session.record({ trial: 1 });

    release({ ok: false, status: 400 });
    await vi.waitFor(() => expect(session.enabled).toBe(false));

    // Give any stray microtasks a chance to run, then confirm nothing was
    // ever staged.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rtdb.update).not.toHaveBeenCalled();
    expect(() => session.record({ trial: 2 })).not.toThrow();
    await expect(session.flush()).resolves.toBeUndefined();
  });

  it("warns once and stops accumulating past the pending-buffer cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const release = deferredFetch();

    const session = createSession({ experimentID: "EXP12345" });
    for (let i = 0; i < 520; i++) session.record({ trial: i });

    // A generous server-side ceiling, so this test exercises only the
    // PRE-START buffer's own 500-trial cap, not the ordinary maxTrials
    // admission check (covered separately above).
    release({ ...SESSION_CONFIG, maxTrials: 10000, flushEveryNTrials: 10000 });
    await vi.waitFor(() => expect(session.enabled).toBe(true));
    await vi.waitFor(() => expect(rtdb.update.mock.calls.length).toBeGreaterThan(0));

    const staged = rtdb.update.mock.calls.flatMap((_, i) => flushedTrials(i));
    expect(staged.length).toBe(500);

    const capWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes("500 trials were recorded before the session finished starting")
    );
    expect(capWarnings).toHaveLength(1);
    warn.mockRestore();
  });

  it("close() called before the start resolves still cancels the disconnect stamp", async () => {
    const release = deferredFetch();

    const session = createSession({ experimentID: "EXP12345" });
    session.record({ trial: 0 });
    const closePromise = session.close();

    release(SESSION_CONFIG);
    await closePromise;

    expect(flushedTrials(0)).toEqual([["trials/0", '{"trial":0}']]);
    expect(rtdb.onDisconnectCancel).toHaveBeenCalledTimes(1);
    expect(session.enabled).toBe(false);
  });

  it("flush() called before the start resolves waits for it", async () => {
    const release = deferredFetch();

    const session = createSession({ experimentID: "EXP12345" });
    session.record({ trial: 0 });
    const flushPromise = session.flush();

    release(SESSION_CONFIG);
    await flushPromise;

    expect(flushedTrials(0)).toEqual([["trials/0", '{"trial":0}']]);
  });

  it("a trial recorded after close() is requested is not staged", async () => {
    const release = deferredFetch();

    const session = createSession({ experimentID: "EXP12345" });
    session.record({ trial: 0 });
    const closePromise = session.close();
    session.record({ trial: 1 }); // recorded after close() was called

    release(SESSION_CONFIG);
    await closePromise;

    expect(flushedTrials(0)).toEqual([["trials/0", '{"trial":0}']]);
  });
});

describe("recording trials", () => {
  it("batches trials rather than writing one at a time", async () => {
    const session = await newSession();

    session.record({ trial: 0 });
    session.record({ trial: 1 });
    expect(rtdb.update).not.toHaveBeenCalled();

    session.record({ trial: 2 }); // flushEveryNTrials
    await session.flush();

    expect(rtdb.update).toHaveBeenCalledTimes(1);
    expect(flushedTrials(0)).toEqual([
      ["trials/0", '{"trial":0}'],
      ["trials/1", '{"trial":1}'],
      ["trials/2", '{"trial":2}'],
    ]);
  });

  it("stamps liveness in the same write as the trials", async () => {
    const session = await newSession();

    session.record({ trial: 0 });
    await session.flush();

    expect(rtdb.update.mock.calls[0][1]).toHaveProperty("meta/lastFlushAt");
  });

  it("numbers trials continuously across flushes", async () => {
    const session = await newSession();

    session.record({ trial: 0 });
    await session.flush();
    session.record({ trial: 1 });
    await session.flush();

    expect(flushedTrials(0)).toEqual([["trials/0", '{"trial":0}']]);
    expect(flushedTrials(1)).toEqual([["trials/1", '{"trial":1}']]);
  });

  it("does not reuse sequence numbers after a failed flush", async () => {
    const session = await newSession();
    rtdb.update.mockRejectedValueOnce(new Error("network"));

    session.record({ trial: 0 });
    await session.flush();
    session.record({ trial: 1 });
    await session.flush();

    expect(flushedTrials(1)).toEqual([["trials/1", '{"trial":1}']]);
  });

  it("survives a flush that rejects", async () => {
    const session = await newSession();
    rtdb.update.mockRejectedValue(new Error("network"));

    session.record({ trial: 0 });

    await expect(session.flush()).resolves.toBeUndefined();
  });

  it("skips an oversized trial without consuming its sequence number", async () => {
    const session = await newSession();

    session.record({ big: "x".repeat(SESSION_CONFIG.maxTrialBytes) });
    session.record({ trial: 1 });
    await session.flush();

    expect(flushedTrials(0)).toEqual([["trials/0", '{"trial":1}']]);
  });

  it("skips a trial that cannot be serialized", async () => {
    const session = await newSession();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => session.record(circular)).not.toThrow();
    session.record({ trial: 1 });
    await session.flush();

    expect(flushedTrials(0)).toEqual([["trials/0", '{"trial":1}']]);
  });

  it("stops staging at the trial ceiling instead of writing rejected keys", async () => {
    const session = await newSession({ maxTrials: 2, flushEveryNTrials: 1 });

    session.record({ trial: 0 });
    session.record({ trial: 1 });
    session.record({ trial: 2 });
    await session.flush();

    expect(session.enabled).toBe(false);
    const written = rtdb.update.mock.calls.flatMap((_, i) => flushedTrials(i));
    expect(written.map(([key]) => key)).toEqual(["trials/0", "trials/1"]);
  });
});

describe("reconnecting", () => {
  /** Simulate the SDK reporting a drop and a return. */
  async function dropAndReturn() {
    rtdb.connectedListener!({ val: () => false });
    rtdb.connectedListener!({ val: () => true });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("answers the dropped connection's slot and arms the next one", async () => {
    const session = await newSession();
    expect(session.enabled).toBe(true);

    // The SDK reports the initial connection too; that one must not re-arm.
    rtdb.connectedListener!({ val: () => true });
    await Promise.resolve();
    expect(rtdb.set).not.toHaveBeenCalled();

    await dropAndReturn();

    expect(rtdb.set).toHaveBeenCalledWith(
      { path: "staging/SESSION123/meta/reconnects/1" },
      { ".sv": "timestamp" }
    );
    expect(rtdb.armedPaths).toEqual([
      "staging/SESSION123/meta/disconnects/1",
      "staging/SESSION123/meta/disconnects/2",
    ]);
  });

  it("stops arming at the server's slot cap instead of having stamps refused", async () => {
    const session = await newSession({ maxDisconnects: 3 });
    rtdb.connectedListener!({ val: () => true });
    await Promise.resolve();

    for (let i = 0; i < 5; i++) await dropAndReturn();

    expect(rtdb.armedPaths).toEqual([
      "staging/SESSION123/meta/disconnects/1",
      "staging/SESSION123/meta/disconnects/2",
      "staging/SESSION123/meta/disconnects/3",
    ]);
    expect(session.enabled).toBe(true); // staging itself carries on
  });

  it("never re-arms past the first slot when the server does not say a cap", async () => {
    // No DEFAULT_MAX_DISCONNECTS in this library: an absent maxDisconnects
    // is treated conservatively (one slot only) rather than assuming a
    // number that could drift from the rules.
    await newSession({ maxDisconnects: undefined });
    rtdb.connectedListener!({ val: () => true });
    await Promise.resolve();

    for (let i = 0; i < 5; i++) await dropAndReturn();

    expect(rtdb.armedPaths).toEqual(["staging/SESSION123/meta/disconnects/1"]);
  });
});

describe("closing", () => {
  it("flushes the tail, cancels the marker, and releases the connection", async () => {
    const session = await newSession();
    session.record({ trial: 0 });

    await session.close();

    expect(flushedTrials(0)).toEqual([["trials/0", '{"trial":0}']]);
    expect(rtdb.onDisconnectCancel).toHaveBeenCalledTimes(1);
    expect(rtdb.deleteApp).toHaveBeenCalledTimes(1);
    expect(session.enabled).toBe(false);
  });

  it("is safe to call twice", async () => {
    const session = await newSession();

    await session.close();
    await session.close();

    expect(rtdb.onDisconnectCancel).toHaveBeenCalledTimes(1);
  });

  it("still closes when cancelling the marker fails", async () => {
    const session = await newSession();
    rtdb.onDisconnectCancel.mockRejectedValueOnce(new Error("offline"));

    await expect(session.close()).resolves.toBeUndefined();
    expect(session.enabled).toBe(false);
  });

  it("stamps the session abandoned when told the submission did not arrive", async () => {
    const session = await newSession();
    session.record({ trial: 0 });

    await session.close({ submitted: false });

    expect(rtdb.set).toHaveBeenCalledWith(
      { path: "staging/SESSION123/meta/disconnects/1" },
      { ".sv": "timestamp" }
    );
    expect(rtdb.onDisconnectCancel).not.toHaveBeenCalled();
  });
});

describe("routeFetch smoke test", () => {
  it("routes by URL and can simulate a rejected fetch", async () => {
    routeFetch({ "/api/session/": () => new TypeError("Failed to fetch") });

    const session = await startSession({ experimentID: "EXP12345" });

    expect(session.enabled).toBe(false);
  });
});
