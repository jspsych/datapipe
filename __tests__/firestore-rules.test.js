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

  // metadataActive decides where a submission is stored (container root vs
  // data/raw/) and which namespace the collision cache claims in, so flipping
  // it mid-collection strands the files already written and resets duplicate
  // detection against them. It freezes at the first submission -- not at
  // creation, because before any data exists the choice is harmless and
  // correcting it pre-pilot is the case researchers actually hit.
  describe('3b. metadataActive freezes once data has been collected', () => {
    function gdriveExp(docId, overrides = {}) {
      return baseFields({
        id: docId,
        owner: 'user123',
        storageProvider: 'gdrive',
        providerContainer: { provider: 'gdrive', folderId: 'folder-abc' },
        metadataActive: false,
        ...overrides,
      });
    }

    it('ALLOWS the owner to change it while the experiment has no data', async () => {
      const docId = 'exp-meta-lock-fresh';
      await seedDB({ [`experiments/${docId}`]: gdriveExp(docId, { sessions: 0 }) });

      const user123 = testEnv.authenticatedContext('user123');
      await assertSucceeds(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { metadataActive: true })
      );
    });

    it('DENIES a change once sessions have been recorded', async () => {
      const docId = 'exp-meta-lock-sessions';
      await seedDB({ [`experiments/${docId}`]: gdriveExp(docId, { sessions: 3 }) });

      const user123 = testEnv.authenticatedContext('user123');
      await assertFails(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { metadataActive: true })
      );
    });

    it('DENIES turning it OFF too, not just on', async () => {
      const docId = 'exp-meta-lock-off';
      await seedDB({
        [`experiments/${docId}`]: gdriveExp(docId, { sessions: 3, metadataActive: true }),
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertFails(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { metadataActive: false })
      );
    });

    // collisionCache is server-managed and clients cannot write it, so it
    // survives a client that zeroed its own sessions counter to get the
    // setting back.
    it('DENIES a change when collisionCache exists even if sessions reads 0', async () => {
      const docId = 'exp-meta-lock-cache';
      await seedDB({
        [`experiments/${docId}`]: gdriveExp(docId, {
          sessions: 0,
          collisionCache: { salt: 'seeded-salt' },
        }),
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertFails(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { metadataActive: true })
      );
    });

    // The lock is scoped to ONE field: a collecting experiment must stay
    // otherwise editable (pausing collection, retitling, condition changes).
    it('still ALLOWS other edits on a collecting experiment', async () => {
      const docId = 'exp-meta-lock-others';
      await seedDB({ [`experiments/${docId}`]: gdriveExp(docId, { sessions: 3 }) });

      const user123 = testEnv.authenticatedContext('user123');
      await assertSucceeds(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), {
          active: true,
          title: 'Renamed mid-study',
        })
      );
    });

    // A no-op write that merely restates the current value changes nothing,
    // so affectedKeys() never flags it -- worth pinning so a future rewrite
    // does not start rejecting the dashboard's own idempotent merge writes.
    it('ALLOWS a write that re-states the SAME value on a collecting experiment', async () => {
      const docId = 'exp-meta-lock-noop';
      await seedDB({ [`experiments/${docId}`]: gdriveExp(docId, { sessions: 3 }) });

      const user123 = testEnv.authenticatedContext('user123');
      await assertSucceeds(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { metadataActive: false })
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

  // Phase 4 of docs/finalization-spec.md. Finalization is permanent (decision
  // 1) -- finalized/finalizedAt/finalization are written ONLY by admin-SDK
  // code (functions/src/api-finalize.ts, functions/src/finalization.ts),
  // which bypasses these rules entirely, so the whole point of this section
  // is that the CLIENT SDK path (what these rules actually govern) can never
  // touch them, in either direction: a researcher could otherwise clear
  // `finalized` to keep submitting after finalization deleted the loose
  // files, or set it early to fake a finalized state before the merge ever
  // ran.
  describe('6. finalization fields are locked against client writes', () => {
    function finalizedFields(overrides = {}) {
      return baseFields({
        id: overrides.id,
        owner: overrides.owner,
        storageProvider: 'zenodo',
        providerContainer: { provider: 'zenodo', depositionId: 1 },
        ...overrides,
      });
    }

    it('DENIES a client update that clears finalized on an already-finalized experiment', async () => {
      const docId = 'exp-finalize-clear';
      await seedDB({
        [`experiments/${docId}`]: {
          ...finalizedFields({ id: docId, owner: 'user123' }),
          finalized: true,
          finalization: { status: 'finalized' },
        },
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertFails(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { finalized: false })
      );
    });

    it('DENIES a client update that sets finalized to true on a non-finalized experiment', async () => {
      const docId = 'exp-finalize-forge';
      await seedDB({
        [`experiments/${docId}`]: finalizedFields({ id: docId, owner: 'user123' }),
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertFails(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { finalized: true })
      );
    });

    it('DENIES a client update that writes finalizedAt', async () => {
      const docId = 'exp-finalize-timestamp';
      await seedDB({
        [`experiments/${docId}`]: finalizedFields({ id: docId, owner: 'user123' }),
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertFails(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), {
          finalizedAt: new Date(),
        })
      );
    });

    it('DENIES a client update that writes the finalization progress map', async () => {
      const docId = 'exp-finalize-progress';
      await seedDB({
        [`experiments/${docId}`]: finalizedFields({ id: docId, owner: 'user123' }),
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertFails(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), {
          finalization: { status: 'finalized' },
        })
      );
    });

    it('DENIES a create that arrives already carrying finalized: true', async () => {
      const docId = 'exp-finalize-create-forge';
      const user123 = testEnv.authenticatedContext('user123');

      await assertFails(
        setDoc(doc(user123.firestore(), `experiments/${docId}`), {
          ...finalizedFields({ id: docId, owner: 'user123' }),
          finalized: true,
        })
      );
    });

    it('ALLOWS an ordinary field update on a finalized experiment, leaving finalized untouched', async () => {
      // The owner must still be able to edit ordinary settings (e.g. flip
      // `active` off) after finalization -- only finalized/finalizedAt/
      // finalization are locked, not the whole document.
      const docId = 'exp-finalize-ordinary-edit';
      await seedDB({
        [`experiments/${docId}`]: {
          ...finalizedFields({ id: docId, owner: 'user123' }),
          finalized: true,
          finalization: { status: 'finalized' },
          active: true,
        },
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertSucceeds(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { active: false })
      );
    });

    it('ALLOWS ordinary edits on a non-finalized experiment (regression guard)', async () => {
      const docId = 'exp-finalize-not-touched';
      await seedDB({
        [`experiments/${docId}`]: finalizedFields({ id: docId, owner: 'user123' }),
      });

      const user123 = testEnv.authenticatedContext('user123');
      await assertSucceeds(
        updateDoc(doc(user123.firestore(), `experiments/${docId}`), { maxSessions: 50 })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// P0 of the contact-email + upload-failure-notification work.
//
// Two independent rule changes, plus the collections that are protected by
// having NO rule at all:
//
//   users/{uid}   -- the contactEmail group becomes client-writable, but
//                    contactEmailVerified only ever as false.
//   experiments/{id} -- uploadFailure joins serverManagedFieldsUntouched().
//   contactEmailVerifications/{uid}, mail/{id} -- unmatched, default-denied.
//
// Every test below uses a uid/docId of its own. Nothing in this suite is
// cleaned up between tests, so reusing 'user123' would mean asserting against
// whatever an earlier test left on that document.
// ---------------------------------------------------------------------------
describe('contact email (P0)', () => {
  // The slim shape ensureUserDocument writes, before any contact fields.
  function slimUser(uid, overrides = {}) {
    return { uid, email: 'researcher@example.edu', experiments: [], ...overrides };
  }

  // Seed shape for the UPDATE tests, and the reason it is not slimUser:
  // isAccountCreation() tests the SHAPE of request.resource.data, not whether
  // the document already exists. On an update, request.resource.data is the
  // merged document -- so any update to a document whose whole merged shape
  // still fits the creation whitelist is permitted by isAccountCreation(),
  // whatever it touches. (That is pre-existing behaviour, not something this
  // change introduced.) connectedAccounts is outside the whitelist and sits on
  // real migrated user documents, so seeding it here forces every assertion
  // below to be decided by isContactEmailUpdate() -- which is the rule under
  // test. Without it, several of these would pass or fail for the wrong reason.
  function existingUser(uid, overrides = {}) {
    return slimUser(uid, {
      connectedAccounts: { gdrive: { authMethod: 'oauth2' } },
      ...overrides,
    });
  }

  describe('account creation', () => {
    it('ALLOWS the seeded shape carrying the contactEmail group', async () => {
      const uid = 'ce-create-seeded';
      const ctx = testEnv.authenticatedContext(uid);

      await assertSucceeds(setDoc(doc(ctx.firestore(), `users/${uid}`), slimUser(uid, {
        contactEmail: 'researcher@example.edu',
        contactEmailVerified: false,
        contactEmailUpdatedAt: 1700000000000,
        contactEmailSource: 'auth',
      })));
    });

    it('ALLOWS the slim shape with no contact fields at all (ORCID signup)', async () => {
      // contactEmail is NOT in hasAll() -- an account with no address to seed
      // must still be creatable; it meets the gate on its first /admin load.
      const uid = 'ce-create-slim';
      const ctx = testEnv.authenticatedContext(uid);

      await assertSucceeds(
        setDoc(doc(ctx.firestore(), `users/${uid}`), slimUser(uid, { email: '' }))
      );
    });

    it('DENIES a creation that self-certifies contactEmailVerified: true', async () => {
      // The whole point of the field: only the server may ever set it true.
      const uid = 'ce-create-verified';
      const ctx = testEnv.authenticatedContext(uid);

      await assertFails(setDoc(doc(ctx.firestore(), `users/${uid}`), slimUser(uid, {
        contactEmail: 'researcher@example.edu',
        contactEmailVerified: true,
      })));
    });

    it('DENIES a creation carrying an unlisted key alongside the contact group', async () => {
      // hasOnly() gained four keys, not a general amnesty.
      const uid = 'ce-create-extra-key';
      const ctx = testEnv.authenticatedContext(uid);

      await assertFails(setDoc(doc(ctx.firestore(), `users/${uid}`), slimUser(uid, {
        contactEmail: 'researcher@example.edu',
        connectedAccounts: { gdrive: { authMethod: 'oauth2' } },
      })));
    });
  });

  describe('contactEmail updates', () => {
    it('ALLOWS the four-key update the gate writes', async () => {
      const uid = 'ce-update-ok';
      await seedDB({ [`users/${uid}`]: existingUser(uid, { contactEmail: '', contactEmailVerified: false }) });

      const ctx = testEnv.authenticatedContext(uid);
      await assertSucceeds(updateDoc(doc(ctx.firestore(), `users/${uid}`), {
        contactEmail: 'lab-data@university.edu',
        contactEmailVerified: false,
        contactEmailUpdatedAt: 1700000000000,
        contactEmailSource: 'user',
      }));
    });

    it('ALLOWS a first-ever address on a document that has no contactEmailVerified field', async () => {
      // The `in` guard in contactEmailNotSelfCertified(). Reading a missing
      // key would otherwise error and deny a perfectly legitimate write --
      // every pre-feature user document is in exactly this state.
      const uid = 'ce-update-no-flag-field';
      await seedDB({ [`users/${uid}`]: existingUser(uid) });

      const ctx = testEnv.authenticatedContext(uid);
      await assertSucceeds(updateDoc(doc(ctx.firestore(), `users/${uid}`), {
        contactEmail: 'first@example.edu',
        contactEmailUpdatedAt: 1700000000000,
        contactEmailSource: 'user',
      }));
    });

    it('ALLOWS changing the address while flipping verified back to false', async () => {
      // The intended flow off a confirmed address: a new address is by
      // definition unconfirmed, and the client is the one that says so.
      const uid = 'ce-update-reverify';
      await seedDB({
        [`users/${uid}`]: existingUser(uid, {
          contactEmail: 'old@example.edu',
          contactEmailVerified: true,
        }),
      });

      const ctx = testEnv.authenticatedContext(uid);
      await assertSucceeds(updateDoc(doc(ctx.firestore(), `users/${uid}`), {
        contactEmail: 'new@example.edu',
        contactEmailVerified: false,
        contactEmailUpdatedAt: 1700000000001,
        contactEmailSource: 'user',
      }));
    });

    it('DENIES setting contactEmailVerified: true', async () => {
      const uid = 'ce-update-selfcertify';
      await seedDB({
        [`users/${uid}`]: existingUser(uid, {
          contactEmail: 'researcher@example.edu',
          contactEmailVerified: false,
        }),
      });

      const ctx = testEnv.authenticatedContext(uid);
      await assertFails(updateDoc(doc(ctx.firestore(), `users/${uid}`), {
        contactEmailVerified: true,
      }));
    });

    it('DENIES changing the address while leaving an existing verified: true standing', async () => {
      // The post-state test, not the diff test. request.resource.data is the
      // MERGED document on an update, so a write that touches only
      // contactEmail on an already-verified account would carry `true`
      // forward against an address nobody has confirmed.
      const uid = 'ce-update-carryover';
      await seedDB({
        [`users/${uid}`]: existingUser(uid, {
          contactEmail: 'old@example.edu',
          contactEmailVerified: true,
        }),
      });

      const ctx = testEnv.authenticatedContext(uid);
      await assertFails(updateDoc(doc(ctx.firestore(), `users/${uid}`), {
        contactEmail: 'new@example.edu',
        contactEmailUpdatedAt: 1700000000002,
      }));
    });

    it('DENIES touching contactEmail and experiments in one operation', async () => {
      // One narrow shape per intent: a contact-email save must not be a
      // vehicle for anything else on the document.
      const uid = 'ce-update-plus-experiments';
      await seedDB({ [`users/${uid}`]: existingUser(uid, { experiments: ['exp1'] }) });

      const ctx = testEnv.authenticatedContext(uid);
      await assertFails(updateDoc(doc(ctx.firestore(), `users/${uid}`), {
        contactEmail: 'researcher@example.edu',
        contactEmailVerified: false,
        experiments: ['exp1', 'exp2'],
      }));
    });

    it('DENIES an address longer than 254 characters', async () => {
      const uid = 'ce-update-too-long';
      await seedDB({ [`users/${uid}`]: existingUser(uid) });

      const ctx = testEnv.authenticatedContext(uid);
      await assertFails(updateDoc(doc(ctx.firestore(), `users/${uid}`), {
        contactEmail: `${'a'.repeat(250)}@example.edu`,
        contactEmailVerified: false,
      }));
    });

    it('DENIES an empty contactEmail', async () => {
      const uid = 'ce-update-empty';
      await seedDB({ [`users/${uid}`]: existingUser(uid, { contactEmail: 'researcher@example.edu' }) });

      const ctx = testEnv.authenticatedContext(uid);
      await assertFails(updateDoc(doc(ctx.firestore(), `users/${uid}`), {
        contactEmail: '',
        contactEmailVerified: false,
      }));
    });

    it('DENIES a non-string contactEmail', async () => {
      const uid = 'ce-update-nonstring';
      await seedDB({ [`users/${uid}`]: existingUser(uid) });

      const ctx = testEnv.authenticatedContext(uid);
      await assertFails(updateDoc(doc(ctx.firestore(), `users/${uid}`), {
        contactEmail: 12345,
        contactEmailVerified: false,
      }));
    });

    it('DENIES writing another user\'s contact email', async () => {
      const uid = 'ce-update-victim';
      await seedDB({ [`users/${uid}`]: existingUser(uid) });

      const attacker = testEnv.authenticatedContext('ce-update-attacker');
      await assertFails(updateDoc(doc(attacker.firestore(), `users/${uid}`), {
        contactEmail: 'attacker@example.com',
        contactEmailVerified: false,
      }));
    });
  });

  // The three shapes that existed before this change must keep working
  // exactly as they did. isContactEmailUpdate() is a fourth alternative in the
  // same disjunction, and a fourth alternative is the easiest place in a rules
  // file to accidentally narrow the other three.
  describe('legacy write shapes still work (regression)', () => {
    it('ALLOWS the OSF-era account-creation shape', async () => {
      const uid = 'ce-legacy-create';
      const ctx = testEnv.authenticatedContext(uid);

      await assertSucceeds(setDoc(doc(ctx.firestore(), `users/${uid}`), {
        uid,
        email: 'researcher@example.edu',
        experiments: [],
        osfToken: '',
        osfTokenValid: false,
        usingPersonalToken: false,
        createdAt: 1700000000000,
      }));
    });

    it('ALLOWS a usingPersonalToken-only update', async () => {
      const uid = 'ce-legacy-token-method';
      await seedDB({ [`users/${uid}`]: existingUser(uid, { usingPersonalToken: false }) });

      const ctx = testEnv.authenticatedContext(uid);
      await assertSucceeds(
        updateDoc(doc(ctx.firestore(), `users/${uid}`), { usingPersonalToken: true })
      );
    });

    it('ALLOWS an experiments-only update', async () => {
      const uid = 'ce-legacy-experiments';
      await seedDB({ [`users/${uid}`]: existingUser(uid, { experiments: ['exp1'] }) });

      const ctx = testEnv.authenticatedContext(uid);
      await assertSucceeds(
        updateDoc(doc(ctx.firestore(), `users/${uid}`), { experiments: ['exp1', 'exp2'] })
      );
    });
  });

  // No rule matches either collection, so Firestore default-denies them. These
  // tests exist because that protection is invisible in the rules file: the
  // verification code hash MUST NOT be reachable by the person being verified,
  // and `allow read` on users/{uid} hands the owner their whole document --
  // which is precisely why the hash lives in its own collection instead.
  describe('server-only collections are unreachable from any client', () => {
    it('DENIES the owner reading their own contactEmailVerifications document', async () => {
      const uid = 'ce-verif-owner';
      await seedDB({
        [`contactEmailVerifications/${uid}`]: {
          emailHash: 'deadbeef',
          codeHash: 'cafebabe',
          expiresAt: 1700000000000,
          attempts: 0,
          sentAt: 1699999999999,
        },
      });

      const ctx = testEnv.authenticatedContext(uid);
      await assertFails(getDoc(doc(ctx.firestore(), `contactEmailVerifications/${uid}`)));
    });

    it('DENIES the owner writing their own contactEmailVerifications document', async () => {
      // Writable would be as bad as readable: a client could install a code
      // hash it knows and then "verify" any address it likes.
      const uid = 'ce-verif-owner-write';
      const ctx = testEnv.authenticatedContext(uid);

      await assertFails(setDoc(doc(ctx.firestore(), `contactEmailVerifications/${uid}`), {
        codeHash: 'known-to-the-client',
        attempts: 0,
      }));
    });

    it('DENIES reading another user\'s contactEmailVerifications document', async () => {
      await seedDB({
        'contactEmailVerifications/ce-verif-victim': { codeHash: 'cafebabe', attempts: 0 },
      });

      const ctx = testEnv.authenticatedContext('ce-verif-snooper');
      await assertFails(
        getDoc(doc(ctx.firestore(), 'contactEmailVerifications/ce-verif-victim'))
      );
    });

    it('DENIES clients reading or writing the mail collection', async () => {
      // mail documents hold researchers' addresses and the message bodies the
      // Trigger Email extension will send.
      await seedDB({
        'mail/ce-mail-doc': {
          to: ['researcher@example.edu'],
          message: { subject: 'x', text: 'y' },
          datapipe: { kind: 'upload-failure', owner: 'ce-mail-owner' },
        },
      });

      const ctx = testEnv.authenticatedContext('ce-mail-owner');
      await assertFails(getDoc(doc(ctx.firestore(), 'mail/ce-mail-doc')));
      await assertFails(getDocs(collection(ctx.firestore(), 'mail')));
      await assertFails(setDoc(doc(ctx.firestore(), 'mail/ce-mail-forged'), {
        to: ['someone-else@example.com'],
        message: { subject: 'x', text: 'y' },
      }));
    });
  });
});

// experiments/{id}.uploadFailure -- the notifier's armed flag. Written only by
// the Admin SDK (functions/src/upload-failure-notify.ts), which bypasses these
// rules; what is being tested here is that the CLIENT SDK path cannot touch
// it. A researcher able to clear notifiedAt would re-arm the notifier and get
// mailed once per failed FILE -- twenty mails from one participant
// submission -- which is the exact failure mode the feature exists to prevent.
describe('/experiments — uploadFailure is server-managed (P0)', () => {
  function experimentFields(overrides = {}) {
    return {
      active: true,
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
      storageProvider: 'gdrive',
      providerContainer: { provider: 'gdrive', folderId: 'folder-abc' },
      ...overrides,
    };
  }

  it('DENIES a client update that writes uploadFailure', async () => {
    const docId = 'exp-uploadfailure-forge';
    await seedDB({
      [`experiments/${docId}`]: experimentFields({ id: docId, owner: 'uf-user' }),
    });

    const ctx = testEnv.authenticatedContext('uf-user');
    await assertFails(
      updateDoc(doc(ctx.firestore(), `experiments/${docId}`), {
        uploadFailure: { notifiedAt: null, failureCount: 0 },
      })
    );
  });

  it('DENIES a client update that clears uploadFailure.notifiedAt', async () => {
    // The re-arm attack, written the way a client actually would: a dotted
    // field path. affectedKeys() reports the TOP-LEVEL key, so this is caught
    // by the same list entry.
    const docId = 'exp-uploadfailure-rearm';
    await seedDB({
      [`experiments/${docId}`]: experimentFields({
        id: docId,
        owner: 'uf-user',
        uploadFailure: { notifiedAt: new Date(), failureCount: 3 },
      }),
    });

    const ctx = testEnv.authenticatedContext('uf-user');
    await assertFails(
      updateDoc(doc(ctx.firestore(), `experiments/${docId}`), {
        'uploadFailure.notifiedAt': null,
      })
    );
  });

  it('DENIES a create that arrives already carrying uploadFailure', async () => {
    const docId = 'exp-uploadfailure-create';
    const ctx = testEnv.authenticatedContext('uf-user');

    await assertFails(
      setDoc(doc(ctx.firestore(), `experiments/${docId}`), experimentFields({
        id: docId,
        owner: 'uf-user',
        uploadFailure: { notifiedAt: null },
      }))
    );
  });

  it('ALLOWS ordinary edits on an experiment that HAS uploadFailure', async () => {
    // Regression guard for the rule change itself: the dashboard's writers
    // (ExperimentActive.js, ExperimentValidation.js) are narrow merge writes,
    // so the presence of a protected field must not make them fail.
    const docId = 'exp-uploadfailure-ordinary-edit';
    await seedDB({
      [`experiments/${docId}`]: experimentFields({
        id: docId,
        owner: 'uf-user',
        uploadFailure: { notifiedAt: new Date(), failureCount: 3 },
      }),
    });

    const ctx = testEnv.authenticatedContext('uf-user');
    await assertSucceeds(
      updateDoc(doc(ctx.firestore(), `experiments/${docId}`), { active: false })
    );
  });
});