/**
 * @jest-environment node
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
let testEnv;

async function seedDB(data){
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const dbAdmin = context.firestore();
    for (const [key, value] of Object.entries(data)) {
      await setDoc(doc(dbAdmin, key), value);
    }
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'osf-relay',
    firestore: {
      rules:  readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080
    }
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('/users', () => {
  it('should deny read access to unauthenticated users', async () => {
    const unauth = testEnv.unauthenticatedContext();
    
    await assertFails(getDoc(doc(unauth.firestore(), 'users/123')));
  });

  it('should allow read access to authenticated users for their own doc', async () => {
    const user123 = testEnv.authenticatedContext('user123');
    
    await assertSucceeds(getDoc(doc(user123.firestore(), 'users/user123')));
  });

  it('should deny read access to authenticated users for another users doc', async () => {
    const user123 = testEnv.authenticatedContext('user123');
    
    await assertFails(getDoc(doc(user123.firestore(), 'users/user456')));
  });
});

describe('/experiments', () => {
  it('should allow deny read access to unauthenticated users', async () => {
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(getDoc(doc(unauth.firestore(), 'experiments/123')));
  });

  it('should allow read access to authenticated users for their own doc', async () => {
    const data = {
      'experiments/123': {
        owner: 'user123',
      }
    }
    await seedDB(data);

    const user123 = testEnv.authenticatedContext('user123');

    await assertSucceeds(getDoc(doc(user123.firestore(), 'experiments/123')));
  });

  it('should deny read access to authenticated users for their own doc', async () => {
    const data = {
      'experiments/456': {
        owner: 'user456',
      }
    }
    await seedDB(data);

    const user123 = testEnv.authenticatedContext('user123');

    await assertFails(getDoc(doc(user123.firestore(), 'experiments/456')));
  });

});