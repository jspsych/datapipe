/**
 * @jest-environment node
 */

// Unit coverage for compaction.ts's pure helpers -- batch selection, Psych-DS
// path reconstruction, archive building and checksum comparison.
//
// The end-to-end cycle (upload, verify, seal, delete, resume) lives in
// compaction-emulator.test.js, which also parses the produced zip to prove
// byte fidelity. What is here is the logic that decides WHICH files get
// archived and WHERE they land inside it -- the two things that, if wrong,
// would either lose data or produce an archive that is not a valid Psych-DS
// tree.

import { createHash } from "crypto";

// compaction.js imports app.js (initializeApp with no args) transitively, so
// these have to be set before the dynamic import below -- same bootstrap as
// upload-queue.test.js.
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "datapipe-test";
// payload/token crypto: any 64-hex key works in tests
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

// compaction.js pulls in providers/index.js and therefore every adapter, each
// of which imports the ESM-only node-fetch at module scope. Nothing in this
// suite makes an HTTP call.
jest.mock("node-fetch", () => ({ __esModule: true, default: jest.fn() }));

let selectBatch;
let archivePathsFor;
let buildArchive;
let checksumMatches;
let archiveNameForIndex;
let isArchiveName;
let zenodoProvider;
let fromZenodoKey;

beforeAll(async () => {
  const compaction = await import("../../lib/compaction.js");
  selectBatch = compaction.selectBatch;
  archivePathsFor = compaction.archivePathsFor;
  buildArchive = compaction.buildArchive;
  checksumMatches = compaction.checksumMatches;
  archiveNameForIndex = compaction.archiveNameForIndex;
  isArchiveName = compaction.isArchiveName;

  const zenodo = await import("../../lib/providers/zenodo.js");
  zenodoProvider = zenodo.zenodoProvider;
  fromZenodoKey = zenodo.fromZenodoKey;
});

const file = (name, size) => ({ name, id: name, size });

describe("1. archive naming", () => {
  test("indexes are zero-padded and round-trip through isArchiveName", () => {
    expect(archiveNameForIndex(1)).toBe("datapipe-batch-0001.zip");
    expect(archiveNameForIndex(42)).toBe("datapipe-batch-0042.zip");
    expect(isArchiveName(archiveNameForIndex(1))).toBe(true);
  });

  test("researcher files are never mistaken for archives", () => {
    // The consequence of a false positive here is silent data loss: an archive
    // is excluded from batch selection, so a session misread as one would
    // never be compacted -- and, worse, a session named to LOOK like an
    // archive would be skipped forever while counting against the cap.
    expect(isArchiveName("datapipe-batch-1.zip")).toBe(false);
    expect(isArchiveName("datapipe-batch-0001.zip.json")).toBe(false);
    expect(isArchiveName("my-datapipe-batch-0001.zip")).toBe(false);
    expect(isArchiveName("subject-1.json")).toBe(false);
  });
});

describe("2. Psych-DS path reconstruction (Zenodo's flat keyspace)", () => {
  test("the four shapes DataPipe writes are restored exactly", () => {
    expect(fromZenodoKey("data_raw_subject-1.json")).toBe("data/raw/subject-1.json");
    expect(fromZenodoKey("data_subject-1_data.csv")).toBe("data/subject-1_data.csv");
    expect(fromZenodoKey("dataset_description.json")).toBe("dataset_description.json");
    expect(fromZenodoKey(".psychds-ignore")).toBe(".psychds-ignore");
  });

  test("dataset_description.json is not dragged into a data/ folder", () => {
    // The near-miss that makes this worth an explicit test: the key begins
    // with "data", and only the absence of an underscore at index 4 keeps it
    // out of the `data_` branch. Burying the record's own Psych-DS descriptor
    // inside data/ would invalidate the tree.
    expect(fromZenodoKey("dataset_description.json").startsWith("data/")).toBe(false);
  });

  test("underscores inside a leaf survive, because only the prefix is consumed", () => {
    expect(fromZenodoKey("data_raw_my_subject_01.json")).toBe("data/raw/my_subject_01.json");
    expect(fromZenodoKey("data_condition-A-run_2_data.csv")).toBe("data/condition-A-run_2_data.csv");
  });

  test("the round trip from a real Psych-DS path is lossless", () => {
    // toZenodoKey is what the write path applies; archivePathFor has to undo
    // exactly it, for exactly the paths metadata-derived-files.ts produces.
    for (const path of ["data/raw/subject-1.json", "data/subject-1_data.csv", "data/s_measure-rt_data.csv"]) {
      const stored = zenodoProvider.storedNameFor(path);
      expect(stored).not.toContain("/");
      expect(zenodoProvider.archivePathFor(stored)).toBe(path);
    }
  });
});

