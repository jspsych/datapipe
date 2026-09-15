/**
 * @jest-environment node
 *
 * Security rules for the default Storage bucket (storage.rules).
 *
 * Every object under this bucket -- pending-data/, upload-queue/,
 * finalization/ -- is written and read exclusively by the Admin SDK from
 * Cloud Functions (persist-pending.ts, queue-upload.ts,
 * scheduled-pending-recovery.ts, scheduled-upload-retry.ts, finalization.ts,
 * purge-user-data.ts), which bypasses these rules entirely. This suite exists
 * to pin down the CLIENT-facing surface: no signed-in DataPipe user, and no
 * unauthenticated caller, should ever be able to read, list or write
 * participant data in this bucket with a plain Storage SDK call. There is no
 * legitimate client use of Storage in this app (no `getStorage`/
 * `firebase/storage` import anywhere under pages/components/lib), so every
 * assertion below is `assertFails`, never `assertSucceeds`.
 *
 * Sibling of __tests__/firestore-rules.test.js and __tests__/database-rules.test.js
 * and set up the same way, via @firebase/rules-unit-testing against the
 * emulator. Needs the STORAGE emulator on port 9199
 * (`firebase emulators:start --only storage`, or the full
 * `firebase emulators:exec` the CI workflow already runs).
 */

import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, getBytes, uploadBytes, list } from 'firebase/storage';
import { readFileSync } from 'fs';

let testEnv;

const PENDING_PATH = 'pending-data/x/y';
const QUEUE_PATH = 'upload-queue/z';

async function seedObject(path) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), path), new Uint8Array([1, 2, 3]));
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'datapipe-test',
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      host: 'localhost',
      port: 9199,
    },
  });
  // Seed real objects so the read/list denials are exercised against
  // something that exists, not just a 404 that would deny for the wrong
  // reason.
  await seedObject(PENDING_PATH);
  await seedObject(QUEUE_PATH);
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe.each([
  ['an unauthenticated client', () => testEnv.unauthenticatedContext()],
  ['an authenticated client', () => testEnv.authenticatedContext('user123')],
])('%s', (_label, makeContext) => {
  it('is denied getBytes on a pending-data object', async () => {
    const context = makeContext();
    await assertFails(getBytes(ref(context.storage(), PENDING_PATH)));
  });

  it('is denied getBytes on an upload-queue object', async () => {
    const context = makeContext();
    await assertFails(getBytes(ref(context.storage(), QUEUE_PATH)));
  });

  it('is denied list on pending-data', async () => {
    const context = makeContext();
    await assertFails(list(ref(context.storage(), 'pending-data/x'), { maxResults: 10 }));
  });

  it('is denied list on upload-queue', async () => {
    const context = makeContext();
    await assertFails(list(ref(context.storage(), 'upload-queue'), { maxResults: 10 }));
  });

  it('is denied uploadBytes anywhere', async () => {
    const context = makeContext();
    await assertFails(
      uploadBytes(ref(context.storage(), 'pending-data/x/new-upload'), new Uint8Array([9]))
    );
    await assertFails(
      uploadBytes(ref(context.storage(), 'some/other/path'), new Uint8Array([9]))
    );
  });
});
