import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const app = initializeApp();
const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };
