const admin = require('firebase-admin');
const crypto = require('crypto');

const DRY_RUN = process.env.DRY_RUN === 'true';

// Encryption config — must match functions/src/crypto-utils.ts
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION_PREFIX = 'v1:';

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  if (plaintext.startsWith(VERSION_PREFIX)) return plaintext; // already encrypted

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ['v1', iv.toString('base64'), encrypted.toString('base64'), tag.toString('base64')].join(':');
}

// Initialize Firebase Admin SDK
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
    const path = require('path');
    const os = require('os');
    const serviceAccountPath = path.join(os.homedir(), '.config', 'datapipe', 'datapipe-service-account.json');
    const serviceAccount = require(serviceAccountPath);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || 'datapipe-test'
    });
  } else {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    admin.initializeApp({
      projectId: 'datapipe-test'
    });
  }
}

const db = admin.firestore();

const TOKEN_FIELDS = ['osfToken', 'authToken', 'refreshToken'];

async function encryptTokens() {
  try {
    console.log(`Starting token encryption migration...${DRY_RUN ? ' (DRY RUN)' : ''}`);

    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();

    let batch = db.batch();
    let batchCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const doc of snapshot.docs) {
      const userData = doc.data();
      const updates = {};

      for (const field of TOKEN_FIELDS) {
        const value = userData[field];
        if (!value || typeof value !== 'string') continue;
        if (value.startsWith(VERSION_PREFIX)) {
          // Already encrypted
          continue;
        }
        updates[field] = encrypt(value);
      }

      if (Object.keys(updates).length === 0) {
        skippedCount++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would encrypt ${Object.keys(updates).length} token(s) for user ${doc.id}: ${Object.keys(updates).join(', ')}`);
      } else {
        batch.update(doc.ref, updates);
        batchCount++;
      }
      updatedCount++;

      // Firestore batch limit is 500
      if (batchCount === 500 && !DRY_RUN) {
        console.log(`Committing batch of ${batchCount} updates...`);
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Commit remaining updates
    if (batchCount > 0 && !DRY_RUN) {
      console.log(`Committing final batch of ${batchCount} updates...`);
      await batch.commit();
    }

    console.log(`Migration completed${DRY_RUN ? ' (DRY RUN)' : ''}. ${DRY_RUN ? 'Would update' : 'Updated'}: ${updatedCount}, Skipped: ${skippedCount}, Total: ${snapshot.size}`);
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  encryptTokens()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { encryptTokens };
