// Backfill users/{uid}.contactEmail for accounts that already have a usable
// address sitting in Firebase Auth but never got the four contactEmail
// fields written (every account that existed before the required-contact-
// email feature shipped).
//
// ---------------------------------------------------------------------------
// WHY THIS ITERATES FIREBASE AUTH, NOT users/{uid}.email
// ---------------------------------------------------------------------------
//
// OSF OAuth account creation NEVER produced a real email. OSF sign-in mints a
// Firebase custom token (oauth2-callback.ts), so an OSF-era account has no
// Auth email at all, and the `email` field oauth2-callback.ts wrote into the
// user document is either the OSF API's address (never confirmed to
// DataPipe -- the researcher typed it into OSF, not here) or the synthetic
// `user-{osfUserId}@osf.io` fallback it uses when OSF returns nothing usable.
// Every OSF-supplied address is synthetic or unconfirmed. Seeding contactEmail
// from it would plant an address DataPipe cannot vouch for into the one field
// the whole notification feature depends on.
//
// The only legitimate backfill source is Firebase Auth's `user.email`:
// present for email/password signups (always) and for federated signups that
// supply one (Google always, GitHub usually) -- INCLUDING an OSF-era or
// ORCID-only researcher who later linked a password or a Google account,
// because Auth's top-level `user.email` reflects whatever the account has
// today, not how it was created. That is exactly what lib/contact-email.js's
// `contactEmailSeedFromAuthUser(authUser)` encodes, and exactly why this
// script walks `admin.auth().listUsers()` -- paginated, 1000 at a time --
// instead of querying the `users` collection.
//
// This file is CommonJS (migrations/ has no package.json with
// "type": "module", and lib/contact-email.js is ES module syntax that plain
// `require()` cannot parse), so the validation logic below is a MIRROR of
// lib/contact-email.js, in the same spirit as functions/src/mail.ts's mirror
// of the same file. Keep the three in sync:
//   - lib/contact-email.js       (frontend)
//   - functions/src/mail.ts      (backend)
//   - this file                  (one-off migration)
//
// ---------------------------------------------------------------------------
// SAFETY
// ---------------------------------------------------------------------------
//
// Dry run by default. Pass --apply to write. Idempotent: a user document that
// already has a non-empty contactEmail is left alone -- this script only
// fills a gap, it never overwrites an address a researcher (or an earlier run
// of this same script) already set.
const admin = require('firebase-admin');
const path = require('path');
const os = require('os');

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

// ---------------------------------------------------------------------------
// Mirror of lib/contact-email.js. See the block comment above for why this
// cannot be an import.
// ---------------------------------------------------------------------------
const MAX_CONTACT_EMAIL_LENGTH = 254;
const OSF_SYNTHETIC_EMAIL_PATTERN = /^user-[a-z0-9]+@osf\.io$/i;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const CONTACT_EMAIL_SOURCE_AUTH = 'auth';

function normalizeContactEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmailFormat(value) {
  const v = normalizeContactEmail(value);
  return v.length > 0 && v.length <= MAX_CONTACT_EMAIL_LENGTH && EMAIL_FORMAT.test(v);
}

function isSyntheticOsfEmail(value) {
  return OSF_SYNTHETIC_EMAIL_PATTERN.test(normalizeContactEmail(value));
}

// Mirrors contactEmailSeedFromAuthUser(authUser) in lib/contact-email.js.
// Returns null when the Auth record has nothing seedable -- ORCID-only and
// OSF-era accounts that never linked anything else land here, and are left
// for the gate (or the researcher) to fill in, never for this script.
function seedFromAuthUser(authUser) {
  const candidate = normalizeContactEmail(authUser.email);
  if (!isValidEmailFormat(candidate) || isSyntheticOsfEmail(candidate)) {
    return null;
  }
  return {
    contactEmail: candidate,
    contactEmailVerified: false,
    contactEmailUpdatedAt: Date.now(),
    contactEmailSource: CONTACT_EMAIL_SOURCE_AUTH,
  };
}

