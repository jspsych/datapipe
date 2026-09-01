/**
 * @jest-environment node
 */

// RED-phase integration tests for step 3b (docs/provider-migration-design.md,
// scratchpad/step3b-metadata-ref-spec.md), cases 3-8 of the test plan.
//
// Follows the inline-mock-OSF-server pattern established by
// collision-integration-emulator.test.js: a self-contained express server
// started on an OS-assigned port (`listen(0)`), with in-process (not HTTP)
// controls for call counts and forced statuses, rather than extending the
// shared fixed-port mock-server.ts used by metadata-emulator.test.js. That
// server can only express a single fixed GET/PUT pair; this test plan needs
// a controllable listing body (case 5), an update route keyed by file id
// (cases 4/5/7), and forced statuses on specific ids (case 7's 404), none of
// which mock-server.ts supports. mock-server.ts itself is untouched.
//
// Until metadata-block.ts is rewritten to read/store metadataFileRef, most
// assertions below fail on missing/incorrect behavior -- metadataFileRef
// never appears on the metadata doc, the 210-bug branch always throws
// (case 6), stale refs are never retried via self-heal (case 7) -- rather
// than on any transport-level or setup problem.

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import express from "express";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
const OWNER_ID = "metadata-ref-owner";

const sampleData = `[{"trial_type":"html-keyboard-response","trial_index":1,"time_elapsed":776}]`;

// A valid Psych-DS-shaped metadata object. metadata-update.ts's updateMetadata
// (the real, unmocked production function) reads `variableMeasured` and
// throws "Invalid metadata format" on anything else, so seeded firestore
// metadata must have this shape or these tests would fail for the wrong
// reason (an unrelated throw, not the behavior under test).
const existingMetadata = { variableMeasured: [{ name: "existing_var" }] };

async function saveData(body) {
  const response = await fetch("http://localhost:5001/datapipe-test/us-central1/apidata", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body),
  });
  const message = await response.json();
  return { status: response.status, body: message };
}

