import { DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./app.js";

// Whether a client-supplied experimentID is even a value Firestore will
// accept as a document id -- checked BEFORE it is ever spliced into
// db.collection("experiments").doc(experimentID). Firestore does not treat an
// invalid id as a lookup miss: it THROWS synchronously for a handful of
// specific shapes ("3 INVALID_ARGUMENT: Resource id ... is invalid because it
// is reserved"), and that throw was reaching participant-facing endpoints
// unhandled as a 500. The commonest real case is a participant site that
// never filled in a template placeholder -- e.g. "__DATAPIPE_STUDY1_ID__" --
// which happens to be exactly the reserved __...__ shape below.
//
// Kept in its own module rather than folded into staging.ts: it has nothing
// to do with the RTDB staging tier that file owns, it just happens to be the
// same kind of gate as isValidSessionId there -- the one check a
// client-controlled string has to clear before it is trusted as a Firestore
// document id.
//
// Deliberately NOT restricted to the nanoid alphabet create-experiment.ts
// mints new ids from: older experiment ids may use other formats, and the
// only thing this function has to guarantee is that whatever it accepts, a
// Firestore doc() call will accept too. (Contrast isValidSessionId in
// staging.ts, which DOES pin the exact format the server mints, because a
// sessionId is never anything but server-generated.)
//
// Firestore's own restrictions on a document id (see
// https://firebase.google.com/docs/firestore/quotas#collections_documents):
//   - must be a non-empty string
//   - may not contain "/"
//   - may not be exactly "." or ".."
//   - may not match /^__.*__$/ (reserved for Firestore's own use)
//   - may not exceed 1500 bytes in UTF-8
const RESERVED_ID_PATTERN = /^__.*__$/;
const MAX_ID_BYTES = 1500;

/**
 * Whether `value` is a string Firestore will accept as a document id. Not
 * specific to experiments: api-queue-status.ts runs its `download` queue-entry
 * id through the same check, and write-log.ts its logs/{experimentID} id.
 */
export function isValidDocumentId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("/")) return false;
  if (value === "." || value === "..") return false;
  if (RESERVED_ID_PATTERN.test(value)) return false;
  if (Buffer.byteLength(value, "utf-8") > MAX_ID_BYTES) return false;
  return true;
}

/**
 * experiments/{experimentID}, or null when there is no such experiment --
 * including when `experimentID` is not an id Firestore would accept at all.
 * Every endpoint that looks an experiment up by a client-supplied id goes
 * through this, so none of them can reach the doc() call that throws, and
 * each keeps the single not-found branch it already had.
 */
export async function getExperiment(experimentID: unknown): Promise<DocumentSnapshot | null> {
  if (!isValidDocumentId(experimentID)) return null;
  const snap = await db.collection("experiments").doc(experimentID).get();
  return snap.exists ? snap : null;
}
