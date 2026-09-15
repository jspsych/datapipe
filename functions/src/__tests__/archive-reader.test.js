/**
 * @jest-environment node
 */

// Unit coverage for archive-reader.ts's readArchive -- the inverse of
// compaction.ts's buildArchive. buildArchive is the only producer of the
// archives this reads in production (Phase 3 will feed its batch zips back
// through readArchive during finalization), so the round-trip test against
// buildArchive's own output is the one that matters most here: if the two
// ever drift, a finalization pass would silently drop or corrupt data.
//
// archive-reader.ts itself has zero firebase imports and needs no bootstrap,
// but this suite also imports compaction.js for buildArchive, which pulls in
// app.js (initializeApp with no args) and providers/index.js (and therefore
// every adapter, each importing the ESM-only node-fetch at module scope) --
// same env-var and node-fetch mock as compaction.test.js. Nothing here makes
// an HTTP call.
import { randomBytes } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "datapipe-test";
// payload/token crypto: any 64-hex key works in tests
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});
jest.mock("node-fetch", () => ({ __esModule: true, default: jest.fn() }));

let readArchive;
let buildArchive;
let archiver;

beforeAll(async () => {
  readArchive = (await import("../../lib/archive-reader.js")).readArchive;
  buildArchive = (await import("../../lib/compaction.js")).buildArchive;
  archiver = (await import("archiver")).default;
});

/**
 * buildArchive always configures archiver with zlib level 9 and never sets
 * `store: true`, so in practice it emits method 8 (deflate) for every entry
 * regardless of how compressible the content is -- zip-stream (archiver's
 * dependency) only switches to STORED when zlib.level is exactly 0, or the
 * entry is a directory/symlink, or `store` is passed explicitly. So
 * buildArchive itself never exercises method 0, contrary to what the spec's
 * "archiver may choose STORED over DEFLATE" comment implies. The requirement
 * to support method 0 still stands (it's a valid zip and other producers use
 * it), so this builds one directly with archiver's `store` option to get real
 * coverage of that decode path.
 */
function buildStoredArchive(entries) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks = [];
  const collected = new Promise((resolve, reject) => {
    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("warning", reject);
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const entry of entries) {
    archive.append(entry.content, { name: entry.path, date: new Date(0), store: true });
  }
  archive.finalize();
  return collected;
}

