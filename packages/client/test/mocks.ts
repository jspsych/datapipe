// Shared Firebase-database mocking for session.test.ts. The staging tier is
// the Realtime Database SDK, which needs a real socket. Mocked here so the
// behaviour that actually matters -- batching, sequence numbering, the size
// guard, reconnect re-arming, and the promise that none of it can break an
// experiment -- is testable without one.
import { vi } from "vitest";

export const rtdb = {
  update: vi.fn().mockResolvedValue(undefined),
  onDisconnectSet: vi.fn().mockResolvedValue(undefined),
  onDisconnectCancel: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  // The ref each onDisconnect was registered on, in order: which slot got
  // armed.
  armedPaths: [] as string[],
  connectedListener: null as ((snap: { val: () => unknown }) => void) | null,
  deleteApp: vi.fn().mockResolvedValue(undefined),
};

vi.mock("firebase/app", () => ({
  initializeApp: vi.fn((_config: unknown, name: string) => ({ name })),
  deleteApp: (...args: unknown[]) => rtdb.deleteApp(...args),
}));

vi.mock("firebase/database", () => ({
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((_db: unknown, path: string) => ({ path })),
  update: (...args: unknown[]) => rtdb.update(...args),
  set: (...args: unknown[]) => rtdb.set(...args),
  serverTimestamp: () => ({ ".sv": "timestamp" }),
  onDisconnect: vi.fn((reference: { path: string }) => ({
    set: (...args: unknown[]) => {
      rtdb.armedPaths.push(reference.path);
      return rtdb.onDisconnectSet(...args);
    },
    cancel: (...args: unknown[]) => rtdb.onDisconnectCancel(reference.path, ...args),
  })),
  onValue: vi.fn((reference: { path: string }, cb: (snap: { val: () => unknown }) => void) => {
    if (reference.path === ".info/connected") rtdb.connectedListener = cb;
    return () => {
      rtdb.connectedListener = null;
    };
  }),
}));

export function resetRtdbMocks(): void {
  rtdb.connectedListener = null;
  rtdb.update.mockClear().mockResolvedValue(undefined);
  rtdb.onDisconnectSet.mockClear().mockResolvedValue(undefined);
  rtdb.onDisconnectCancel.mockClear().mockResolvedValue(undefined);
  rtdb.set.mockClear().mockResolvedValue(undefined);
  rtdb.armedPaths = [];
  rtdb.deleteApp.mockClear().mockResolvedValue(undefined);
}

export const SESSION_CONFIG = {
  sessionId: "SESSION123",
  databaseURL: "https://datapipe-test-default-rtdb.firebaseio.com",
  maxTrialBytes: 100,
  maxTrials: 10,
  flushIntervalMs: 10000,
  flushEveryNTrials: 3,
  maxDisconnects: 20 as number | undefined,
};

export function mockFetch(impl: (url: string, init?: RequestInit) => any) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const result = impl(url, init);
    return {
      ok: result?.ok ?? true,
      status: result?.status ?? 200,
      json: async () => result,
    };
  });
  (globalThis as any).fetch = fn;
  return fn;
}

/** Route fetch by URL substring; a handler returning an Error rejects. */
export function routeFetch(routes: Record<string, () => any>) {
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch to ${url}`);
    const result = routes[key]();
    if (result instanceof Error) throw result;
    return { ok: result?.ok ?? true, status: result?.status ?? 200, json: async () => result };
  });
  (globalThis as any).fetch = fn;
  return fn;
}

/** The trial payloads in a mocked flush, in the order they were written. */
export function flushedTrials(call: number) {
  const updates = rtdb.update.mock.calls[call][1] as Record<string, string>;
  return Object.entries(updates)
    .filter(([key]) => key.startsWith("trials/"))
    .map(([key, value]) => [key, value] as const);
}
