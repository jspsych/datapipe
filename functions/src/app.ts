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

export { db, auth, storage, functions };
