const admin = require('firebase-admin');
const path = require('path');
const os = require('os');

const DRY_RUN = process.env.DRY_RUN === 'true';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  if (process.env.NODE_ENV === 'production' || process.env.CI) {
    const credentials = process.env.GOOGLE_CREDENTIALS
      ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
      : undefined;

    admin.initializeApp({
      credential: credentials ? admin.credential.cert(credentials) : admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || 'osf-relay'
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
    admin.initializeApp({
      projectId: 'datapipe-test'
    });
  }
}

const db = admin.firestore();

async function migrateUsers() {
  try {
    console.log(`Starting user migration...${DRY_RUN ? ' (DRY RUN)' : ''}`);

    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();

    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
      const userData = doc.data();

      const updatedData = {
        authMethod: userData.authMethod || (userData.osfUserId ? 'osf' : 'email'),
        osfUserId: userData.osfUserId || null,
        ...(!userData.refreshToken && { refreshToken: '' }),
        ...(userData.refreshTokenExpires === undefined && { refreshTokenExpires: 0 }),
        ...(!userData.authToken && { authToken: '' }),
        ...(userData.authTokenExpires === undefined && { authTokenExpires: 0 }),
        usingPersonalToken: userData.usingPersonalToken !== undefined ? userData.usingPersonalToken : !userData.osfUserId
      };

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would update user ${doc.id}: authMethod=${updatedData.authMethod}`);
      } else {
        batch.update(doc.ref, updatedData);
      }
      batchCount++;

      // Firestore batch limit is 500
      if (batchCount === 500 && !DRY_RUN) {
        console.log('Committing batch...');
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Commit remaining updates
    if (batchCount > 0 && !DRY_RUN) {
      await batch.commit();
    }

    console.log(`Migration completed${DRY_RUN ? ' (DRY RUN)' : ''}. ${DRY_RUN ? 'Would update' : 'Updated'} ${snapshot.size} users.`);
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateUsers()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { migrateUsers };
