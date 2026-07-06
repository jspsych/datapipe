/**
 * @jest-environment node
 */

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
process.env.GCLOUD_PROJECT = "datapipe-test";
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
  global.fetch = jest.fn();
});

afterEach(async () => {
  const docs = await db.collection("uploadQueue").where("experimentID", "==", experimentID).get();
  const batch = db.batch();
  docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
});

describe("uploadDerivedFiles", () => {
  it("resolves data/ once and queues exactly the file that failed", async () => {
    const files = [
      { filename: "data/subject-abc_data.csv", content: "main" },
      { filename: "data/measure-x_data.csv", content: "sidecar" },
      { filename: ".psychds-ignore", content: "ignore" },
    ];

    fetch
      .mockReturnValueOnce(listing(["data"])) // resolve data/ once, up front
      .mockReturnValueOnce(fileOk())           // main CSV upload
      .mockReturnValueOnce(fileFail(500, "Server Error")) // sidecar CSV upload fails
      .mockReturnValueOnce(fileOk());          // .psychds-ignore upload

    await uploadDerivedFiles(files, target, TOKEN);

    // Only one "data/"-folder resolution call, despite two files living under data/.
    const dataMetaCalls = fetch.mock.calls.filter(([url]) => url === `${ROOT}?meta=`);
    expect(dataMetaCalls).toHaveLength(1);

    const docs = await db.collection("uploadQueue").where("experimentID", "==", experimentID).get();
    expect(docs.docs).toHaveLength(1);
    expect(docs.docs[0].data().filename).toBe("data/measure-x_data.csv");
  });
});