describe("readArchive / buildArchive round-trip", () => {
  test("round-trips buildArchive output exactly", async () => {
    const inputs = [
      { path: "dataset_description.json", content: Buffer.from('{"name":"study"}') },
      { path: "data/raw/subject-1.json", content: Buffer.from('{"trials":[1,2,3]}') },
      { path: "data/subject-1_data.csv", content: Buffer.from("a,b\n1,2\n3,4\n") },
    ];
    const { zip } = await buildArchive(inputs);

    const entries = readArchive(zip);

    expect(entries.size).toBe(inputs.length);
    for (const input of inputs) {
      expect(entries.has(input.path)).toBe(true);
      expect(entries.get(input.path).equals(input.content)).toBe(true);
    }
  });

  test("nested paths survive", async () => {
    const { zip } = await buildArchive([
      { path: "data/raw/subject-1.json", content: Buffer.from("{}") },
      { path: "data/raw/deep/nested/path/subject-2.json", content: Buffer.from("{}") },
    ]);

    const entries = readArchive(zip);

    expect([...entries.keys()].sort()).toEqual(
      ["data/raw/deep/nested/path/subject-2.json", "data/raw/subject-1.json"].sort()
    );
  });

  test("non-UTF-8 binary content round-trips byte-identically", async () => {
    const binary = Buffer.from([0x89, 0xff, 0xfe, 0x00, 0x80, 0x00, 0x01, 0x02, 0x89, 0xff]);
    const { zip } = await buildArchive([{ path: "data/blob.bin", content: binary }]);

    const entries = readArchive(zip);

    expect(entries.get("data/blob.bin").equals(binary)).toBe(true);
  });

  test("an empty archive yields an empty Map", async () => {
    const { zip } = await buildArchive([]);

    const entries = readArchive(zip);

    expect(entries.size).toBe(0);
  });

  test("incompressible random bytes round-trip under deflate (buildArchive's actual path)", async () => {
    const random = randomBytes(64 * 1024);
    const { zip } = await buildArchive([{ path: "data/random.bin", content: random }]);

    const entries = readArchive(zip);

    expect(entries.get("data/random.bin").equals(random)).toBe(true);
  });

  test("compression method 0 (stored) round-trips byte-identically", async () => {
    // See buildStoredArchive's comment: buildArchive itself never emits
    // method 0, so this constructs one directly to cover the STORED decode
    // path the spec requires regardless.
    const content = Buffer.from("hello, this entry is stored, not deflated");
    const zip = await buildStoredArchive([{ path: "data/stored.txt", content }]);

    // Confirm the entry really is method 0 before trusting the round-trip --
    // otherwise this would silently degrade into re-testing deflate.
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i -= 1) {
      if (zip.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    const cdOffset = zip.readUInt32LE(eocd + 16);
    expect(zip.readUInt16LE(cdOffset + 10)).toBe(0);

    const entries = readArchive(zip);
    expect(entries.get("data/stored.txt").equals(content)).toBe(true);
  });

  test("a few hundred entries round-trip without offset-arithmetic bugs", async () => {
    const inputs = [];
    for (let i = 0; i < 300; i += 1) {
      inputs.push({
        path: `data/raw/subject-${i}.json`,
        content: Buffer.from(JSON.stringify({ index: i, payload: "x".repeat(i % 50) })),
      });
    }
    const { zip } = await buildArchive(inputs);

    const entries = readArchive(zip);

    expect(entries.size).toBe(inputs.length);
    for (const input of inputs) {
      expect(entries.get(input.path).equals(input.content)).toBe(true);
    }
  });
});

describe("readArchive integrity verification", () => {
  // Phase 3 re-emits a batch archive's members into a merged archive and then
  // DELETES the batch archive -- DataPipe keeps no other copy of submitted
  // data. If readArchive silently accepted a member whose decoded bytes don't
  // match what the archive itself claims, that corruption would be baked into
  // the merged archive, "verified" only by checking that upload succeeded,
  // and then the only surviving copy would be deleted. So every decoded
  // member is checked against the central directory's own crc32 and
  // uncompressed-size fields before being handed back, the same
  // verify-before-delete discipline compaction.ts applies to the provider
  // checksum.

  test("a valid archive still round-trips (integrity checks don't false-positive)", async () => {
    const content = Buffer.from("nothing wrong with this entry");
    const zip = await buildStoredArchive([{ path: "data/fine.txt", content }]);

    const entries = readArchive(zip);

    expect(entries.get("data/fine.txt").equals(content)).toBe(true);
  });

  test("detects a corrupted member via CRC-32 mismatch", async () => {
    // Built STORED, not deflated: a flipped byte in a deflate stream often
    // fails to inflate at all, which would exercise the existing "failed to
    // inflate" path instead of the new CRC check this test targets. STORED
    // has no decode step to fail, so a flipped byte can ONLY be caught by the
    // CRC-32 check -- which is exactly why the spec calls out that stored
    // entries have no integrity check without it.
    const content = Buffer.from("this entry's bytes must not be altered in transit");
    const zip = await buildStoredArchive([{ path: "data/tamper.txt", content }]);

    // Locate the member's actual data bytes the same way readArchive does:
    // central directory entry -> local header offset -> past the local
    // header's name/extra fields. Deliberately NOT touching the central
    // directory itself, so this is a genuine "the bytes changed after the
    // archive was built" corruption, not a relabeled size/crc field.
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i -= 1) {
      if (zip.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    const cdOffset = zip.readUInt32LE(eocd + 16);
    const localHeaderOffset = zip.readUInt32LE(cdOffset + 42);
    const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;

    const corrupted = Buffer.from(zip);
    // Flip a bit in the middle of the member's data. Same length in, same
    // length out, so this can't accidentally also trip the size check --
    // isolating this test to the CRC path specifically.
    corrupted[dataStart + 5] ^= 0xff;

    expect(() => readArchive(corrupted)).toThrow(/data\/tamper\.txt/);
    expect(() => readArchive(corrupted)).toThrow(/crc/i);
  });

  test("rejects a member whose recorded uncompressed size disagrees with reality", async () => {
    const content = Buffer.from("this entry's declared size will be lied about");
    const zip = await buildStoredArchive([{ path: "data/wrong-size.txt", content }]);

    // Tamper only the central directory's uncompressed-size field (offset 24
    // from the entry start) -- the member's actual bytes, and its crc32
    // field, are untouched, so this isolates the size check from the CRC
    // check above.
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i -= 1) {
      if (zip.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    const cdOffset = zip.readUInt32LE(eocd + 16);

    const corrupted = Buffer.from(zip);
    const declaredSize = corrupted.readUInt32LE(cdOffset + 24);
    corrupted.writeUInt32LE(declaredSize + 10, cdOffset + 24);

    expect(() => readArchive(corrupted)).toThrow(/data\/wrong-size\.txt/);
    expect(() => readArchive(corrupted)).toThrow(/size/i);
  });
});

describe("readArchive error handling", () => {
  test("throws a descriptive error for a missing end-of-central-directory record", () => {
    const notAZip = Buffer.from("this is definitely not a zip file, just plain text");

    expect(() => readArchive(notAZip)).toThrow(/end-of-central-directory/i);
  });

  test("throws a descriptive error for a truncated buffer", () => {
    expect(() => readArchive(Buffer.alloc(0))).toThrow();
    expect(() => readArchive(Buffer.from([0x50, 0x4b]))).toThrow();
  });

  test("throws a descriptive error for a corrupt central-directory entry signature", async () => {
    const { zip } = await buildArchive([{ path: "a.json", content: Buffer.from("hi") }]);

    // Find the central directory (EOCD points at it) and flip one byte of the
    // first entry's signature so it no longer reads 0x02014b50.
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i -= 1) {
      if (zip.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    expect(eocd).toBeGreaterThanOrEqual(0);
    const cdOffset = zip.readUInt32LE(eocd + 16);

    const corrupted = Buffer.from(zip);
    corrupted[cdOffset] = 0xff;

    expect(() => readArchive(corrupted)).toThrow(/central directory/i);
  });

  test("throws a descriptive error naming the entry and method for unsupported compression", async () => {
    // Method 8 (deflate) is what buildArchive normally emits for compressible
    // text at zlib level 9; force STORED-vs-DEFLATE is out of our control, so
    // instead we synthesize an entry with an unsupported method (e.g. 12,
    // bzip2) by patching a real central-directory entry's method field.
    const { zip } = await buildArchive([{ path: "a.json", content: Buffer.from("hi") }]);

    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i -= 1) {
      if (zip.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    const cdOffset = zip.readUInt32LE(eocd + 16);

    const corrupted = Buffer.from(zip);
    // Central directory entry method field is at offset +10 from the entry
    // start (see readArchive's own layout comments / the reference in
    // compaction-emulator.test.js).
    corrupted.writeUInt16LE(12, cdOffset + 10);

    expect(() => readArchive(corrupted)).toThrow(/a\.json/);
    expect(() => readArchive(corrupted)).toThrow(/12/);
  });
});