// A minimal, self-contained mock OSF "files" container:
//   GET  /files       -> osfProvider.listFiles                 (?meta=)
//   PUT  /files       -> osfProvider.writeSessionFile / putFileOSF (create)
//   PUT  /files/:id   -> osfProvider.updateFile / updateFileOSF (update)
// filesLink is handed out with a trailing slash so that update-file-osf.ts's
// `${osfComponent}${fileId}` concatenation produces `/files/<id>` rather than
// `/files<id>`.
function createMockOSFServer() {
  const app = express();

  let listingContents = [];
  let nextId = 1;
  let nextFolderId = 1;
  const createCallsByFilename = new Map();
  const updateCallsById = new Map();
  let listingCallCount = 0;
  const forcedCreateStatus = new Map();
  const forcedUpdateStatus = new Map();

  app.get("/files", (req, res) => {
    listingCallCount += 1;
    res.json({ data: listingContents });
  });

  // Handles both a file create (kind=file, the pre-existing behavior) and a
  // folder create (kind=folder). The latter is new: now that a
  // metadata-active raw file uploads under data/raw/ (Psych-DS layout),
  // subfolder.ts's resolveFolder needs to walk/create that path, and its
  // folder-create step requires a WaterButler-shaped `data.links.move` in the
  // response (see subfolder.ts) -- without it resolveFolder throws and the
  // raw upload gets queued instead of succeeding. The shape mirrors
  // put-file-osf.test.js's `folderCreated` helper.
  function handleFilesPut(req, res) {
    const filename = String(req.query.name || "");

    if (req.query.kind === "folder") {
      const moveLink = `${req.protocol}://${req.get("host")}/folder-${nextFolderId++}/`;
      res.status(201).json({ data: { links: { move: moveLink } } });
      return;
    }

    createCallsByFilename.set(filename, (createCallsByFilename.get(filename) || 0) + 1);

    const forced = forcedCreateStatus.get(filename);
    if (forced && forced !== 201) {
      res.status(forced).json({ errors: [{ detail: `mock-forced-create-${forced}` }] });
      return;
    }

    const id = `mock-file-${nextId++}`;
    res.status(201).json({ data: { id, attributes: { name: filename, kind: "file" } } });
  }

  app.put("/files", handleFilesPut);

  app.put("/files/:id", (req, res) => {
    const id = req.params.id;
    updateCallsById.set(id, (updateCallsById.get(id) || 0) + 1);

    const forced = forcedUpdateStatus.get(id);
    if (forced && forced !== 200) {
      res.status(forced).json({ errors: [{ detail: `mock-forced-update-${forced}` }] });
      return;
    }

    res.status(200).json({});
  });

  // Every folder resolveFolder creates gets its own `/folder-N/` path,
  // reused for both listing (always empty, so a multi-level path like
  // data/raw/ always creates fresh at each level -- deliberately NOT wired
  // to listingCallCount, which tracks only the container-root listing used
  // for metadata discovery/collision-cache) and the next level's
  // create/upload, same behavior as the root /files route above.
  app.get("/folder-:n", (req, res) => {
    res.json({ data: [] });
  });

  app.put("/folder-:n", handleFilesPut);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        server,
        port: server.address().port,
        setListing: (files) => {
          listingContents = files;
        },
        getCreateCount: (filename) => createCallsByFilename.get(filename) || 0,
        getUpdateCount: (id) => updateCallsById.get(id) || 0,
        getTotalUpdateCount: () =>
          Array.from(updateCallsById.values()).reduce((a, b) => a + b, 0),
        getListingCallCount: () => listingCallCount,
        forceCreateStatus: (filename, status) => forcedCreateStatus.set(filename, status),
        forceUpdateStatus: (id, status) => forcedUpdateStatus.set(id, status),
        // Clears call counters only, keeping listing contents and forced
        // statuses -- used mid-test to isolate a "second call" assertion
        // from setup calls that came before it (see case 4).
        resetCounts: () => {
          createCallsByFilename.clear();
          updateCallsById.clear();
          listingCallCount = 0;
        },
        // Full reset between tests: counters, listing contents, and forced
        // statuses.
        reset: () => {
          listingContents = [];
          createCallsByFilename.clear();
          updateCallsById.clear();
          listingCallCount = 0;
          forcedCreateStatus.clear();
          forcedUpdateStatus.clear();
        },
      });
    });
  });
}

let db;
let mockOSF;
let filesLink;

beforeAll(async () => {
  mockOSF = await createMockOSFServer();
  filesLink = `http://localhost:${mockOSF.port}/files/`;

  initializeApp(config);
  db = getFirestore();

  await db.collection("users").doc(OWNER_ID).set({
    osfTokenValid: true,
    osfToken: "valid",
    usingPersonalToken: true,
  });
});

afterEach(() => {
  mockOSF.reset();
});

afterAll(async () => {
  mockOSF.server.close();
});

async function createExperiment(experimentID, overrides = {}) {
  await db
    .collection("experiments")
    .doc(experimentID)
    .set({
      active: true,
      metadataActive: true,
      owner: OWNER_ID,
      osfFilesLink: filesLink,
      ...overrides,
    });
}

describe("3. first metadata-active submission (no metadata anywhere)", () => {
  it("succeeds and stores metadata AND metadataFileRef with id + name", async () => {
    const experimentID = `metadata-ref3-${randomUUID()}`;
    const filename = `case3-${randomUUID()}.json`;
    await createExperiment(experimentID);
    // No metadata doc created at all -- firestoreMetadata and
    // metadataFileRef are both genuinely absent.
    mockOSF.setListing([]); // provider has no dataset_description.json either

    const response = await saveData({ experimentID, data: sampleData, filename });

    expect(response.status).toBe(201);

    const metadataDoc = (await db.collection("metadata").doc(experimentID).get()).data();
    expect(metadataDoc.metadata).toBeDefined();
    expect(metadataDoc.metadataFileRef).toBeDefined();
    expect(metadataDoc.metadataFileRef).not.toBeNull();
    expect(typeof metadataDoc.metadataFileRef.id).toBe("string");
    expect(metadataDoc.metadataFileRef.id.length).toBeGreaterThan(0);
    expect(metadataDoc.metadataFileRef.name).toBe("dataset_description.json");

    expect(mockOSF.getCreateCount("dataset_description.json")).toBe(1);
  });
});

