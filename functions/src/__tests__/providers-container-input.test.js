/**
 * @jest-environment node
 */

// Conformance check for the containerInput mechanism (providers/types.ts's
// ContainerInputField / StorageProvider.containerInput). create-experiment.ts
// validates a createDataContainer request generically against whatever a
// provider's containerInput array declares, and never names a specific
// provider's researcherInput shape -- so a provider that forgets to declare
// containerInput would silently accept requests it can't actually satisfy.
// This test guards against exactly that, for every REGISTERED provider (not
// a fake test double), which is why it imports the real registry entry point
// (providers/index.js) rather than constructing fixtures like
// providers-registry.test.js does.
//
// Runs in the node environment and imports the compiled lib/ output, same
// convention as every other providers-*.test.js file in this directory (see
// e.g. providers-gdrive.test.js's docblock for why: osf.ts/gdrive.ts pull in
// app.js -> firebase-admin, and jsdom's ESM-only jose build breaks under
// Jest's CJS transform).

// providers/index.js pulls in every adapter (osf.ts, gdrive.ts, dataverse.ts),
// each of which imports "node-fetch" at module scope for real network calls.
// node-fetch ships ESM and Jest's CJS transform can't parse it, so it must be
// mocked at the module level even though this test never calls fetch --
// mirrors every other providers-*.test.js file's convention.
jest.mock("node-fetch", () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { listProviders, getProvider } from "../../lib/providers/index.js";

describe("provider containerInput conformance", () => {
  it("every registered provider declares a containerInput array", () => {
    const ids = listProviders();
    // Sanity check that we're looking at the real registry (osf, gdrive,
    // dataverse), not an empty/cleared one.
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const provider = getProvider(id);
      expect(Array.isArray(provider.containerInput)).toBe(true);
      for (const field of provider.containerInput) {
        expect(typeof field.name).toBe("string");
        expect(typeof field.label).toBe("string");
        expect(typeof field.required).toBe("boolean");
      }
    }
  });

  // The create form (pages/admin/new.js) renders one helper line per field
  // saying what the provider does with the value. A field that declares no
  // helperText renders as a bare labelled box -- which is how "Collection
  // alias" shipped, explained nowhere but /docs/experiments. Hidden fields are
  // exempt: they have no rendered field to explain (gdrive's parentId comes
  // from the Google Picker, whose own copy lives in the page).
  it("every rendered containerInput field explains itself", () => {
    for (const id of listProviders()) {
      for (const field of getProvider(id).containerInput) {
        if (field.inputType === "hidden") continue;
        expect(typeof field.helperText).toBe("string");
        expect(field.helperText.length).toBeGreaterThan(0);
      }
    }
  });

  // Two providers asking the same question must ask it in the same words.
  // Dataverse's `authorName` and Zenodo's `creatorName` are the motivating
  // case: they carry different wire names because the two APIs do, but a
  // researcher filling in this form is answering one question, so they share
  // the label "Author name". This pins that any field name meaning the same
  // thing across providers keeps one label.
  it("fields meaning the same thing share a label across providers", () => {
    const labelsFor = (providerId, fieldName) =>
      getProvider(providerId)
        .containerInput.filter((f) => f.name === fieldName)
        .map((f) => f.label);

    expect(labelsFor("dataverse", "authorName")).toEqual(["Author name"]);
    expect(labelsFor("zenodo", "creatorName")).toEqual(["Author name"]);
    expect(labelsFor("dataverse", "description")).toEqual(["Description"]);
    expect(labelsFor("zenodo", "description")).toEqual(["Description"]);
  });
});
