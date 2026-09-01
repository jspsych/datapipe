import { onRequest } from "firebase-functions/v2/https";
import { db, auth } from "./app.js";
import { contactEmailRecipient } from "./mail.js";
import {
  VERIFICATIONS_COLLECTION,
  hashVerificationCode,
  hashContactEmail,
} from "./send-contact-email-verification.js";

// Redeem a 6-digit code and, on success, set the ONE flag no client can ever
// write itself: users/{uid}.contactEmailVerified = true.
// firestore.rules' contactEmailNotSelfCertified() refuses that value from
// every client-write shape (create and update alike) -- this Admin-SDK path,
// reached only after a hash comparison the client cannot forge, is the only
// place it is ever set.
//
// Auth shape copied from delete-account.ts / api-queue-status.ts /
// send-contact-email-verification.ts exactly: method check, then
// `Authorization: Bearer <idToken>`, then auth.verifyIdToken.
//
// THE STALE-ADDRESS GUARD is the reason this is a transaction and not a
// sequence of independent reads and writes. A researcher can save a NEW
// contactEmail (components/account/ContactEmail.js's edit form) at any time
// after requesting a code for the old one -- buildContactEmailUpdate()
// always resets contactEmailVerified to false on that save, but it does not
// touch, and has no way to touch, a contactEmailVerifications/{uid} record
// already in flight for the address that used to be there. Without the
// emailHash comparison below, a correct code for the OLD address would still
// verify the NEW one, because both writes land on the same uid-keyed
// document. The check re-reads users/{uid}.contactEmail inside the same
// transaction that decides the outcome, so there is no window between "read
// the current address" and "grant verified" for another save to slip
// through.
const MAX_ATTEMPTS = 5; // plan §2.2

interface Outcome {
  status: number;
  body: Record<string, unknown>;
}

function verificationRef(uid: string): FirebaseFirestore.DocumentReference {
  return db.collection(VERIFICATIONS_COLLECTION).doc(uid);
}

// One answer, two ways to arrive at it: no record at all, and a record whose
// code was cleared because it could not be delivered. The researcher's next
// move is the same either way, so the wording is defined once rather than kept
// in step by hand.
const NO_CODE_REQUESTED = {
  status: 400,
  body: {
    error: "Request a new verification code.",
    code: "no-code-requested",
  },
};

export const verifyContactEmail = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let uid: string;
  try {
    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    uid = decodedToken.uid;
  } catch {
    res.status(401).json({ error: "Invalid authentication token" });
    return;
  }

  const rawCode =
    typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!/^\d{6}$/.test(rawCode)) {
    res
      .status(400)
      .json({ error: "Enter the 6-digit code.", code: "invalid-code" });
    return;
  }

  try {
    const userRef = db.doc(`users/${uid}`);
    const vRef = verificationRef(uid);

    const outcome = await db.runTransaction<Outcome>(async (tx) => {
      // ---------------- ALL READS FIRST (Firestore transaction law) -------
      const userSnap = await tx.get(userRef);
      const vSnap = await tx.get(vRef);
      // ---------------- NO READS BELOW THIS LINE ----------------------------

      const userData = userSnap.exists ? userSnap.data() : undefined;

      if (userData?.contactEmailVerified === true) {
        return { status: 200, body: { success: true, alreadyVerified: true } };
      }

      // The address as it stands RIGHT NOW, read inside this transaction --
      // the stale-address guard depends on this being the live value, not
      // one captured before the transaction began.
      const currentAddress = contactEmailRecipient(userData);
      if (!currentAddress) {
        return {
          status: 400,
          body: {
            error: "Add a contact email address before verifying.",
            code: "no-contact-email",
          },
        };
      }

      if (!vSnap.exists) {
        return NO_CODE_REQUESTED;
      }

      const v = vSnap.data()!;

      // A record whose code was never delivered. send-contact-email-
      // verification.ts clears `codeHash` and keeps the rest of the record --
      // the record is that endpoint's rate limit, so it may not be deleted, but
      // there is no code out there to enter. Answering "request a new one" is
      // both true and the same answer a missing record gets above; falling
      // through would spend one of the five attempts on a code that does not
      // exist.
      if (typeof v.codeHash !== "string") {
        return NO_CODE_REQUESTED;
      }

      const expiresAt = typeof v.expiresAt === "number" ? v.expiresAt : 0;
      if (Date.now() > expiresAt) {
        return {
          status: 400,
          body: {
            error: "That code has expired. Request a new one.",
            code: "expired",
          },
        };
      }

      const attempts = typeof v.attempts === "number" ? v.attempts : 0;
      // Checked BEFORE the code comparison, and it must be: a sixth guess
      // must be refused even if it happens to be correct, or the attempt cap
      // is not actually a cap.
      if (attempts >= MAX_ATTEMPTS) {
        return {
          status: 429,
          body: {
            error: "Too many incorrect attempts. Request a new code.",
            code: "too-many-attempts",
          },
        };
      }

      // THE STALE-ADDRESS GUARD. See the module header. A mismatch here
      // means the code in hand was minted for an address that is no longer
      // users/{uid}.contactEmail -- not a guessing attempt, so it does not
      // consume one of the five attempts above.
      if (v.emailHash !== hashContactEmail(currentAddress)) {
        return {
          status: 400,
          body: {
            error:
              "This code was sent to a different address. Request a new code.",
            code: "stale-address",
          },
        };
      }

      if (v.codeHash !== hashVerificationCode(rawCode, uid)) {
        tx.update(vRef, { attempts: attempts + 1 });
        return {
          status: 400,
          body: {
            error: "That code is incorrect.",
            code: "invalid-code",
            attemptsRemaining: Math.max(0, MAX_ATTEMPTS - (attempts + 1)),
          },
        };
      }

      // Success. contactEmailVerified is written here and ONLY here --
      // firestore.rules refuses this value from any client-write shape, so
      // this Admin SDK write (rules do not apply to it) is the single path
      // by which the flag ever becomes true.
      tx.update(userRef, { contactEmailVerified: true });
      tx.delete(vRef);
      return { status: 200, body: { success: true } };
    });

    res.status(outcome.status).json(outcome.body);
  } catch (error) {
    console.error(
      `verify-contact-email failed for ${uid}:`,
      error instanceof Error ? error.message : "Unknown error"
    );
    res
      .status(500)
      .json({ error: "Could not verify the code. Please try again." });
  }
});