describe("3. archivePathsFor", () => {
  const names = ["data_raw_subject-1.json", "data_subject-1_data.csv"];

  test("reconstructs paths for a metadataActive experiment", () => {
    const paths = archivePathsFor(zenodoProvider, true, names);
    expect(paths.get("data_raw_subject-1.json")).toBe("data/raw/subject-1.json");
    expect(paths.get("data_subject-1_data.csv")).toBe("data/subject-1_data.csv");
  });

  test("leaves names alone when metadata is off", () => {
    // The gate that makes the reconstruction safe. A plain experiment writes
    // no slashed path at all, so a researcher's own `data_notes.json` must not
    // be "restored" into a data/ folder that never existed.
    const paths = archivePathsFor(zenodoProvider, false, ["data_notes.json", ...names]);
    expect(paths.get("data_notes.json")).toBe("data_notes.json");
    expect(paths.get("data_raw_subject-1.json")).toBe("data_raw_subject-1.json");
  });

  test("providers with real folders are identity even when metadata is on", () => {
    const noReverse = { ...zenodoProvider, archivePathFor: undefined };
    const paths = archivePathsFor(noReverse, true, names);
    expect(paths.get("data_raw_subject-1.json")).toBe("data_raw_subject-1.json");
  });

  test("a path collision falls back to the flat name rather than duplicating", () => {
    // Cannot happen with the shipped Zenodo mapping, but two zip members at
    // one path is silent corruption, so the guard is asserted rather than
    // assumed for future adapters.
    const collidingProvider = { ...zenodoProvider, archivePathFor: () => "data/same.json" };
    const paths = archivePathsFor(collidingProvider, true, ["a.json", "b.json"]);
    expect(paths.get("a.json")).toBe("data/same.json");
    expect(paths.get("b.json")).toBe("b.json");
    expect(new Set([...paths.values()]).size).toBe(2);
  });
});

describe("4. selectBatch", () => {
  const sessions = (n, size = 1000) =>
    Array.from({ length: n }, (_, i) => file(`data_raw_subject-${i + 1}.json`, size));

  test("never archives the record's own descriptor or the ignore file", () => {
    // dataset_description.json is what metadata-block.ts holds a ref to and
    // rewrites per submission; .psychds-ignore is rewritten per submission
    // too. Archiving either would break a ref or immediately churn.
    const batch = selectBatch(
      [...sessions(30), file("dataset_description.json", 100), file(".psychds-ignore", 20)],
      { keepLoose: 0 }
    );
    const names = batch.map((f) => f.name);
    expect(names).not.toContain("dataset_description.json");
    expect(names).not.toContain(".psychds-ignore");
    expect(batch).toHaveLength(30);
  });

  test("previously sealed archives are never re-archived", () => {
    const batch = selectBatch([file("datapipe-batch-0001.zip", 5000), ...sessions(10)], { keepLoose: 0 });
    expect(batch.map((f) => f.name)).not.toContain("datapipe-batch-0001.zip");
    expect(batch).toHaveLength(10);
  });

  test("files whose claims are already sealed are skipped", () => {
    // The resume case: a previous pass archived these and died before
    // deleting them. Re-archiving would put the same session in two zips.
    const alreadySealed = new Set(["data_raw_subject-1.json", "data_raw_subject-2.json"]);
    const batch = selectBatch(sessions(10), { keepLoose: 0, alreadySealed });
    expect(batch).toHaveLength(8);
    expect(batch.map((f) => f.name)).not.toContain("data_raw_subject-1.json");
  });

  test("the tail of the listing stays loose for spot-checking", () => {
    const batch = selectBatch(sessions(50), { keepLoose: 20 });
    expect(batch).toHaveLength(30);
    expect(batch.map((f) => f.name)).not.toContain("data_raw_subject-50.json");
    expect(batch.map((f) => f.name)).toContain("data_raw_subject-1.json");
  });

  test("keepLoose counts real sessions, not archives or protected files", () => {
    // Counting a zip toward keepLoose would leave fewer sessions loose than
    // promised, and eventually make a full record un-compactable.
    const files = [
      file("datapipe-batch-0001.zip", 5000),
      file("dataset_description.json", 100),
      ...sessions(25),
    ];
    const batch = selectBatch(files, { keepLoose: 20 });
    expect(batch).toHaveLength(5);
  });

  test("nothing is archived when there is nothing beyond the loose tail", () => {
    expect(selectBatch(sessions(15), { keepLoose: 20 })).toHaveLength(0);
  });

  test("the file count bound applies", () => {
    expect(selectBatch(sessions(200), { keepLoose: 0, maxFiles: 60 })).toHaveLength(60);
  });

  test("the byte budget stops a batch early", () => {
    // The memory guard: a base64 experiment collecting video has files orders
    // of magnitude larger than a JSON session, and the whole batch is held in
    // memory at once.
    const batch = selectBatch(sessions(20, 10 * 1024 * 1024), {
      keepLoose: 0,
      maxBytes: 45 * 1024 * 1024,
    });
    expect(batch).toHaveLength(4);
  });

  test("a single oversized file is still archived rather than wedging the study", () => {
    // If the first file alone blows the budget, skipping it would mean this
    // experiment could never compact and would stay stuck at the cap forever.
    const batch = selectBatch([file("huge.dat", 900 * 1024 * 1024), ...sessions(3)], {
      keepLoose: 0,
      maxBytes: 45 * 1024 * 1024,
    });
    expect(batch).toHaveLength(1);
    expect(batch[0].name).toBe("huge.dat");
  });

  test("an unreported size does not block a batch", () => {
    const batch = selectBatch([file("a.json"), file("b.json")], { keepLoose: 0 });
    expect(batch).toHaveLength(2);
  });
});

