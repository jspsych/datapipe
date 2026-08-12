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

  // NOTE: this block previously asserted that a legacy OSF-shaped CREATE
  // succeeds. OSF is shutting down its projects feature, so that guarantee is
  // now inverted -- creating an experiment against OSF must be impossible.
  // The rule, not the UI, is what enforces it: OSF experiments were created
  // browser-side with the client SDK, so removing the option from
  // pages/admin/new.js only hid it.
  describe('1. OSF is closed to new experiments', () => {
    it('DENIES a create carrying the legacy OSF field trio and no storageProvider', async () => {
      const docId = 'exp-osf-create-legacy-shape';
      const user123 = testEnv.authenticatedContext('user123');

      await assertFails(setDoc(doc(user123.firestore(), `experiments/${docId}`), baseFields({
        id: docId,
        owner: 'user123',
        osfRepo: 'abc12',
        osfComponent: 'def34',
        osfFilesLink: 'https://files.osf.io/v1/resources/abc12/providers/osfstorage/',
      })));
    });

    it('DENIES a create with an explicit storageProvider of osf', async () => {
      const docId = 'exp-osf-create-explicit';
      const user123 = testEnv.authenticatedContext('user123');

      await assertFails(setDoc(doc(user123.firestore(), `experiments/${docId}`), baseFields({
        id: docId,
        owner: 'user123',
        storageProvider: 'osf',
        providerContainer: { provider: 'osf', filesLink: 'https://files.osf.io/v1/x/' },
      })));
    });

    it('DENIES a create with NO storageProvider at all -- absent used to mean OSF', async () => {
      // getProviderForExperiment in functions/src/providers/index.ts treats a
      // missing storageProvider as OSF, so leaving that branch creatable
      // would be a second, quieter way onto OSF.
      const docId = 'exp-osf-create-absent';
      const user123 = testEnv.authenticatedContext('user123');

      await assertFails(setDoc(doc(user123.firestore(), `experiments/${docId}`), baseFields({
        id: docId,
        owner: 'user123',
      })));
    });

    it('ALLOWS a create against a non-OSF provider', async () => {
      const docId = 'exp-gdrive-create';
      const user123 = testEnv.authenticatedContext('user123');

      await assertSucceeds(setDoc(doc(user123.firestore(), `experiments/${docId}`), baseFields({
        id: docId,
        owner: 'user123',
        storageProvider: 'gdrive',
        providerContainer: { provider: 'gdrive', folderId: 'folder-abc' },
      })));
    });

    it('still ALLOWS the owner to update an EXISTING legacy OSF experiment', async () => {
      // This is the whole point of closing creates rather than deleting the
      // OSF path: studies already collecting must keep working through the
      // wind-down, which means their documents stay editable.
      const docId = 'exp-osf-update-existing';
      await seedDB({
        [`experiments/${docId}`]: baseFields({
          id: docId,
          owner: 'user123',
          osfRepo: 'abc12',
          osfComponent: 'def34',
          osfFilesLink: 'https://files.osf.io/v1/resources/abc12/providers/osfstorage/',
        }),
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertSucceeds(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { active: true })
      );
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

      // uid/email/experiments are all present, so connectedAccounts is the
      // ONLY reason this is denied.
      await assertFails(setDoc(doc(user123.firestore(), 'users/user123'), {
        uid: 'user123',
        email: 'john@doe.com',
        experiments: ['exp1'],
        connectedAccounts: { gdrive: { authMethod: 'oauth2' } },
      }));
    });
  });

  describe('5. slim account creation (federated sign-in)', () => {
    // Federated sign-in (Google/ORCID/GitHub) goes through neither the old
    // signup form nor the OSF callback, so ensureUserDocument in
    // lib/user-bootstrap.js writes just { uid, email, experiments }. The rule
    // used to require osfToken == '' unconditionally, which rejected exactly
    // this shape because the field is absent rather than empty.
    it('ALLOWS the slim { uid, email, experiments } shape with no OSF fields', async () => {
      const user123 = testEnv.authenticatedContext('user123');

      await assertSucceeds(setDoc(doc(user123.firestore(), 'users/user123'), {
        uid: 'user123',
        email: 'researcher@example.edu',
        experiments: [],
      }));
    });

    it('ALLOWS an empty email -- ORCID users often have no address to record', async () => {
      const user789 = testEnv.authenticatedContext('user789');

      await assertSucceeds(setDoc(doc(user789.firestore(), 'users/user789'), {
        uid: 'user789',
        email: '',
        experiments: [],
      }));
    });

    it('still DENIES a non-empty osfToken when the field IS present', async () => {
      const user123 = testEnv.authenticatedContext('user123');

      await assertFails(setDoc(doc(user123.firestore(), 'users/user123'), {
        uid: 'user123',
        email: 'researcher@example.edu',
        experiments: [],
        osfToken: 'a-real-looking-token',
      }));
    });
  });
});