// ---------------------------------------------------------------------------
// Firebase Admin init -- same three-way branch as the other scripts in this
// directory (2025-09-29-osf-integration.cjs, encrypt-tokens.cjs).
// ---------------------------------------------------------------------------
if (!admin.apps.length) {
  if (process.env.NODE_ENV === 'production' || process.env.CI) {
    const credentials = process.env.GOOGLE_CREDENTIALS
      ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
      : undefined;

    admin.initializeApp({
      credential: credentials ? admin.credential.cert(credentials) : admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || 'datapipe-prod'
    });
  } else if (process.env.USE_LOCAL_SERVICE_ACCOUNT) {
    const serviceAccountPath = path.join(os.homedir(), '.config', 'datapipe', 'datapipe-service-account.json');
    const serviceAccount = require(serviceAccountPath);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || 'datapipe-test'
    });
  } else {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    admin.initializeApp({
      projectId: 'datapipe-test'
    });
  }
}

const db = admin.firestore();
const auth = admin.auth();

const AUTH_PAGE_SIZE = 1000; // admin.auth().listUsers() max per page.
const BATCH_LIMIT = 500; // Firestore batch write limit.

async function backfillContactEmails() {
  console.log(`Starting contact-email backfill...${DRY_RUN ? ' (DRY RUN -- pass --apply to write)' : ' (APPLYING WRITES)'}`);

  const counts = {
    authUsersSeen: 0,
    seeded: 0, // wrote contactEmail from a usable Auth email
    skippedAlreadySet: 0, // users/{uid}.contactEmail already non-empty
    skippedNoUserDoc: 0, // Auth user has no users/{uid} document at all
    noUsableAuthEmail: 0, // Auth email absent, malformed, or synthetic-OSF
  };

  let batch = db.batch();
  let batchCount = 0;
  let pageToken;
  let pageNumber = 0;

  async function commitBatchIfNeeded(force) {
    if (DRY_RUN) return;
    if (batchCount === 0) return;
    if (!force && batchCount < BATCH_LIMIT) return;
    await batch.commit();
    batch = db.batch();
    batchCount = 0;
  }

  do {
    pageNumber += 1;
    const page = await auth.listUsers(AUTH_PAGE_SIZE, pageToken);
    pageToken = page.pageToken;

    console.log(`Page ${pageNumber}: ${page.users.length} auth user(s)...`);

    for (const authUser of page.users) {
      counts.authUsersSeen += 1;

      const seed = seedFromAuthUser(authUser);
      if (!seed) {
        counts.noUsableAuthEmail += 1;
        continue;
      }

      const userRef = db.collection('users').doc(authUser.uid);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        // No users/{uid} document to backfill. ensureUserDocument() will seed
        // this correctly on the account's next sign-in; nothing to do here.
        counts.skippedNoUserDoc += 1;
        continue;
      }

      const existing = userSnap.data() || {};
      // Never overwrite an existing contactEmail -- a researcher's own choice
      // (or a previous run of this script) always wins.
      if (typeof existing.contactEmail === 'string' && existing.contactEmail.trim().length > 0) {
        counts.skippedAlreadySet += 1;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would set contactEmail for ${authUser.uid}: ${seed.contactEmail}`);
      } else {
        batch.update(userRef, seed);
        batchCount += 1;
        await commitBatchIfNeeded(false);
      }
      counts.seeded += 1;
    }

    console.log(
      `  Page ${pageNumber} running totals -- seeded: ${counts.seeded}, ` +
      `already set: ${counts.skippedAlreadySet}, no user doc: ${counts.skippedNoUserDoc}, ` +
      `no usable auth email: ${counts.noUsableAuthEmail}`
    );
  } while (pageToken);

  await commitBatchIfNeeded(true);

  console.log(`Backfill completed${DRY_RUN ? ' (DRY RUN -- nothing written)' : ''}.`);
  console.log(`  Auth users seen:            ${counts.authUsersSeen}`);
  console.log(`  Seeded contactEmail:        ${counts.seeded}`);
  console.log(`  Skipped (already set):      ${counts.skippedAlreadySet}`);
  console.log(`  Skipped (no user doc):      ${counts.skippedNoUserDoc}`);
  console.log(`  No usable auth email:       ${counts.noUsableAuthEmail}`);

  return counts;
}

// Run migration if called directly
if (require.main === module) {
  backfillContactEmails()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Backfill failed:', error);
      process.exit(1);
    });
}

module.exports = { backfillContactEmails, seedFromAuthUser };
