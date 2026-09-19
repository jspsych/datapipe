/**
 * @jest-environment node
 */

// Unit coverage for the pure eligibility predicates the two uploadQueue/
// experiments triggers share: capFor and leaseHeld (compaction-triggers.ts)
// and isCompactionSignal (upload-queue-trigger.ts). All three are decided
// from data already in hand -- no Firestore reads, no provider calls -- so
// they are worth testing directly rather than only through the full trigger
// round trip (compaction-emulator.test.js, zenodo-emulator.test.js's
// "C-round-trip" block).
//
// THIS RUNS UNDER THE EMULATOR, NOT AS A BARE UNIT TEST, for a reason that has
// nothing to do with Firestore: compaction-triggers.ts imports compaction.js
// for WATERMARK_RATIO, and compaction.js imports app.js, which calls
// initializeApp() at module scope. Importing the compiled module at all
// therefore needs FIRESTORE_EMULATOR_HOST/FIREBASE_CONFIG set first, exactly
// like every other suite here that touches a module reachable from app.js --
// see upload-queue.test.js's identical framing.
//
// Real providers/index.js is used rather than the mock
// function-capacity-options.test.js installs, because capFor's whole job is
// to run getProvider() against the real registry (zenodo capped, everything
// else not). That drags in every adapter, each importing "node-fetch" at
// module scope -- ESM-only, unparseable by Jest's CJS transform -- so
// node-fetch is stubbed the same way compaction-emulator.test.js and
// upload-queue.test.js stub it. Nothing here makes an HTTP call, so a bare
// jest.fn() is enough.

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: jest.fn(),
}));

let capFor;
let leaseHeld;
let isCompactionSignal;

beforeAll(async () => {
  const triggers = await import("../../lib/compaction-triggers.js");
  capFor = triggers.capFor;
  leaseHeld = triggers.leaseHeld;

  const uploadQueueTrigger = await import("../../lib/upload-queue-trigger.js");
  isCompactionSignal = uploadQueueTrigger.isCompactionSignal;
});

describe("capFor", () => {
  it("returns the cap for a provider that has one (zenodo)", () => {
    expect(capFor({ storageProvider: "zenodo" })).toBe(100);
  });

  it("returns null for a provider with no file-count cap", () => {
    expect(capFor({ storageProvider: "gdrive" })).toBeNull();
    expect(capFor({ storageProvider: "osf" })).toBeNull();
    expect(capFor({ storageProvider: "dataverse" })).toBeNull();
  });

  it("returns null for a document with no storageProvider at all", () => {
    expect(capFor(undefined)).toBeNull();
    expect(capFor({})).toBeNull();
  });

  it("returns null for an unrecognized provider id rather than throwing", () => {
    expect(capFor({ storageProvider: "not-a-real-provider" })).toBeNull();
  });
});

describe("leaseHeld", () => {
  it("is false when there is no compaction.compactingUntil at all", () => {
    expect(leaseHeld(undefined)).toBe(false);
    expect(leaseHeld({})).toBe(false);
    expect(leaseHeld({ compaction: {} })).toBe(false);
  });

  it("is true while compactingUntil is still in the future", () => {
    const until = { toMillis: () => Date.now() + 60000 };
    expect(leaseHeld({ compaction: { compactingUntil: until } })).toBe(true);
  });

  it("is false once compactingUntil has passed", () => {
    const until = { toMillis: () => Date.now() - 60000 };
    expect(leaseHeld({ compaction: { compactingUntil: until } })).toBe(false);
  });
});

describe("isCompactionSignal", () => {
  it("is false when there is no `after` at all (a delete)", () => {
    expect(isCompactionSignal({ status: "pending" }, undefined)).toBe(false);
  });

  it("is true for a write blocked on quota", () => {
    expect(
      isCompactionSignal(undefined, { status: "pending", providerErrorCode: "QUOTA_EXCEEDED" })
    ).toBe(true);
  });

  it("is false for a pending entry blocked on something other than quota", () => {
    expect(
      isCompactionSignal(undefined, { status: "pending", providerErrorCode: "CONTENTION" })
    ).toBe(false);
  });

  it("is true when an entry just landed as completed", () => {
    expect(isCompactionSignal({ status: "processing" }, { status: "completed" })).toBe(true);
  });

  it("is false when an entry was already completed (no state change)", () => {
    expect(isCompactionSignal({ status: "completed" }, { status: "completed" })).toBe(false);
  });

  it("is false for a write that means nothing for capacity", () => {
    expect(
      isCompactionSignal(undefined, { status: "pending", providerErrorCode: "UNAVAILABLE" })
    ).toBe(false);
    expect(isCompactionSignal(undefined, { status: "failed" })).toBe(false);
  });
});
