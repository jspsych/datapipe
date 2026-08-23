/**
 * @jest-environment node
 */

// Mocked at the module level (matching put-file-osf-ref.test.js /
// providers-osf.test.js / put-file-osf.test.js): the generalized
// metadata-derived-upload.ts routes uploads through getProvider("osf") ->
// osf.ts -> put-file-osf.ts, all of which import their own `fetch` from the
// "node-fetch" package (provider-migration's documented architecture) rather
// than using the global fetch, so assigning global.fetch would never be seen
// by the code under test.
const mockFetch = jest.fn();

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: (...args) => mockFetch(...args),
}));

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
// payload/token crypto: any 64-hex key works in tests
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

const { initializeApp, getApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { uploadDerivedFiles } = require("../../lib/metadata-derived-upload.js");

let app;
try {
  app = getApp();
} catch {
  app = initializeApp();
}

jest.setTimeout(30000);

const db = getFirestore(app);

const ROOT = "https://files.osf.io/v1/resources/abc/providers/osfstorage/";
const TOKEN = "test-token";
// uploadDerivedFiles now takes a ResolvedAuth ({ token, serverUrl? }) rather
// than a bare token string, so that federated providers (Dataverse) can be
// told which server to address. Wrapped here to match that signature.
const AUTH = { token: TOKEN };

const move = (name) => `https://files.osf.io/v1/folder/${name}/`;

const listing = (folderNames) => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({
    data: folderNames.map((n) => ({ attributes: { name: n, kind: "folder" }, links: { move: move(n) } })),
  }),
});
const fileOk = () => Promise.resolve({ status: 201 });
const fileFail = (status, statusText) => Promise.resolve({
  status,
  statusText,
  headers: { get: () => null },
});

const experimentID = "derived-upload-test-exp";
const target = { experimentID, owner: "derived-upload-test-user", osfFilesLink: ROOT };

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(async () => {
  const docs = await db.collection("uploadQueue").where("experimentID", "==", experimentID).get();
  const batch = db.batch();
  docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
});

describe("uploadDerivedFiles", () => {
  it("resolves data/ independently per file now (no shared up-front resolution) and queues exactly the file that failed", async () => {
    const files = [
      { filename: "data/subject-abc_data.csv", content: "main" },
      { filename: "data/measure-x_data.csv", content: "sidecar" },
      { filename: ".psychds-ignore", content: "ignore" },
    ];

    // The up-front "resolve data/ once" optimization was intentionally
    // dropped when uploadDerivedFiles was generalized to route through the
    // provider interface (each writeSessionFile call now walks its own path,
    // independently, so folder-create races are handled inside the adapters
    // rather than by a shared pre-resolution here). Dispatch by request
    // shape rather than a fixed call queue, since the two data/-scoped files
    // now upload concurrently and their folder-lookup/upload calls can
    // interleave.
    mockFetch.mockImplementation((url) => {
      if (url === `${ROOT}?meta=`) {
        return listing(["data"]);
      }
      if (url.includes("name=measure-x_data.csv")) {
        return fileFail(500, "Server Error");
      }
      return fileOk();
    });

    await uploadDerivedFiles(files, target, AUTH);

    // Each of the two files under data/ now resolves its own copy of the
    // "data" folder independently -- one lookup per file, not one shared
    // lookup up front.
    const dataMetaCalls = mockFetch.mock.calls.filter(([url]) => url === `${ROOT}?meta=`);
    expect(dataMetaCalls).toHaveLength(2);

    const docs = await db.collection("uploadQueue").where("experimentID", "==", experimentID).get();
    expect(docs.docs).toHaveLength(1);
    expect(docs.docs[0].data().filename).toBe("data/measure-x_data.csv");
  });

  it("does not throw when data/ resolution fails for every file — each is queued instead", async () => {
    const files = [
      { filename: "data/subject-abc_data.csv", content: "main" },
      { filename: "data/measure-x_data.csv", content: "sidecar" },
      { filename: ".psychds-ignore", content: "ignore" },
    ];

    // OSF is unreachable: every per-file resolveFolder/upload attempt
    // rejects. The best-effort contract requires this never throws and every
    // file ends up queued for retry rather than lost.
    mockFetch.mockRejectedValue(new Error("network down"));

    await expect(uploadDerivedFiles(files, target, AUTH)).resolves.toBeUndefined();

    const docs = await db.collection("uploadQueue").where("experimentID", "==", experimentID).get();
    const queued = docs.docs.map((d) => d.data().filename).sort();
    expect(queued).toEqual([".psychds-ignore", "data/measure-x_data.csv", "data/subject-abc_data.csv"]);
  });
});
