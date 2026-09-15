/**
 * @jest-environment node
 *
 * Pure coverage for firestore.indexes.json (repo root). Pins two
 * configuration facts that have no other test coverage and no CI signal
 * when they regress, because the Firestore emulator does NOT enforce
 * composite indexes or TTL policies -- a missing entry only surfaces in
 * production as a FAILED_PRECONDITION on the query, or as claims silently
 * accumulating forever, neither of which any emulator-backed suite can
 * observe.
 *
 * 1. The uploadQueue (experimentID, status, createdAt DESC) composite index
 *    that api-queue-status.ts's list query (GET /api/queuestatus with no
 *    `download`/`downloadAll` param) requires: experimentID==, status in
 *    [...], orderBy(createdAt, desc). The pre-existing uploadQueue indexes
 *    all constrain `owner` or `providerErrorCode` instead of `createdAt`, so
 *    none of them serve this query.
 * 2. The filenameClaims.expiresAt TTL fieldOverride that lets
 *    experiments/{id}/filenameClaims/{claim} documents (collision-cache.ts)
 *    actually expire. Commit f0aafe0 established that a hand-created TTL
 *    policy is deleted by the next `firebase deploy --only firestore
 *    --force` unless it is declared here -- this test is the guard against
 *    that regression happening again for a second collection.
 * 3. The mail TTL fieldOverride from f0aafe0 itself, so a future edit to
 *    this file can't silently drop it while adding something else.
 */

const fs = require("fs");
const path = require("path");

const indexesPath = path.join(__dirname, "..", "..", "..", "firestore.indexes.json");
const indexesConfig = JSON.parse(fs.readFileSync(indexesPath, "utf-8"));

function fieldsMatch(indexFields, expected) {
  if (indexFields.length !== expected.length) return false;
  return expected.every((exp, i) => {
    const actual = indexFields[i];
    return actual.fieldPath === exp.fieldPath && actual.order === exp.order;
  });
}

describe("firestore.indexes.json", () => {
  it("declares the uploadQueue (experimentID, status, createdAt DESC) composite index", () => {
    const match = indexesConfig.indexes.find(
      (idx) =>
        idx.collectionGroup === "uploadQueue" &&
        idx.queryScope === "COLLECTION" &&
        fieldsMatch(idx.fields, [
          { fieldPath: "experimentID", order: "ASCENDING" },
          { fieldPath: "status", order: "ASCENDING" },
          { fieldPath: "createdAt", order: "DESCENDING" },
        ])
    );

    expect(match).toBeDefined();
  });

  it("declares a ttl:true fieldOverride for filenameClaims.expiresAt", () => {
    const override = indexesConfig.fieldOverrides.find(
      (fo) => fo.collectionGroup === "filenameClaims" && fo.fieldPath === "expiresAt"
    );

    expect(override).toBeDefined();
    expect(override.ttl).toBe(true);
    // A fieldOverride replaces the field's whole index configuration, so an
    // empty `indexes` array would additionally turn off single-field
    // indexing for expiresAt -- copy the mail override's shape exactly
    // rather than defaulting to [].
    expect(Array.isArray(override.indexes)).toBe(true);
    expect(override.indexes.length).toBeGreaterThan(0);
  });

  it("still declares the mail TTL fieldOverride from commit f0aafe0", () => {
    const override = indexesConfig.fieldOverrides.find(
      (fo) => fo.collectionGroup === "mail" && fo.fieldPath === "delivery.expireAt"
    );

    expect(override).toBeDefined();
    expect(override.ttl).toBe(true);
  });
});
