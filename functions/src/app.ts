import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getFunctions } from "firebase-admin/functions";

const app = initializeApp();
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
// Used by api-finalize.ts to enqueue the finalizeTask Cloud Task. Respects
// CLOUD_TASKS_EMULATOR_HOST the same way the other services above respect
// their own *_EMULATOR_HOST vars, so this needs no test-only branching.
const functions = getFunctions(app);

// `app` is exported for staging.ts, which attaches the Realtime Database
// lazily rather than here. Two reasons it is not a sibling of the constants
// above:
//
//  - getDatabase() THROWS if it cannot determine a database URL, and this
//    module is imported by every function in the codebase. A project with no
//    RTDB instance provisioned (which is every deployment until the staging
//    tier is enabled on it) would fail to load api-data.ts, api-condition.ts,
//    and the rest, all at once, for a feature none of them use.
//  - api-data.ts is the hottest path here and pays this module's import cost
//    on every cold start. It has no reason to open a database connection.
//
// See functions/src/staging.ts.
export { app, db, auth, storage, functions };