describe("4. second submission updates the existing metadata file via its stored ref", () => {
  it("PUTs to the ref'd file id and makes no discovery listing call", async () => {
    const experimentID = `metadata-ref4-${randomUUID()}`;
    const existingMetaId = `preexisting-meta-${randomUUID()}`;
    await createExperiment(experimentID);

    // Pre-seed a steady-state metadata doc: metadata AND metadataFileRef
    // already established, as if a prior submission had already created
    // them. This isolates "second submission" behavior without depending on
    // case 3's flow.
    await db.collection("metadata").doc(experimentID).set({
      metadata: existingMetadata,
      metadataFileRef: { id: existingMetaId, name: "dataset_description.json" },
    });

    // Warm the collision cache first: this experiment's very first
    // submission triggers collision-cache rehydration (collision-cache.ts),
    // which calls provider.listFiles once -- a GET entirely unrelated to
    // metadata discovery, but indistinguishable from one on the wire (same
    // endpoint). Run it here, then reset counters, so the assertion below
    // about "no discovery listing" isn't polluted by this unrelated GET.
    const warmResponse = await saveData({
      experimentID,
      data: sampleData,
      filename: `case4-warm-${randomUUID()}.json`,
    });
    expect(warmResponse.status).toBe(201);
    mockOSF.resetCounts();

    const response = await saveData({
      experimentID,
      data: sampleData,
      filename: `case4-${randomUUID()}.json`,
    });

    expect(response.status).toBe(201);
    expect(mockOSF.getUpdateCount(existingMetaId)).toBe(1);
    expect(mockOSF.getCreateCount("dataset_description.json")).toBe(0);
    // Not 0: the metadata subsystem itself still does no re-discovery (the
    // ref is known, confirmed by the two assertions above -- update, not
    // create). The two calls counted here are unrelated to metadata: the raw
    // file's own data/raw/ folder resolution, and the derived main-data-CSV
    // upload's own data/ folder resolution (each writeSessionFile call walks
    // its own path independently now -- the up-front "resolve data/ once"
    // optimization was intentionally dropped when uploads were generalized
    // behind the provider interface), each hitting the same container-root
    // listing endpoint metadata discovery would also use.
    expect(mockOSF.getListingCallCount()).toBe(2);
  });
});

describe("5. legacy discovery: metadata doc has metadata but no metadataFileRef field", () => {
  it("finds the existing dataset_description.json via listing, updates it (not create), and stores the discovered ref", async () => {
    const experimentID = `metadata-ref5-${randomUUID()}`;
    const legacyId = `legacy-meta-${randomUUID()}`;
    await createExperiment(experimentID);

    // Pre-seed metadata WITHOUT a metadataFileRef field at all -- distinct
    // from explicit null (case 6). This is the shape a pre-migration,
    // still-active legacy experiment would have.
    await db.collection("metadata").doc(experimentID).set({ metadata: existingMetadata });

    mockOSF.setListing([
      { attributes: { name: "dataset_description.json", kind: "file" }, id: legacyId },
      { attributes: { name: "some-session-data.json", kind: "file" }, id: `${legacyId}-other` },
    ]);

    const response = await saveData({
      experimentID,
      data: sampleData,
      filename: `case5-${randomUUID()}.json`,
    });

    expect(response.status).toBe(201);
    expect(mockOSF.getUpdateCount(legacyId)).toBe(1);
    expect(mockOSF.getCreateCount("dataset_description.json")).toBe(0);

    const metadataDoc = (await db.collection("metadata").doc(experimentID).get()).data();
    expect(metadataDoc.metadataFileRef).toEqual({ id: legacyId, name: "dataset_description.json" });
  });
});

