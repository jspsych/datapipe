/**
 * @jest-environment node
 *
 * Pure regression test for the submission-capacity fix: apiData
 * (functions/src/api-data.ts) must declare a per-function maxInstances that
 * overrides index.ts's global maxInstances: 20, plus a timeoutSeconds long
 * enough for collision-cache.ts's rehydrate() to finish on a legacy
 * experiment with many existing files, while keeping concurrency: 1
 * (058a1db's memory-safety fix for concurrent large payloads on a 512MiB
 * instance).
 *
 * apiBase64 (functions/src/api-base64.ts) had its OWN such block here until
 * the participant-api consolidation's step 2: apiBase64 no longer deploys as
 * its own function (removed along with apisessionstart/apicondition -- see
 * api-data.ts's ROUTING NOTE and participant-api.ts's header), so a request
 * to /api/base64 now runs under apiData's own onRequest options, tested
 * below, and there is no separate apiBase64 __endpoint left to assert on.
 * apiBase64Handler's own capacity comment (api-base64.ts) documents this; it
 * intentionally keeps NO onRequest options of its own anymore.
 *
 * Imports the BUILT output rather than the .ts source: firebase-functions v2
 * attaches the declared options to the exported function as `__endpoint`
 * (a ManifestEndpoint -- see firebase-functions/lib/runtime/manifest.d.ts)
 * only once onRequest() actually runs, which requires compiled JS. No
 * emulator is touched -- `initializeApp()` in app.ts only opens connections
 * when a request handler actually runs, never at import/declaration time (see
 * concurrency-limit.test.js for the same "import lib/*.js directly" pattern).
 *
 * providers/index.js is mocked out before the import: it is the sole entry
 * point through which api-data.js (directly, and via
 * metadata-block.js/metadata-derived-upload.js/resolve-token.js) reaches
 * providers/osf.js, which does `import fetch from "node-fetch"` -- an
 * ESM-only package outside next/jest's transformIgnorePatterns allowlist
 * (see the allowlist-widening comment in jest.config.js for jose/nanoid, the
 * same class of problem). Nothing in this suite calls a provider, so the mock
 * needs no behavior.
 */

jest.mock('../../lib/providers/index.js', () => ({
  getProviderForExperiment: jest.fn(),
  claimNameFor: jest.fn(),
  getProvider: jest.fn(),
}));

import { apiData } from '../../lib/api-data.js';
// Phase 3 of the Cloud Functions consolidation: compaction moved out of the
// two Firestore triggers and into a dedicated Cloud Task
// (compaction-task.ts), specifically so only the task pays for the 1GiB/540s
// a pass needs and the triggers that almost always return early can run at
// 256MiB instead. These imports reach the same providers/index.js mocked
// above (through compaction.js/resolve-token.js), so no new ESM landmine.
import { compactionTask } from '../../lib/compaction-task.js';
import { onExperimentGrew } from '../../lib/compaction-triggers.js';
import { onUploadQueueChanged } from '../../lib/upload-queue-trigger.js';

// index.ts's setGlobalOptions({ maxInstances: 20 }) -- every function without
// its own override is bounded by this. apiData must exceed it, and this
// constant is what makes that assertion self-documenting instead of a bare
// magic number.
const GLOBAL_MAX_INSTANCES = 20;

describe('apiData capacity options (functions/src/api-data.ts)', () => {
  it('overrides the global maxInstances with a much higher per-function ceiling', () => {
    const { maxInstances } = apiData.__endpoint;
    expect(typeof maxInstances).toBe('number');
    expect(maxInstances).toBeGreaterThan(GLOBAL_MAX_INSTANCES);
    // A few hundred simultaneous submissions (the design doc's lecture-hall
    // example) must be servable without shedding. This ceiling now also
    // governs /api/base64 traffic, dispatched from within this same function
    // -- see the module header.
    expect(maxInstances).toBeGreaterThanOrEqual(200);
  });

  it('sets timeoutSeconds to 300, up from the 60s default', () => {
    expect(apiData.__endpoint.timeoutSeconds).toBe(300);
  });

  it('keeps concurrency: 1 (058a1db) and memory: 512MiB', () => {
    expect(apiData.__endpoint.concurrency).toBe(1);
    expect(apiData.__endpoint.availableMemoryMb).toBe(512);
  });
});


describe('compaction consolidation capacity options (functions/src/compaction-task.ts, compaction-triggers.ts, upload-queue-trigger.ts)', () => {
  it('compactionTask keeps the 1GiB/540s a compaction pass actually needs', () => {
    // Not a new number: this is exactly what onExperimentGrew/onUploadQueueChanged
    // used to declare before the pass moved into its own Cloud Task. A pass
    // holds a batch up to MAX_BATCH_BYTES plus the assembled zip in memory.
    expect(compactionTask.__endpoint.availableMemoryMb).toBe(1024);
    expect(compactionTask.__endpoint.timeoutSeconds).toBe(540);
  });

  it('onExperimentGrew runs at 256MiB now that it only decides whether to enqueue', () => {
    expect(onExperimentGrew.__endpoint.availableMemoryMb).toBe(256);
  });

  it('onUploadQueueChanged runs at 256MiB, covering both failure-notify and compaction discovery', () => {
    expect(onUploadQueueChanged.__endpoint.availableMemoryMb).toBe(256);
  });
});
