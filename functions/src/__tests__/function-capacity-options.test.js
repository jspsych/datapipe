/**
 * @jest-environment node
 *
 * Pure regression test for the submission-capacity fix: apiData and
 * apiBase64 (functions/src/api-data.ts, functions/src/api-base64.ts) must
 * declare a per-function maxInstances that overrides index.ts's global
 * maxInstances: 20, plus a timeoutSeconds long enough for collision-cache.ts's
 * rehydrate() to finish on a legacy experiment with many existing files, while
 * keeping concurrency: 1 (058a1db's memory-safety fix for concurrent large
 * payloads on a 512MiB instance).
 *
 * Imports the BUILT output rather than the .ts source: firebase-functions v2
 * attaches the declared options to the exported function as `__endpoint`
 * (a ManifestEndpoint -- see firebase-functions/lib/runtime/manifest.d.ts)
 * only once onRequest() actually runs, which requires compiled JS. No
 * emulator is touched -- `initializeApp()` in app.ts only opens connections
 * when a request handler actually runs, never at import/declaration time (see
 * concurrency-limit.test.js for the same "import lib/*.js directly" pattern).
 *
 * providers/index.js is mocked out before either import: it is the sole
 * entry point through which api-data.js/api-base64.js (directly, and via
 * metadata-block.js/metadata-derived-upload.js/resolve-token.js) reach
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
import { apiBase64 } from '../../lib/api-base64.js';

// index.ts's setGlobalOptions({ maxInstances: 20 }) -- every function without
// its own override is bounded by this. apiData/apiBase64 must exceed it, and
// this constant is what makes that assertion self-documenting instead of a
// bare magic number.
const GLOBAL_MAX_INSTANCES = 20;

describe('apiData capacity options (functions/src/api-data.ts)', () => {
  it('overrides the global maxInstances with a much higher per-function ceiling', () => {
    const { maxInstances } = apiData.__endpoint;
    expect(typeof maxInstances).toBe('number');
    expect(maxInstances).toBeGreaterThan(GLOBAL_MAX_INSTANCES);
    // A few hundred simultaneous submissions (the design doc's lecture-hall
    // example) must be servable without shedding.
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

describe('apiBase64 capacity options (functions/src/api-base64.ts)', () => {
  it('overrides the global maxInstances with a higher per-function ceiling', () => {
    const { maxInstances } = apiBase64.__endpoint;
    expect(typeof maxInstances).toBe('number');
    expect(maxInstances).toBeGreaterThan(GLOBAL_MAX_INSTANCES);
  });

  it('sets timeoutSeconds to 300, up from the 60s default', () => {
    expect(apiBase64.__endpoint.timeoutSeconds).toBe(300);
  });

  it('keeps concurrency: 1 (058a1db) and memory: 512MiB', () => {
    expect(apiBase64.__endpoint.concurrency).toBe(1);
    expect(apiBase64.__endpoint.availableMemoryMb).toBe(512);
  });

  it('sizes its ceiling below apiData, since base64 payloads run larger per request', () => {
    expect(apiBase64.__endpoint.maxInstances).toBeLessThan(apiData.__endpoint.maxInstances);
  });
});
