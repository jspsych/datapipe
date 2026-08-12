import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

// Creates the users/{uid} Firestore document if it does not already exist.
//
// Why this is needed: the only place that doc was ever created client-side is
// pages/signup.js's email/password path, and the only place it was created
// server-side was oauth2-callback.ts's OSF signup branch. Federated sign-in
// (Google/ORCID/GitHub) goes through neither -- Firebase creates the Auth
// record by itself and no DataPipe code runs -- so without this the dashboard
// would load against a missing doc on a researcher's first visit.
//
// Idempotent and safe to call after every sign-in and every account link.
//
// The read-before-write is not an optimization, it is required by
// firestore.rules: a user doc write is only permitted when it matches
// isAccountCreation(), isTokenMethodUpdate() or isExperimentsUpdate(). An
// unconditional merge over an EXISTING doc would put fields like
// connectedAccounts into request.resource.data and fail all three.
export async function ensureUserDocument(user) {
  if (!user?.uid) return false;

  const ref = doc(db, "users", user.uid);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) return false;

  await setDoc(
    ref,
    {
      uid: user.uid,
      // ORCID sign-ins routinely carry no email -- researchers keep it
      // private on their ORCID record -- so this is "" rather than absent.
      // Nothing downstream may assume a user doc has a usable address.
      email: user.email || "",
      experiments: [],
    },
    { merge: true }
  );

  return true;
}
