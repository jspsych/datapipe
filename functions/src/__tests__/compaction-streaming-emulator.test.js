/**
 * @jest-environment node
 */

// Emulator coverage for compaction.ts's streaming archive builder
// (buildArchiveToStorage), added for finalization (docs/finalization-spec.md).
//
// WHY THIS NEEDS THE EMULATOR, unlike compaction.test.js's coverage of
// buildArchive: buildArchive assembles the whole zip in memory and hands back
// a Buffer, so it is pure and needs nothing beyond archiver itself.
// buildArchiveToStorage instead pipes archiver straight into
// storage.bucket().file(storagePath).createWriteStream() -- that is the
// entire point, since holding a whole study's archive in memory is the wall
// this exists to remove -- so exercising it for real means writing through
// the Storage emulator, not a fake.
//
// Bootstrap mirrors compaction-emulator.test.js: process.env is set before a
// deferred dynamic import so app.js/compaction.js pick up the emulator hosts
// when they first evaluate, and node-fetch is stubbed even though this file
// never calls it, because compaction.ts pulls in the whole provider registry
// (every adapter imports node-fetch at module scope) and it is ESM-only, so
// Jest's CJS transform cannot parse it unmocked.

const mockFetch = jest.fn();
jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

import { randomUUID, createHash } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

jest.setTimeout(60000);

const md5 = (buffer) => createHash("md5").update(buffer).digest("hex");

let storage;
let buildArchive;
let buildArchiveToStorage;

beforeAll(async () => {
  // Deferred so the process.env assignments above are in place when app.js
  // first evaluates (same reasoning as compaction-emulator.test.js).
  const app = await import("../../lib/app.js");
  storage = app.storage;

  const compaction = await import("../../lib/compaction.js");
  buildArchive = compaction.buildArchive;
  buildArchiveToStorage = compaction.buildArchiveToStorage;
});

function scratchPath(name) {
  return `finalization-test/${randomUUID()}-${name}`;
}

async function readBack(storagePath) {
  const [contents] = await storage.bucket().file(storagePath).download();
  return contents;
}

async function* toAsyncIterable(items) {
  for (const item of items) {
    yield item;
  }
}

const SAMPLE_ENTRIES = [
  { path: "dataset_description.json", content: Buffer.from(JSON.stringify({ name: "study" })) },
  { path: "data/raw/subject-1.json", content: Buffer.from(JSON.stringify({ subject: 1, rt: 400 })) },
  // A larger, non-UTF-8-safe entry, so the comparison isn't only exercising
  // tiny JSON payloads.
  { path: "data/raw/subject-2.json", content: Buffer.concat([Buffer.from("x".repeat(4096)), Buffer.from([0x00, 0xff, 0xfe])]) },
];

describe("buildArchiveToStorage", () => {
  it("is byte-identical to buildArchive for the same input, including the pinned entry dates", async () => {
    const inMemory = await buildArchive(SAMPLE_ENTRIES);

    const storagePath = scratchPath("identical.zip");
    const streamed = await buildArchiveToStorage(toAsyncIterable(SAMPLE_ENTRIES), storagePath);

    const uploaded = await readBack(storagePath);

    // The whole point of the pinned `date: new Date(0)` on every entry: two
    // builders driven by the same archiver library should be able to produce
    // byte-for-byte identical zips for the same input, not just
    // content-equivalent ones.
    expect(uploaded.equals(inMemory.zip)).toBe(true);
    expect(streamed.size).toBe(inMemory.zip.length);
    expect(streamed.md5).toBe(inMemory.md5);
  });

  it("computes the md5 of the emitted bytes in-flight, matching the uploaded object", async () => {
    const storagePath = scratchPath("md5.zip");
    const result = await buildArchiveToStorage(toAsyncIterable(SAMPLE_ENTRIES), storagePath);
    const uploaded = await readBack(storagePath);

    expect(result.md5).toBe(md5(uploaded));
    expect(result.size).toBe(uploaded.length);
  });

  // The whole reason this function exists: entries.downloadFileBytes is
  // called just-in-time by the caller's generator, so at most one member's
  // bytes should ever be resident here. A generator that gates production of
  // its NEXT item on an external release proves the consumer requests items
  // one at a time rather than draining the iterable up front (e.g. into an
  // array) before archiving/uploading anything.
  it("consumes entries lazily, one at a time, rather than draining the iterable up front", async () => {
    const TOTAL = 6;
    let yielded = 0;
    let release;
    const nextGate = () => new Promise((resolve) => { release = resolve; });

    async function* controlledEntries() {
      for (let i = 1; i <= TOTAL; i += 1) {
        yielded += 1;
        yield { path: `item-${i}.txt`, content: Buffer.from(`content-${i}`) };
        // Blocks producing the NEXT item until the test releases it -- if
        // buildArchiveToStorage ever collected the whole iterable before
        // doing any work, this generator would never advance past item 1 and
        // the assertions below would time out rather than pass.
        // eslint-disable-next-line no-await-in-loop
        await nextGate();
      }
    }

    const storagePath = scratchPath("lazy.zip");
    const resultPromise = buildArchiveToStorage(controlledEntries(), storagePath);

    await new Promise((resolve) => setImmediate(resolve));
    expect(yielded).toBe(1);

    for (let i = 1; i < TOTAL; i += 1) {
      const currentRelease = release;
      currentRelease();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setImmediate(resolve));
      expect(yielded).toBe(i + 1);
    }
    release();

    const result = await resultPromise;
    expect(result.size).toBeGreaterThan(0);
  });

  // A batch download failing mid-stream (the real-world trigger: a provider
  // read errors out while finalization is re-emitting a batch's members) must
  // reject the promise, not leave it pending forever.
  it("propagates an error thrown by the entries iterable as a rejection", async () => {
    async function* failingEntries() {
      yield { path: "a.txt", content: Buffer.from("a") };
      throw new Error("download exploded mid-stream");
    }

    await expect(buildArchiveToStorage(failingEntries(), scratchPath("failure.zip"))).rejects.toThrow(
      /download exploded mid-stream/
    );
  });

  it("handles an empty iterable without hanging", async () => {
    const storagePath = scratchPath("empty.zip");
    const result = await buildArchiveToStorage(toAsyncIterable([]), storagePath);
    const uploaded = await readBack(storagePath);
    expect(result.size).toBe(uploaded.length);
    expect(result.md5).toBe(md5(uploaded));
  });
});
