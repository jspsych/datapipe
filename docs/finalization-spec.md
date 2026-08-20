# Finalization — implementation spec

**STATUS: all four phases BUILT and tested (2026-08-20).** 58 suites / 680 tests
passing. Not deployed; see the deploy-time caveats at the end.

End-of-study compaction: merge every batch archive plus all remaining loose
files into ONE archive carrying the full Psych-DS tree, leaving
`dataset_description.json` loose. See the compaction section of
`provider-migration-design.md` for the incremental half, which already ships.

## Locked decisions

1. **Finalization is permanent.** A finalized experiment cannot be
   un-finalized. It stops accepting submissions: a session arriving afterwards
   would sit outside the archive and quietly make the record non-Psych-DS
   again.
2. **One archive, essentially always.** Multiple final archives are *allowed*
   but they break Psych-DS compatibility, so they are a last resort reachable
   only above a provider's hard per-file limit (Zenodo: 50 GB). They must never
   be triggered by our own memory ceiling — see Phase 2.
3. **`.psychds-ignore` goes INSIDE the final archive** and its loose copy is
   deleted. Nothing regenerates it once submissions stop.
   `dataset_description.json` stays loose so the record still shows a
   descriptor.
4. **Publishing / minting a DOI is out of scope.** Irreversible, and the
   researcher's call.

## Why streaming, not splitting

`buildArchive` assembles the whole zip in memory and `writeSessionFile` takes a
`Buffer`, so today the maximum final-archive size is bounded by function
memory. Raising memory just moves the wall. Since decision 2 says a split
breaks the format we exist to produce, the assemble-in-memory path is the thing
to remove: build the archive into Cloud Storage through a stream, then upload
it to the provider from a stream. Memory then stays flat regardless of study
size and a split is only ever forced by Zenodo's own 50 GB per-file limit,
which behavioral data will not reach.

## Phase 1 — archive reader

New module `functions/src/archive-reader.ts`.

```ts
export function readArchive(zip: Buffer): Map<string, Buffer>;
```

- Parse the **central directory**, not local file headers. archiver streams, so
  it sets the streaming bit and writes zeroed sizes into local headers with the
  real values in a trailing data descriptor. The central directory always
  carries true sizes. (A working reference implementation exists in
  `functions/src/__tests__/compaction-emulator.test.js` — `readZipEntries`.)
- Support compression method 0 (stored) and 8 (deflate, via
  `zlib.inflateRawSync`). Throw a descriptive `Error` for anything else.
- **Verify every member's CRC-32 and uncompressed size** against the central
  directory before returning it. Not optional politeness: Phase 3 re-emits a
  batch's members into the merged archive and then DELETES the batch, so a
  member that decoded to the wrong bytes would pass every downstream check
  (which only verify the *merged* archive uploaded intact) and the originals
  would be gone. Stored entries have no other integrity check at all.
- Byte-exact for binary content. Non-UTF-8 bytes must survive untouched.
- Throw a descriptive `Error` on a truncated buffer, a missing
  end-of-central-directory record, or a corrupt entry signature.
- No new npm dependency.

**Correction, found while building this (2026-08-20):** an earlier draft of this
spec claimed archiver "may choose STORED over DEFLATE" for incompressible data.
That is false for `buildArchive` as configured — `zip-stream` emits method 0
only when `zlib.level` is exactly 0, the entry is a directory/symlink, or
`store: true` is passed, and `buildArchive` uses level 9 unconditionally.
Verified empirically. Method 0 support is still required (another producer could
use it) but **nothing `buildArchive` emits will ever be method 0**, so no
downstream code may assume mixed methods appear in our own archives.

## Phase 2 — streaming archive build and upload

**2a. Provider interface** (`functions/src/providers/types.ts`), optional,
mirroring the `deleteFile` / `downloadFileBytes` convention:

```ts
// Uploads from a readable stream, for payloads too large to hold in memory.
// Required for any provider with a non-null maxFileCount.
writeStreamedFile?(
  auth: ResolvedAuth,
  container: ContainerRef,
  filename: string,
  body: NodeJS.ReadableStream,
  size: number,        // exact byte length; Zenodo's bucket PUT needs Content-Length
  meta: FileMeta
): Promise<WriteResult>;
```

Implement for Zenodo only. Same contract as `writeSessionFile`: same error
mapping, same `application/octet-stream` requirement (a real mimetype is a hard
415), same defensive read of `key`/`checksum` off the response.

**2b. Streaming builder**, in `functions/src/compaction.ts` alongside
`buildArchive`:

```ts
export async function buildArchiveToStorage(
  entries: AsyncIterable<{ path: string; content: Buffer }>,
  storagePath: string
): Promise<{ size: number; md5: string }>;
```

- Pipe `archiver` into `storage.bucket().file(storagePath).createWriteStream()`.
- Compute the md5 of the emitted bytes in-flight (hash a passthrough), so
  nothing has to be re-read to verify.
- Consume `entries` lazily — the caller downloads each member just in time, so
  at most one member is resident at a time.
- Byte-identical output to `buildArchive` for the same input, including the
  pinned entry dates that make archives reproducible.
- `buildArchive` stays as-is; small callers keep using it.

## Phase 3 — the finalization pass

