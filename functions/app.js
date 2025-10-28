import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Use the same project ID as the emulator
const app = initializeApp();
const db = getFirestore(app);

export { db };