describe("6. 210-bug resurrection: metadataFileRef explicitly null, no metadata file on the provider", () => {
  it("creates the metadata file and succeeds (previously always failed with METADATA_ERROR)", async () => {
    const experimentID = `metadata-ref6-${randomUUID()}`;
    await createExperiment(experimentID);

    // metadataFileRef is explicitly null here -- distinct from case 5's
    // "field absent" -- meaning "we already looked, it's known absent;
    // don't list again."
    await db.collection("metadata").doc(experimentID).set({
      metadata: existingMetadata,
      metadataFileRef: null,
    });

    mockOSF.setListing([]); // provider genuinely has no metadata file

    const response = await saveData({
      experimentID,
      data: sampleData,
      filename: `case6-${randomUUID()}.json`,
    });

    // Today, this always fails: metadata-block.ts's create branch checks
    // `status !== 210` on a response that never returns 210, so it throws
    // MESSAGES.OSF_UPLOAD_ERROR unconditionally, even though the upload
    // itself succeeded.
    expect(response.status).toBe(201);

    expect(mockOSF.getCreateCount("dataset_description.json")).toBe(1);

    const metadataDoc = (await db.collection("metadata").doc(experimentID).get()).data();
    expect(metadataDoc.metadataFileRef).toBeDefined();
    expect(metadataDoc.metadataFileRef).not.toBeNull();
    expect(metadataDoc.metadataFileRef.name).toBe("dataset_description.json");
  });
});

describe("7. self-heal: stored ref points at a file the mock 404s on update", () => {
  it("creates a fresh metadata file and stores the new ref without failing the request", async () => {
    const experimentID = `metadata-ref7-${randomUUID()}`;
    const staleId = `stale-meta-${randomUUID()}`;
    await createExperiment(experimentID);

    await db.collection("metadata").doc(experimentID).set({
      metadata: existingMetadata,
      metadataFileRef: { id: staleId, name: "dataset_description.json" },
    });

    mockOSF.forceUpdateStatus(staleId, 404); // provider-side file was deleted

    const response = await saveData({
      experimentID,
      data: sampleData,
      filename: `case7-${randomUUID()}.json`,
    });

    expect(response.status).toBe(201);
    expect(mockOSF.getUpdateCount(staleId)).toBe(1); // the failed update attempt
    expect(mockOSF.getCreateCount("dataset_description.json")).toBe(1); // the self-heal create

    const metadataDoc = (await db.collection("metadata").doc(experimentID).get()).data();
    expect(metadataDoc.metadataFileRef).toBeDefined();
    expect(metadataDoc.metadataFileRef.id).not.toBe(staleId);
    expect(metadataDoc.metadataFileRef.name).toBe("dataset_description.json");
  });
});

describe("8. skip-metadata behavior (metadataActive false) is unchanged", () => {
  it("does not create a metadata document or a metadataFileRef when metadataActive is false", async () => {
    const experimentID = `metadata-ref8-${randomUUID()}`;
    await createExperiment(experimentID, { metadataActive: false });

    const response = await saveData({
      experimentID,
      data: sampleData,
      filename: `case8-${randomUUID()}.json`,
    });

    expect(response.status).toBe(201);
    expect(response.body.metadataMessage).toBeFalsy();

    const metadataDoc = await db.collection("metadata").doc(experimentID).get();
    expect(metadataDoc.exists).toBe(false);

    expect(mockOSF.getCreateCount("dataset_description.json")).toBe(0);
    expect(mockOSF.getTotalUpdateCount()).toBe(0);
  });
});
