const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  // For production, use service account key
  // const serviceAccount = require('./path-to-service-account-key.json');
  // admin.initializeApp({
  //   credential: admin.credential.cert(serviceAccount)
  // });
  
  // For development/testing with emulator
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  admin.initializeApp({
    projectId: 'datapipe-test' 
  });
}

const db = admin.firestore();

async function migrateUsers() {
  try {
    console.log('Starting user migration...');
    
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    
    const batch = db.batch();
    let batchCount = 0;
    
    snapshot.forEach((doc) => {
      const userData = doc.data();
      
      const updatedData = {
        ...userData,
        authMethod: userData.osfUserId ? 'osf' : 'email', // Determine auth method
        osfUserId: userData.osfUserId || null,
        refreshToken: userData.refreshToken || '',
        refreshTokenExpires: userData.refreshTokenExpires || 0,
        authToken: userData.authToken || '',
        authTokenExpires: userData.authTokenExpires || 0,
        usingPersonalToken: userData.usingPersonalToken !== undefined ? userData.usingPersonalToken : true
      };
      
      batch.update(doc.ref, updatedData);
      batchCount++;
      
      // Firestore batch limit is 500
      if (batchCount === 500) {
        console.log('Committing batch...');
        batch.commit();
        batchCount = 0;
      }
    });
    
    // Commit remaining updates
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`Migration completed. Updated ${snapshot.size} users.`);
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
