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

  it('should allow writes with the right data', async () => {
    const user123 = testEnv.authenticatedContext('user123');

    await assertSucceeds(setDoc(doc(user123.firestore(), 'users/user123'), {
      email: 'john@doe.com',
      experiments: ['exp1', 'exp2'],
      osfToken: 'abc123',
      uid: 'user123'
    }));
  });

  it('should deny writes when uid does not match authenticated user id', async () => {
    const user123 = testEnv.authenticatedContext('user123');

    await assertFails(setDoc(doc(user123.firestore(), 'users/user123'), {
      email: 'john@doe.com',
      experiments: ['exp1', 'exp2'],
      osfToken: 'abc123',
      uid: 'user456'
    }));
  });


  it('should deny writes that have extra keys', async () => {
    const user123 = testEnv.authenticatedContext('user123');
    
    await assertFails(setDoc(doc(user123.firestore(), 'users/user123'), {
      name: 'John Doe',
      email: 'john@doe.com',
      extra: 'extra'
    }));
  })
});

describe('/experiments', () => {
  it('should deny read access to unauthenticated users', async () => {
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

  it('should deny read access to authenticated users for someone elses doc', async () => {
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