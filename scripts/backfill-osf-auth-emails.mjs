// Backfill email addresses onto the Firebase Auth records of OSF-era accounts.
//
// WHY THIS EXISTS
//
// Accounts created by "Sign in with OSF" were minted with
// auth.createCustomToken(uuid, ...) (functions/src/oauth2-callback.ts). A
// custom-token user record carries NO email, NO password and NO federated
// provider -- the researcher's address lives only in the Firestore document
// at users/{uid}. So once OSF sign-in is removed, an account whose owner never
// came back to link a provider has literally no way in: password reset has no
// address to send to, and signing in with Google would mint a DIFFERENT uid,
// severing them from experiments that reference `owner: uid`.
//
// Copying the address from Firestore onto the Auth record fixes that. It gives
// those researchers a self-service route back to the SAME uid:
//   - "Forgot password" / email-link sign-in resolves to the existing record.
//   - Google/GitHub sign-in with a matching address links to it cleanly.
//
// Run this BEFORE removing OSF sign-in, and before deleting
// functions/src/check-email-conflict.ts (which is what stops an email/password
// signup from colliding with one of these accounts in the meantime).
//
// Usage:
//   node scripts/backfill-osf-auth-emails.mjs              # dry run, changes nothing
//   node scripts/backfill-osf-auth-emails.mjs --apply      # actually writes
//
// Env:
//   GOOGLE_APPLICATION_CREDENTIALS  service-account key with Firebase Admin access
//   FIREBASE_PROJECT_ID             (optional) overrides the credential's project
//   FIRESTORE_EMULATOR_HOST         set by the emulator; safe to dry-run against
//
// Reports four categories, and never guesses:
//   backfilled  - Auth record now carries the Firestore address
//   alreadySet  - Auth record already had an email; left alone
//   synthetic   - address is the user-<osfId>@osf.io placeholder written when
//                 OSF's emails endpoint failed. Not a real inbox, so writing it
//                 would create a permanently unverifiable account. Needs manual
//                 handling.
//   collision   - another Auth record already owns that address (an
//                 email/password account). Writing it would fail anyway;
//                 merging the two is a judgement call, not a script's.

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");

// The fallback address oauth2-callback.ts writes when it cannot read a real
// one from OSF: `user-${osfUserId}@osf.io`.
const SYNTHETIC_EMAIL = /^user-[^@]+@osf\.io$/i;

initializeApp({
  credential: applicationDefault(),
  ...(process.env.FIREBASE_PROJECT_ID
    ? { projectId: process.env.FIREBASE_PROJECT_ID }
    : {}),
});

const auth = getAuth();
const db = getFirestore();

const buckets = {
  backfilled: [],
  alreadySet: [],
  synthetic: [],
  collision: [],
  noEmail: [],
  noAuthRecord: [],
  failed: [],
};

async function main() {
  const snapshot = await db
    .collection("users")
    .where("authMethod", "==", "osf")
    .get();

  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: ${snapshot.size} OSF-era user document(s) found.\n`
  );

  for (const docSnapshot of snapshot.docs) {
    const uid = docSnapshot.id;
    const { email, displayName } = docSnapshot.data();

    if (!email) {
      buckets.noEmail.push({ uid });
      continue;
    }

    if (SYNTHETIC_EMAIL.test(email)) {
      buckets.synthetic.push({ uid, email });
      continue;
    }

    let authRecord;
    try {
      authRecord = await auth.getUser(uid);
    } catch (err) {
      // A user document whose Auth record never materialized -- createCustomToken
      // does not create one until the token is actually redeemed, so a signup
      // that was abandoned mid-flow leaves exactly this.
      if (err?.code === "auth/user-not-found") {
        buckets.noAuthRecord.push({ uid, email });
        continue;
      }
      throw err;
    }

    if (authRecord.email) {
      buckets.alreadySet.push({ uid, email: authRecord.email });
      continue;
    }

    // Check for an existing owner of this address BEFORE writing. updateUser
    // would reject it anyway, but distinguishing "collision" from "failed" in
    // the report is the whole point of running a dry pass first.
    try {
      const existing = await auth.getUserByEmail(email);
      if (existing.uid !== uid) {
        buckets.collision.push({ uid, email, conflictsWith: existing.uid });
        continue;
      }
    } catch (err) {
      if (err?.code !== "auth/user-not-found") throw err;
      // Not found is the good case: nobody owns this address.
    }

    if (!apply) {
      buckets.backfilled.push({ uid, email });
      continue;
    }

    try {
      await auth.updateUser(uid, {
        email,
        // Deliberately NOT verified. DataPipe never confirmed this address
        // itself -- it came from OSF -- and marking it verified would let it
        // stand in for proof of ownership on a later account link.
        emailVerified: false,
        ...(displayName && !authRecord.displayName ? { displayName } : {}),
      });
      buckets.backfilled.push({ uid, email });
    } catch (err) {
      buckets.failed.push({ uid, email, error: err?.message || String(err) });
    }
  }

  report();
}

function report() {
  const order = [
    ["backfilled", apply ? "Backfilled" : "Would backfill"],
    ["alreadySet", "Already had an email (skipped)"],
    ["synthetic", "Synthetic OSF placeholder address (NEEDS MANUAL HANDLING)"],
    ["collision", "Address owned by another account (NEEDS MANUAL HANDLING)"],
    ["noEmail", "No email on the user document (NEEDS MANUAL HANDLING)"],
    ["noAuthRecord", "No Firebase Auth record (abandoned signup)"],
    ["failed", "Failed"],
  ];

  console.log("\n=== Summary ===");
  for (const [key, label] of order) {
    console.log(`${String(buckets[key].length).padStart(5)}  ${label}`);
  }

  for (const key of ["synthetic", "collision", "noEmail", "failed"]) {
    if (buckets[key].length === 0) continue;
    console.log(`\n--- ${key} ---`);
    for (const row of buckets[key]) console.log(JSON.stringify(row));
  }

  if (!apply) {
    console.log("\nDry run only -- nothing was written. Re-run with --apply.");
  }
}

main().catch((err) => {
  console.error("Backfill aborted:", err);
  process.exit(1);
});