`finalizeExperiment(experimentID)` in a new `functions/src/finalization.ts`.
Structurally `compactExperiment` with a different selection rule.

Order, and it is not negotiable — upload, verify, then delete, never the
reverse:

1. Acquire the **compaction lease** (`compaction.compactingUntil`). The write
   gate (`compaction-gate.ts`) already honors it, so submissions divert to the
   queue for free while this runs.
2. Refuse if already finalized.
3. List. Members are every batch archive, every loose session file, and
   `.psychds-ignore`. `dataset_description.json` is excluded.
4. Write a `finalization` record (status `uploading`, member hashes, expected
   md5) BEFORE uploading, so an interrupted run resumes rather than duplicating
   — same crash-safety hinge as `compactionBatches`.
5. Stream-build the merged archive to Cloud Storage: inflate each batch with
   `readArchive` and re-emit its entries at their recorded paths; add loose
   files at their reconstructed paths (`archivePathsFor`).
6. Upload via `writeStreamedFile`, verify the reported checksum against the
   md5 from step 5.
7. Seal any not-yet-sealed claims (loose files), then delete every member and
   the Cloud Storage temp object.
8. Mark the experiment finalized and stop accepting submissions.

**Timeout matters and decides the surface — and the first answer here was
wrong.** The spec originally said "HTTP endpoint, runs synchronously at 3600 s".
That does not work: every DataPipe endpoint is reached through a Firebase
Hosting rewrite (see `firebase.json`), and **hosting rewrites to functions have
a hard 60-second timeout**. The function would keep running while the client
got a 504, which for an irreversible operation is the worst possible UX. A
Firestore trigger is no better — event-triggered functions cap at 540 s.

So finalization is split in two:

- `apiFinalize` (`onRequest`, reached at `/api/finalize`) validates auth and
  ownership, runs the cheap pre-checks, **enqueues a Cloud Task, and returns
  202 immediately.** Well inside 60 s.
- A `onTaskDispatched` function runs `finalizeExperiment` with a long timeout.

Returning 202 and continuing work in the same invocation is NOT an option:
Cloud Functions throttles CPU after the response and may kill the instance, so
background work after responding is not guaranteed to finish.

The client polls the experiment document for progress. The Cloud Tasks emulator
runs as part of `firebase emulators:exec`, so this is testable locally.

## Phase 4 — endpoint and dashboard control

- `apiFinalize`, an `onRequest` function. Copy the auth shape from
  `api-queue-status.ts`: Bearer ID token, `auth.verifyIdToken`, then an owner
  check against the experiment document.
- Enqueues a Cloud Task and returns 202; `finalizeTask` (`onTaskDispatched`)
  runs the pass. See the corrected timeout discussion in Phase 3 — a synchronous
  endpoint 504s at the hosting layer after 60 s while continuing to run.
- **`onTaskDispatched` caps at 1800 s (30 min)**, not 3600 s; only
  `onRequest`/callable functions get 3600 s. Verified while building Phase 4.
- The client polls the experiment document (`finalization` state map) for
  progress.
- Dashboard control modelled on `components/dashboard/MetadataControl.js`, with
  an explicit confirmation step because it is irreversible.
- Submissions to a finalized experiment are rejected in `api-data.ts` and
  `api-base64.ts` with a new message in `api-messages.ts`.
- **`firestore.rules` — DONE.** The experiment update rule tolerated arbitrary
  extra fields, so a client could have cleared the finalized flag through the
  client SDK. `finalizationFieldsUntouched()` now blocks any client add, change
  or removal of `finalized`/`finalizedAt`/`finalization` on update, and
  `isCreatableProvider()` blocks them on create. Covered in
  `__tests__/firestore-rules.test.js`.

## Working notes for whoever implements this

- Tests import from the COMPILED output, so `npm run build --prefix functions`
  before running them.
- Run tests from the repo root, never from `functions/`:
  `firebase emulators:exec --project datapipe-test 'npx jest --ci <paths>'`
  Without `--project datapipe-test` every API test 404s.
- Fixed mock-server ports 3579-3583 are taken. Use 3584+.
- `node-fetch` is ESM-only and Jest's CJS transform cannot parse it. Suites that
  make no HTTP call stub it (`jest.mock("node-fetch", () => ({ __esModule: true,
  default: jest.fn() }))`); suites that need real requests alias it to Node's
  global fetch. See the top of `compaction-emulator.test.js` for both.
- Do not commit. Leave changes in the working tree.

## Deploy-time caveats — none of these can be verified by the emulator

- **Composite indexes.** `firestore.indexes.json` gained indexes for the
  compaction/finalization queries. The Firestore emulator does not enforce
  composite indexes, so the suite passes without them and only a deploy proves
  the query shapes match.
- **The Cloud Tasks queue.** `firebase deploy` provisions a queue for an
  `onTaskDispatched` function, but that has not been exercised here. Confirm
  `finalizetask`'s queue exists and that `apiFinalize` can enqueue to it in the
  deployed project.
- **The 30-minute task ceiling.** A study large enough to exceed
  `onTaskDispatched`'s 1800 s cap will have its task killed mid-pass. That is
  not data loss — the pass is crash-safe and resumes from its `finalizationRuns`
  record, and Cloud Tasks retries — but nobody has run a study big enough to
  observe it. Worth a deliberate large-study test before relying on it.