describe("5. checksumMatches", () => {
  const md5 = createHash("md5").update("hello").digest("hex");

  test("accepts the provider's decorated form", () => {
    expect(checksumMatches(`md5:${md5}`, md5)).toBe(true);
    expect(checksumMatches(md5, md5)).toBe(true);
    expect(checksumMatches(`MD5:${md5.toUpperCase()}`, md5)).toBe(true);
  });

  test("a missing checksum is a mismatch, never a pass", () => {
    // This is the gate that decides whether the originals get deleted. An
    // unverifiable upload has to read as unverified, or a provider that
    // silently stopped reporting checksums would start authorizing deletes.
    expect(checksumMatches(undefined, md5)).toBe(false);
    expect(checksumMatches("", md5)).toBe(false);
  });

  test("a wrong checksum is rejected", () => {
    expect(checksumMatches("md5:0000", md5)).toBe(false);
  });
});

describe("6. buildArchive", () => {
  test("is deterministic, so a rebuilt archive has the same md5", () => {
    // Timestamps are pinned in the zip entries for this reason: a resumed pass
    // compares against a recorded md5, and a clock-dependent archive would
    // never match itself.
    return Promise.all([
      buildArchive([{ path: "data/raw/a.json", content: Buffer.from('{"x":1}') }]),
      buildArchive([{ path: "data/raw/a.json", content: Buffer.from('{"x":1}') }]),
    ]).then(([first, second]) => {
      expect(first.md5).toBe(second.md5);
      expect(first.zip.equals(second.zip)).toBe(true);
    });
  });

  test("the reported md5 is of the archive bytes themselves", async () => {
    const { zip, md5 } = await buildArchive([{ path: "a.json", content: Buffer.from("hi") }]);
    expect(md5).toBe(createHash("md5").update(zip).digest("hex"));
  });

  test("member paths are written into the archive", async () => {
    // A light structural check; compaction-emulator.test.js parses the zip
    // properly and asserts byte-for-byte member fidelity.
    const { zip } = await buildArchive([
      { path: "data/raw/subject-1.json", content: Buffer.from("{}") },
      { path: "data/subject-1_data.csv", content: Buffer.from("a,b\n1,2\n") },
    ]);
    expect(zip.includes(Buffer.from("data/raw/subject-1.json"))).toBe(true);
    expect(zip.includes(Buffer.from("data/subject-1_data.csv"))).toBe(true);
  });

  test("an empty archive is still a valid zip", async () => {
    const { zip } = await buildArchive([]);
    expect(zip.length).toBeGreaterThan(0);
    expect(zip.subarray(zip.length - 22, zip.length - 18)).toEqual(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  });
});
