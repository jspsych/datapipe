import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { contactEmailSeedFromAuthUser } from "./contact-email";

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
      // Seeds contactEmail from the FIREBASE AUTH record ONLY, per the
      // SEEDING RULE in lib/contact-email.js: never from an OSF-supplied
      // address. Email/password and Google always carry a usable
      // user.email here (Google's is provider-verified, but
      // contactEmailVerified is still seeded false -- firestore.rules
      // refuses a client-written `true` in every shape); GitHub, only when
      // the researcher disclosed one; ORCID routinely has none. An account
      // with no usable Auth email is seeded contactEmail: "" and meets the
      // gate on its first /admin load -- the intended path, not a failure.
      ...contactEmailSeedFromAuthUser(user),
    },
    { merge: true }
  );

  return true;
}
