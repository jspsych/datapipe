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
      osfToken: '',
      uid: 'user123'
    }));
  });

  it('should deny writes when uid does not match authenticated user id', async () => {
    const user123 = testEnv.authenticatedContext('user123');

    await assertFails(setDoc(doc(user123.firestore(), 'users/user456'), {
      email: 'john@doe.com',
      experiments: ['exp1', 'exp2'],
      osfToken: '',
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

// ---------------------------------------------------------------------------
// step 7a: firestore.rules generalization (scratchpad/step7a-create-endpoint-
// spec.md). These are ADDITIVE describe blocks -- none of the cases above are
// altered. They exercise the NEW rules shape (baseFields() minus the OSF trio
// plus a storageProvider/providerContainer-OR-osfRepo/osfComponent/
// osfFilesLink conditional) that firestore.rules does not implement yet.
//
// Field-set parity: `baseFields()` below is the current verifyFields() hasAll
// list (['active', 'activeBase64', 'activeConditionAssignment', 'id',
// 'osfRepo', 'osfComponent', 'osfFilesLink', 'owner', 'title', 'sessions',
// 'nConditions', 'currentCondition', 'useValidation', 'allowJSON', 'allowCSV',
// 'requiredFields', 'maxSessions', 'limitSessions']) MINUS the three OSF
// fields, exactly as the spec's new baseFields() is defined to be.
//
// Expected-red summary (see build-step report for the verified run):
// - case 1 (legacy OSF create): both sub-cases already PASS today -- pinned
//   regression guards, not exercising the gap.
// - case 2 (gdrive-shaped UPDATE succeeds for the owner): RED today -- current
//   verifyFields() unconditionally requires osfRepo/osfComponent/osfFilesLink,
//   which a gdrive-shaped doc never has.
// - case 3 (gdrive-shaped update validation): both assertFails sub-cases
//   already hold true today, but not for the reason the new rules will
//   enforce -- today ANY gdrive-shaped doc is denied (missing the OSF trio)
//   regardless of providerContainer or ownership; they're pinned here as
//   "must remain denied after the generalization too", not proof of the gap.
// - case 4 (/users hasOnly unchanged): already PASSes today -- pinned
//   regression guard that clients still cannot write connectedAccounts.
describe('/experiments — provider-migration generalization (step 7a)', () => {
  function baseFields(overrides = {}) {
    return {
      active: false,
      activeBase64: false,
      activeConditionAssignment: false,
      id: overrides.id,
      owner: overrides.owner,
      title: 'Test experiment',
      sessions: 0,
      nConditions: 1,
      currentCondition: 0,
      useValidation: true,
      allowJSON: true,
      allowCSV: true,
      requiredFields: [],
      maxSessions: 1,
      limitSessions: false,
      ...overrides,
    };
  }

  describe('1. legacy OSF experiment create (regression guard)', () => {
    it('succeeds with all OSF fields present -- expected to PASS today and after generalization', async () => {
      const docId = 'exp-7a-legacy-create-1';
      const user123 = testEnv.authenticatedContext('user123');

      await assertSucceeds(setDoc(doc(user123.firestore(), `experiments/${docId}`), baseFields({
        id: docId,
        owner: 'user123',
        osfRepo: 'abc12',
        osfComponent: 'def34',
        osfFilesLink: 'https://files.osf.io/v1/resources/abc12/providers/osfstorage/',
      })));
    });

    it('fails when osfFilesLink is missing and no storageProvider is present -- pinned contract', async () => {
      const docId = 'exp-7a-legacy-create-2';
      const user123 = testEnv.authenticatedContext('user123');

      await assertFails(setDoc(doc(user123.firestore(), `experiments/${docId}`), baseFields({
        id: docId,
        owner: 'user123',
        osfRepo: 'abc12',
        osfComponent: 'def34',
        // osfFilesLink deliberately omitted; no storageProvider either.
      })));
    });
  });

  describe('2. gdrive-shaped experiment update by owner', () => {
    it('succeeds for the owner when the doc carries storageProvider + providerContainer instead of OSF fields', async () => {
      const docId = 'exp-7a-gdrive-update-1';
      await seedDB({
        [`experiments/${docId}`]: baseFields({
          id: docId,
          owner: 'user123',
          storageProvider: 'gdrive',
          providerContainer: { provider: 'gdrive', folderId: 'folder-abc' },
        }),
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertSucceeds(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { active: true })
      );
    });
  });

  describe('3. gdrive-shaped update validation', () => {
    it('fails when providerContainer is missing even though storageProvider is present', async () => {
      const docId = 'exp-7a-gdrive-update-2';
      await seedDB({
        [`experiments/${docId}`]: baseFields({
          id: docId,
          owner: 'user123',
          storageProvider: 'gdrive',
          // providerContainer deliberately omitted.
        }),
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertFails(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { active: true })
      );
    });

    it('fails when a non-owner attempts to update a gdrive-shaped experiment', async () => {
      const docId = 'exp-7a-gdrive-update-3';
      await seedDB({
        [`experiments/${docId}`]: baseFields({
          id: docId,
          owner: 'user123',
          storageProvider: 'gdrive',
          providerContainer: { provider: 'gdrive', folderId: 'folder-abc' },
        }),
      });

      const user456 = testEnv.authenticatedContext('user456');
      await assertFails(
        updateDoc(doc(user456.firestore(), `experiments/${docId}`), { active: true })
      );
    });
  });

  describe('4. /users hasOnly unchanged (regression guard)', () => {
    it('rejects account-creation writes that include connectedAccounts -- clients can never write it', async () => {
      const user123 = testEnv.authenticatedContext('user123');

      await assertFails(setDoc(doc(user123.firestore(), 'users/user123'), {
        email: 'john@doe.com',
        experiments: ['exp1'],
        osfToken: '',
        connectedAccounts: { gdrive: { authMethod: 'oauth2' } },
      }));
    });
  });
});