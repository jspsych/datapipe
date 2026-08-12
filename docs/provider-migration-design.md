# Storage Provider Migration — Design Doc

## Background

DataPipe currently depends on the Open Science Framework (OSF) as its sole storage
backend: researchers OAuth2-link (or paste a PAT for) their own OSF account, and
DataPipe writes experiment session data and a Psych-DS metadata file directly into
an OSF project/component on their behalf. DataPipe never retains a copy of
submitted data itself.

This migration is driven by **deprecation/shutdown risk at OSF**, not cost or a
policy dispute. The goal is to decouple DataPipe from any single storage vendor by
introducing a pluggable storage-provider abstraction, and to ship initial support
for three concrete providers: **Google Drive, Figshare, and Dataverse**, alongside
OSF kept in place as a legacy adapter for existing connected users.

Migration tooling for moving existing OSF experiments or historical data to a
new provider is **deliberately out of scope**. If OSF shuts down, researchers
start new experiments on a new provider; the legacy adapter exists so nothing
breaks before that day, not as the first step of a rescue plan.

## Current OSF dependency (summary)

A full code-level audit found DataPipe's OSF dependency concentrated in a
identifiable set of modules, with a large amount of surrounding logic
(condition assignment, Psych-DS metadata generation/merge, token encryption,
CSRF/OAuth-state handling, and the GCS/Firestore retry-queue durability system)
already provider-agnostic and requiring no change. The OSF-specific surface:

- **OAuth2 flow**: `oauth2-callback.ts`, `oauth2-regenerate.ts`, `refresh-token.ts`,
  `resolve-token.ts`, `generate-oauth-state.ts`, plus a parallel static
  Personal-Access-Token path (`save-osf-token.ts`, `get-osf-token.ts`).
- **File writes**: `put-file-osf.ts`, `update-file-osf.ts`, `subfolder.ts` — built
  on OSF's Waterbutler API. (STALE as of 2026-07-26: 409 is no longer the sole
  collision-detection mechanism — the Firestore collision cache in
  `collision-cache.ts` is now the primary gate and 409 is a backstop, per the
  dual-run plan in "Collision detection" below.)
- **Metadata handling**: `metadata-block.ts`, `metadata-process.ts` — reconciles a
  mutable `dataset_description.json` file against a live provider-side folder
  listing on every update.
- **OSF concepts baked into the data model**: project + child "component",
  `osfstorage` as an implicit provider, 4 hardcoded OSF storage regions, OSF file
  IDs with an `osfstorage/` prefix.
- **Frontend**: `pages/admin/new.js` (OSF-shaped experiment creation form),
  `ExperimentInfo.js` (hardcoded `osf.io` links), `QueuePanel.js` (OSF status-code
  copy), all of `components/account/*`.
- **Config/rules**: OSF client ID/secret/redirect env vars, and `firestore.rules`
  hardcoding OSF-shaped field whitelists.

## Requirements for any replacement

1. OAuth2 delegated authorization with refresh-token rotation — researcher owns
   the account, DataPipe never holds a password, access must survive unattended
   for the life of a study (months). **Deliberately relaxed for Dataverse**,
   which only offers static API tokens: accepted because DataPipe already
   maintains an equivalent PAT path for OSF, but Dataverse tokens expire one
   year after creation (`generateApiTokenForUser(au, INTERVAL.YEARS, 1)`,
   verified live: a token created 2026-07-26 reports expiry 2027-07-26) —
   effectively fixed, no admin setting found that exposes a different
   lifetime — so the unattended-for-months constraint requires expiry-warning
   UX, not just token storage. The Dataverse UI never surfaces this expiry;
   only `GET /api/users/token` does, and DataPipe now reads it at connect
   time and warns again at experiment setup.
2. A file-write API that handles **binary media as well as text** — the
   `/api/base64` path (audio/video recordings) is in scope for all providers
   from day one, so per-provider file-size caps and quota behavior are launch
   constraints, not later work. (Atomic create-if-absent is a nice-to-have, not
   a hard requirement — see "Collision detection" below for why.)
3. Support for updating one mutable file per project (the metadata file).
4. Folder/path support, or a documented fallback when absent.
5. A "project + child container" shape, or a flat namespace DataPipe's model can
   be mapped onto.
6. Burst tolerance (a class of 30–100 students submitting within a minute).
7. Free-tier economics realistic for typical academic use, and — where possible —
   DOI/citation support, since that's part of DataPipe's pitch to researchers,
   not just plumbing.

## Providers evaluated and ruled out

- **GitHub** — technically the strongest fit (sha-gated Contents API naturally
  solves collision detection and mutable updates), but using a source-control
  platform as a silent, continuous data-dump backend runs against the spirit of
  the service even though no explicit ToS clause forbids it, and there's no
  precedent either way for this exact usage pattern. Ruled out on those grounds
  rather than a technical one.
- **Zenodo — NO LONGER RULED OUT (2026-07-27). Adapter built; spike PASSED all
  five gates live 2026-08-11; see "Zenodo adapter" below.** The original
  dismissal put Zenodo in the curate-once-publish-once
  category, which was wrong on the facts (verified 2026-07-26): Zenodo drafts DO
  accept incremental file writes over the API with no documented time limit on
  how long a draft may stay unpublished, and published records stay editable for
  30 days plus DOI versioning after that. That left the per-record cap of
  **100 files / 50 GB** (200 GB by one-time exception) as the only real blocker
  — a size limit, not a workflow mismatch. That cap is now addressed by
  end-of-study archive compaction rather than treated as disqualifying, so the
  earlier conclusion is withdrawn along with its reasoning.
- **Figshare (as archival), Harvard Dataverse, ICPSR, Dryad, Databrary,
  DANS** — the "research-data-specific repository" category is largely built
  around a curate-once-publish-once-mint-a-DOI workflow, mismatched
  to DataPipe's hundreds-of-small-incremental-writes-over-months pattern —
  confirmed across every Dataverse-software installation (Harvard, Borealis,
  DataverseNL, DataverseNO, DANS all share the same open-source codebase, same
  static-token-only auth, same silent-rename-on-duplicate-filename behavior).
  ICPSR has no automated DEPOSIT API (it does publish a read-only Metadata
  Export API for searching/exporting study metadata — verified 2026-07-26, so
  the earlier "no automated API at all" was wrong as stated; deposit itself is
  web-form only). Dryad supports incremental draft writes but
  only via a shared service-account grant (no per-researcher OAuth consent) and
  charges a tiered publishing fee (verified 2026-07-26: $150 for ≤5 GB, $180 for ≤10 GB, $520 for ≤50 GB, up to $6.08/GB beyond; waivers are not approved above 10 GB) — the earlier flat "$150/dataset" understated it. Databrary is architecturally a gated,
  human-reviewed video library, not a general write target.
- **Box, Amazon S3, Dropbox, Microsoft OneDrive/Graph** — all technically solid,
  generic-storage options with no platform-fit ambiguity. Box offers a real
  conditional-write guarantee (If-Match, 412 on mismatch) across a wide range of
  operations and is already common at universities — though the earlier claim
  that it was the *strongest of anything evaluated* does not survive checking:
  S3 added ETag-based conditional writes (If-Match/If-None-Match on PutObject
  and CompleteMultipartUpload) in November 2024, so the two are comparable and
  Box's advantage is breadth of operation types, not strength (verified
  2026-07-26); S3 has the best region control and longest clean API history but
  breaks OAuth-onboarding simplicity (self-provisioned IAM). These remain
  reasonable fallback options but were not selected as the initial three.
  **Box is the pre-approved substitute**: if a conditional provider fails its
  gating spike (below), Box takes its slot without re-opening the full
  evaluation.

**Selected for initial implementation: Google Drive, Figshare, Dataverse** —
but the three are not equally confident picks. Google Drive is a comfortable
technical fit. Figshare and Dataverse come from the repository category ruled
out above; they are selected *despite* that structural mismatch because
DOI/citation support and research-repository identity are part of DataPipe's
pitch to researchers (requirement 7), and their selection is **conditional**:
each must pass its gating spike (see "Gating spikes" below) before its adapter
is built, with Box as the named substitute if it fails. If both fail, the
initial lineup is Drive + Box.

OSF is retained as a legacy adapter — existing connected users and in-flight
studies keep working unmodified; new experiments default to one of the new
providers.

## Architecture

### Provider interface

```
StorageProvider {
  id: 'osf' | 'gdrive' | 'figshare' | 'dataverse'
  authMethod: 'oauth2' | 'static-token'

  // auth
  getAuthUrl(state) / exchangeCode(code) / refreshToken(rt)   // oauth2
  validateStaticToken(token)                                   // static-token

  // one-time setup at experiment creation
  createDataContainer(auth, researcherInput) -> containerRef   // opaque, provider-shaped

  // ongoing writes — `data` may be binary (base64/media path), with declared
  // size and content type so adapters can enforce provider size caps up front
  writeSessionFile(auth, containerRef, filename, data, {size, contentType}) -> WriteResult
  updateFile(auth, containerRef, existingFileRef, data, {size, contentType}) -> WriteResult

  // needed for collision-cache rehydration (see below) and dashboard file counts
  listFiles(auth, containerRef) -> FileRef[]

  capabilities: { nativeSubfolders: bool, supportsRegion: bool,
                  maxFileSizeBytes: number | null, quotaNote: string | null }
}

WriteResult {
  fileRef,           // provider-shaped id/path/rev
  storedFilename,    // the filename the provider REPORTS having stored — not
                     // the one requested; detecting Dataverse's silent rename
                     // depends on comparing the two
  bytesWritten,
}
```

`capabilities` is descriptive (UI hints, subfolder fallback behavior, size-cap
warnings), not a correctness gate — provider-side atomicity is no longer
load-bearing (see below). Note one contract caveat: Figshare has no in-place
file update, so its `updateFile` is implemented as delete + re-upload and is
**non-atomic** — there is a brief window where the metadata file does not exist
in the article. Callers of `updateFile` must tolerate that.

### Collision detection: a cache, not a new system of record

None of the three selected providers offer OSF's atomic `409`-on-duplicate
behavior (Drive allows same-name files silently, Dataverse silently renames,
Figshare's behavior is unconfirmed). Rather than build three different
reliability models behind one interface, collision detection moves entirely into
Firestore, decoupled from the provider:

- Before any provider write, atomically claim `(experimentId, filenameHash)` in a
  Firestore transaction. A failed claim means "duplicate filename" — no
  provider round-trip needed to know that.
- **Claims have a lifecycle, not just existence.** A claim is written as
  `pending` with an idempotency token owned by the submitting request, and
  flipped to `confirmed` only after the provider write succeeds. The upload
  retry queue (`queue-upload.ts` / `scheduled-upload-retry.ts`) re-enters its
  own `pending` claim by token rather than being rejected as a duplicate of
  itself; a terminally failed write releases its claim (or a new request
  bearing no token may overwrite a stale `pending` claim past a timeout).
  Without this, a failed provider write orphans the claim and a legitimate
  resubmission of that filename is blocked until TTL expiry (~90 days).
- **Retention-safe by design**: the claim stores a *salted hash* of the filename
  (salt is per-experiment, generated once, kept indefinitely — a nonce, not
  "file information"), never the raw filename. This keeps the "we don't retain
  your file information" promise intact.
- **Cost-bounded by design**: claim records carry a TTL and expire after an
  experiment goes inactive (proposed: ~90 days with no new submissions), so
  storage stays bounded to currently-active studies rather than growing forever
  across DataPipe's entire history.
- **Nothing is actually lost on expiry.** The claim-set is a cache over the
  provider's own file listing, which remains the durable source of truth. If a
  researcher resumes data collection on an experiment whose claim-set has
  expired, DataPipe detects the cold cache, calls the adapter's `listFiles`
  against the live container, hashes each returned filename with the
  experiment's (permanently retained) salt, bulk-writes fresh claims with a new
  TTL, then proceeds with the normal claim-and-write for the incoming
  submission. This only costs anything for experiments that actually get
  reactivated — the common case (experiment finishes, goes cold, stays cold)
  never pays the rehydration cost.
- Edge cases to handle explicitly: rehydration needs a **per-experiment lock**
  — concurrent submissions arriving at a cold cache must wait/retry against a
  single in-flight rehydration rather than each triggering their own
  `listFiles` + bulk claim-write; rehydration should fail loudly (prompt the
  researcher to reconnect) if the provider container is missing or access was
  revoked, rather than silently accepting duplicates; large containers need
  paginated listing.
- **Validation before it matters**: while OSF is still the only provider
  (build step 3), dual-run — keep OSF's `409` response as a backstop and log
  any disagreement between it and the Firestore cache. That checks the cache
  against production ground truth for free, before any provider that *has* no
  backstop ships.

This also incidentally resolves a latent bug in the current OSF code, where
`metadata-block.ts` checks for a success status code (`210`) that
`putFileOSF` never actually returns — that check disappears along with the
code path it lives in.

### Metadata-file tracking

Store the provider-returned file ref (id/path/rev) on the experiment's Firestore
`metadata/{experimentID}` doc after first creation. Every later update reads
that ref back directly — no more per-adapter "list the folder and look for a
matching name" logic, which today only exists because OSF is queried as the
live source of truth for this check.

### Data model

```
experiments/{id}: {
  storageProvider: 'gdrive' | 'figshare' | 'dataverse' | 'osf',   // 'osf' = legacy
  providerContainer: { ...shape varies by storageProvider... },
  metadataFileRef: {...} | null,
  collisionCache: { salt, warmUntil: Timestamp },
}

users/{uid}: {
  connectedAccounts: {
    gdrive?:    { authMethod: 'oauth2', encryptedToken, encryptedRefreshToken, tokenExpiresAt, providerAccountId },
    figshare?:  { authMethod: 'oauth2', ...same shape... },
    dataverse?: { authMethod: 'static-token', encryptedToken, serverUrl,
                  tokenExpiresAt },   // Dataverse tokens expire (~yearly) — needed for expiry-warning UX
  }
}
```

`crypto-utils.ts` (AES-256-GCM — confirmed still accurate) carries over
unchanged. `generate-oauth-state.ts` did NOT: it is now provider-aware (it
takes an optional `provider` and returns an `authorizeUrl`), so the original
"carry over unchanged" no longer holds for it.

### Per-provider adapter notes

| | Google Drive | Figshare | Dataverse |
|---|---|---|---|
| Auth | OAuth2, `drive.file` scope | OAuth2, `authorization_code` + `refresh_token` | Static API token — same shape as today's OSF PAT fallback (`usingPersonalToken`) |
| Auth longevity | Refresh tokens are revoked after ~6 months of disuse — paused studies need reconnect UX. App must reach **published** OAuth verification status: testing mode means 7-day refresh tokens and a 100-user cap (both verified 2026-07-26; the 7-day rule exempts apps requesting only name/email/profile, which does not help us since we need `drive.file`). Note in our favour: `drive.file` is classified non-sensitive and needs only **basic** OAuth verification — the restricted-scope security assessment that `drive`/`drive.readonly` trigger does not apply | Long-lived; confirm rotation/expiry behavior in the spike | Tokens **expire one year after creation**, effectively fixed — no admin setting found that exposes a different lifetime (confirmed via `generateApiTokenForUser(au, INTERVAL.YEARS, 1)`; a search of `SettingsServiceBean`'s key enum found only `MinutesUntilConfirmEmailTokenExpires`, which is email confirmation, not API tokens). The Dataverse UI does not surface this expiry at all — only `GET /api/users/token` does, which DataPipe now reads at connect time and warns on again at experiment setup — needs expiry-warning UX, not just storage |
| Container | **App-created "DataPipe" folder at Drive root.** Under `drive.file` the app can only touch files it created or the user explicitly picked — a researcher-picked parent would force a Google Picker frontend integration for little gain. Revisit only if researchers demand placement control | Article inside a Project (two levels — no recursive project nesting); Collections are a parallel top-level container that can also hold Articles via API | Dataset inside a Collection |
| Subfolders | Native | Folder hierarchies ARE supported via the API, preserved up to 10 levels (verified 2026-07-26 — the earlier "None" was wrong). But the File object exposes only a flat `name` with no `directoryLabel`-equivalent, so the exact encoding is UNVERIFIED and a filename-prefix fallback may still be what we implement | Native via `directoryLabel` |
| Media / size limits | Free quota is 15 GB **shared with Gmail/Photos** — quota exhaustion is an expected support scenario for audio/video studies, not an edge case. WATCH ITEM (unverified, secondary reporting only, 2026-07-26): new Google accounts may now start at 5 GB until a phone number is linked. Worth confirming against a primary source before launch, since it would make quota exhaustion more likely, not less | Free tier is **20 GB total / 20 GB per file**, plus hard caps of **500 files per item, 500 items, 50 versions per item** (all current documented limits, verified 2026-07-26). Upload is always a multi-step flow (initiate → parts → complete) with **no single-request path even for small files**, so each session file costs ~4 API calls; no in-place content update (delete + re-upload). Figshare documents **no automatic rate limiting** but asks clients to stay under **1 request/second** and reserves the right to throttle or block, with no documented 429 — see the burst risk below | Per-installation size caps (federation → varies); CSV uploads are **"ingested"** into archival `.tab` format unless suppressed via `tabIngest`, which requires **Dataverse >= 5.11** (released 2022-06-13); older installations silently ignore it. The adapter's `setupWarnings` checks `/api/info/version` and warns at experiment setup |
| Federation | Single global service | Single global service | **Federated** — Harvard, Borealis, DataverseNL, etc. are different servers; `serverUrl` must be stored per researcher, and DataPipe integrates whatever software version each installation runs (version drift is a permanent fact of this adapter) |
| DOI/publish | N/A | Publishing an Article snapshots it | Dataset publish bumps a major version — dataset should stay in **draft indefinitely**; publish (and DOI mint) becomes a manual researcher action at study completion, not something DataPipe triggers |
| Gating spike | None (comfortable fit) — but OAuth app verification has **weeks of lead time**; start it at build step 0 | See "Gating spikes" below. Two of these are now DOCUMENTED rather than speculative (verified 2026-07-26): the **500-files-per-item cap** is a current stated limit, not a historical approximation; and Figshare's **1 request/second** guidance is in direct tension with requirement 6 (30–100 submissions/minute), since the mandatory multi-step upload makes each session file ~4 requests — a 30-student burst is ~120 requests/minute. Duplicate-filename behavior remains completely undocumented | See "Gating spikes" below — **dataset locking under concurrent adds** (most likely disqualifier in the plan), tabular-ingest suppression, silent-rename response shape |

### Zenodo adapter (added 2026-07-27)

Implemented in `functions/src/providers/zenodo.ts`. Static-token auth, not
federated (allowlisted to `zenodo.org` / `sandbox.zenodo.org` in the adapter —
the researcher never types a server URL, and `lib/provider-config.js` supplies
the fixed one that `connectstatictokenprovider` still requires).

**API generation.** Zenodo now runs on InvenioRDM and both API generations are
live — verified 2026-07-27: `GET /api/deposit/depositions` → 403 (exists,
needs auth), `GET /api/records` → 200. The adapter targets the **legacy deposit
API plus its bucket endpoint**, because (a) it is what Zenodo's own developer
documentation describes, and (b) a bucket `PUT` is **one** request per session
file where the InvenioRDM-native flow is three (init → content → commit).
Against Zenodo's documented 100 requests/minute for authenticated users that is
~100 vs ~33 sessions/minute of first-try throughput, and 100/minute is
requirement 6. The risk accepted: the legacy API is a compatibility layer that
could be retired, so every HTTP call goes through helpers rather than being
inlined, keeping a future migration contained.

**Rate limits** are 100 req/min and 5000 req/hour authenticated (60/2000
guest) — comfortably above the burst profile, unlike Figshare's 1 req/sec.

**`updateFile` is a single overwriting PUT.** It was written as delete-then-PUT
while the overwrite semantics were undocumented; gate A settled it live and the
delete is gone. Zenodo is therefore the only non-OSF provider whose metadata
update is **atomic** — Dataverse and Figshare still carry the delete-then-write
window.

**The 100-file cap is handled by end-of-study compaction, not rollover.**
Chosen because the goal is a clean *published* artifact, and record rollover
would split one experiment across several depositions — exactly the structure
being avoided. During collection, sessions are written as individual files
(researchers can preview and spot-check a single session; a growing archive
would make that require downloading everything). Compaction into batch zips
happens in a background job only as needed to stay under the cap. At
finalization a single merge produces one archive plus a loose
`dataset_description.json`, and only then are the parts deleted — upload,
verify the returned md5, *then* delete, never the reverse.

Rejected alternative: rebuilding the archive on every submission (or every
batch). It turns each write into a read-modify-write on one object with no
provider-side arbitration — Zenodo offers no conditional write — so concurrent
submissions silently lose data rather than being rejected the way Dataverse's
lock rejects them. It also costs O(n²) transfer and rewrites already-collected
data repeatedly, which for a tool that retains no copy means every rewrite is
an unrecoverable-loss opportunity. Sealed archives are written once and never
touched again.

**Finalization needs no server-side zip code**: published records expose
`links.archive` → `/api/records/{id}/files-archive`, and gate D confirmed the
**draft** equivalent (`/api/records/{id}/draft/files-archive`) returns a
`application/zip` on an unpublished deposition. Bulk download works throughout
collection, not only after publication.

### Zenodo spike — RESULT: PASS (live, sandbox.zenodo.org, 2026-08-11)

`scripts/zenodo-spike.mjs`, driving the real compiled adapter. **All five gates
pass.** Zenodo is the first provider to clear its spike outright — Dataverse
needed its verdict revised to CONDITIONAL PASS after failing gate A.

| Gate | Result |
|---|---|
| A. bucket PUT overwrites an existing key | **PASS** — replaced in place, one listing entry |
| B. slashed keys | **PASS after redesign** — see below |
| C. 12 concurrent writes to one deposition | **PASS** — 12/12 accepted, 12/12 listed, 1.25 s |
| D. `files-archive` on an unpublished draft | **PASS** — 200 `application/zip` |
| E. behavior at the 101st file | **PASS after fix** — 400, now mapped `QUOTA_EXCEEDED` |

**Gate C is the headline.** This is the gate Dataverse failed: Dataverse accepts
exactly one concurrent write per dataset and 400s the rest. Zenodo's bucket is
object storage and took all 12 without complaint, so the fast-retry contention
tier added for Dataverse (`ff5d805`) is not load-bearing here.

**Gate B was answered "no", and the adapter changed rather than the verdict.**
Zenodo's keyspace is **flat**; a slash cannot be stored by any route:

- bucket PUT with literal slashes → **404** (addresses a bucket path that does not exist)
- bucket PUT with the key `%2F`-encoded → **404** (the router decodes it back before matching)
- legacy multipart POST with `name="data/raw/probe.json"` → **201, stored as `data_raw_probe.json`**

That third case is the dangerous one and is the reason this endpoint was not
chosen: a silent server-side rename, with a success status, against a collision
cache that matches names **exactly** — precisely the failure mode of Dataverse's
dropped `directoryLabel`. The adapter now flattens `[/\\]+` → `_` up front
(`toZenodoKey`) so the name it reports is the name Zenodo holds, and
`storedFilename` is still read back off the response rather than assumed.

**Consequence: the Psych-DS directory layout cannot be represented in Zenodo
file keys.** This is not hypothetical — `metadataActive` experiments upload to
`data/raw/<name>` and `data/<base>_data.csv` (`metadata-derived-files.ts`), so
every metadata-enabled Zenodo experiment hits this path. Live keys will read
`data_raw_subject-1.json`. The real structure is preserved **inside the
compaction archive**, where the paths are ours to choose and Psych-DS validity
can be maintained. Open decision: whether flat live keys are acceptable given
the archive carries the true structure (see Open questions).

**Two adapter bugs were found only because the spike drives the real adapter**,
not a hand-written request:

1. `Content-Type: <real mimetype>` on the bucket PUT → hard **415**; the endpoint
   accepts `application/octet-stream` and nothing else. Every write failed.
2. `encodeKey` encoded path segments separately, preserving literal slashes → 404.

Both were mapped to `UNAVAILABLE`, i.e. the queue would have retried a
permanently broken request forever. Gate E surfaced a third of the same kind:
the cap message is *"Uploading selected files will result in exceeding the max
amount per record."* — `exceeding`, not `exceeds`, which the original pattern
missed, so a full record read as a transient outage. All three are fixed and
regression-tested (`providers-zenodo.test.js`, 45 tests).

### OAuth generalization

Replace today's 4–5 near-duplicated OSF-auth-URL-building blocks and single
OSF-hardcoded `oauth2-callback` function with a small provider registry
(`{authorizeUrl, tokenUrl, clientId, clientSecret, scope}` per provider) and one
generic callback function parameterized by a `provider` field carried in the
existing CSRF state payload.

The generalization also covers the OSF-shaped background jobs:

- `scheduled-token-refresh.ts` becomes per-provider — each OAuth2 provider gets
  its own refresh cadence, and Dataverse (no refresh token to rotate) gets an
  **expiry-warning** job instead, emailing/flagging the researcher before the
  static token lapses mid-study.
- `on-user-deleted.ts` cleanup iterates the `connectedAccounts.*` map rather
  than assuming a single OSF token shape.

### Frontend changes

- `admin/new.js`: provider selector + provider-specific sub-form.
- `account/*`: collapse per-provider components (`SignUpWithOSF`, `OSFToken`,
  `OAuthTokenStatus`, etc.) into one generic connect-button + token-status
  component, parameterized by a small per-provider config (name, icon, docs
  link).
- `ExperimentInfo.js` / `QueuePanel.js`: replace hardcoded OSF links and OSF
  status-code copy with a generic error taxonomy (`RATE_LIMITED`,
  `AUTH_EXPIRED`, `NAME_CONFLICT`, `QUOTA_EXCEEDED`, `UNAVAILABLE`) that each
  adapter maps its own provider's errors into. With media in scope from day
  one, `QUOTA_EXCEEDED` (storage full / file too large) is the most likely
  researcher-visible failure and needs first-class copy, not a generic error.
- `firestore.rules`: generalize the field whitelist to the `connectedAccounts.*`
  shape; the experiment `hasAll` check becomes conditional on `storageProvider`.

## Build sequence

0. **Register provider OAuth apps and start Google's verification process
   immediately** — publication/brand verification has weeks of lead time, and
   until it completes, Drive refresh tokens last 7 days and the app is capped
   at 100 users. This runs in parallel with everything below.
1. Define the provider interface + registry + additive Firestore schema (no
   behavior change yet).
2. Refactor existing OSF code into an OSF adapter implementing the new
   interface — pure refactor, proves the abstraction before adding anything new.
3. Land the Firestore collision-cache (salted hash + claim lifecycle + TTL +
   lazy rehydration) and metadata-ref tracking for the OSF adapter first, while
   there's still only one provider to reason about. **Dual-run**: keep OSF's
   `409` as a backstop and log cache/backstop disagreements as free production
   validation.
4. Google Drive adapter (simplest OAuth2, most rate-limit headroom, proves the
   multi-provider auth flow end-to-end).
5. **Gate: Figshare spike** (see below). Pass → Figshare adapter. Fail → Box
   adapter takes the slot.
6. **Gate: Dataverse spike** (see below). Pass → Dataverse adapter
   (static-token path, "stays in draft" publish workflow). Fail → Box (or, if
   Box already replaced Figshare, ship two providers and revisit).
7. Frontend: provider selection UI, generalized connect/status components,
   generalized dashboard links and error copy.
8. FAQ/docs, `firestore.rules`, env config for new provider client
   IDs/secrets.

## Testing strategy

- Extend `mock-server.ts` per provider and mirror the existing emulator-based
  test suite (`__tests__/*-emulator.test.js`) for each adapter — same coverage
  bar as the OSF path has today, including the base64/media path.
- Live smoke checks: `demo.dataverse.org` for Dataverse; Figshare has no real
  sandbox, so a dedicated throwaway account; a dedicated test Google account
  for Drive.
- Spikes run against real services with throwaway accounts; their findings get
  recorded back into this doc (adapter-notes table) when complete.

## Gating spikes (go/no-go before the adapter is built)

These are decision gates, not confirmations. Each has a named disqualification
criterion and Box is the pre-approved substitute — a failed spike swaps the
provider, it does not trigger a redesign.

- **Dataverse — concurrent-write locking.** Dataverse locks a dataset during
  file add/ingest, and concurrent adds to a locked dataset fail. The burst
  requirement writes 30–100 files to *one* dataset within a minute; the retry
  queue softens this, but if the spike shows writes serialize through a lock at
  a rate that can't absorb a class section, that is disqualifying. This is the
  single most likely spike to fail in the plan.
- **Dataverse — tabular ingest.** RESOLVED. `tabIngest` was added in
  Dataverse **5.11** (released 2022-06-13, per its release notes: "Tabular
  ingest can be skipped via API. Issue #8525, PR #8532"). Below that the
  parameter is silently ignored. Since federation means DataPipe doesn't
  choose the version, `dataverseProvider.setupWarnings` reads
  `/api/info/version` and warns the researcher at experiment setup rather
  than leaving it as a docs caveat. Version parsing must stay lenient: real
  installations report `6.11` (demo), `6.10.1` (Harvard) and `v6.8.2-SP`
  (Borealis) — a leading `v` and arbitrary suffixes both occur.
- **Dataverse — silent rename.** Confirm the exact response shape on a
  duplicate filename so DataPipe compares `storedFilename` against the request
  rather than trusting it blindly.
- **Figshare — duplicate filename behavior.** Docs are silent; verify
  empirically.
- **Figshare — per-item file-count cap.** Historically ~500 files/item; a
  semester of sessions can exceed it. Determine the real limit and whether
  article-rollover (a new article per N files) is acceptable; if the cap is low
  and rollover unacceptable, that is disqualifying.
- **Figshare — multipart upload under burst.** The initiate → parts → complete
  flow has more failure modes than a single PUT; verify behavior under
  concurrent submissions, including media-sized files.

### Dataverse spike — RESULT: CONDITIONAL PASS (revised 2026-07-26)

**Revised verdict, after fixing the retry tier.** The original FAIL below
measured the wrong thing: it assumed 30 *simultaneous* writes, which is not
how a class submits. Re-run with realistic random arrivals — 30 submissions
across 60 seconds, the worst realistic case — against demo.dataverse.org:

- **21/30 succeeded on the first attempt**
- **9 collided, all 9 correctly mapped to `CONTENTION`**, 0 other failures

A 30% collision rate, all of it transient and now on a 60-second retry tier
(`ff5d805`), so the whole cohort lands inside ~2 minutes. Nine items is well
under the worker's 25-per-run limit, so they drain in a single pass.
Collisions fall off sharply as the window widens (~6% over 5 minutes, ~3%
over 10).

So Dataverse's concurrency-1 limit is a real constraint but not a
disqualifying one: sequential throughput (~100 files/minute) comfortably
exceeds the requirement, and the fast retry tier absorbs the contention.
The condition is that tier — without it, collided submissions waited 1–2
hours.

Still open: these numbers come from demo.dataverse.org, so a burst run
against a real institutional installation is worth doing before launch —
`scripts/dataverse-spike.mjs` takes `DATAVERSE_SERVER`. The ingest-version
question is no longer part of that: `tabIngest` needs Dataverse >= 5.11 and
the adapter now checks and warns at setup (demo 6.11, Harvard 6.10.1 and
Borealis v6.8.2-SP all clear it comfortably).

The original analysis follows, kept because the concurrency measurements and
the API corrections in it remain accurate — only the verdict changed.

### Original assessment — GATE A FAILED (live, demo.dataverse.org, 2026-07-26)

Run with `scripts/dataverse-spike.mjs` plus targeted follow-ups, against
demo.dataverse.org using the real adapter.

**Gate A (concurrent-write locking): FAILED.** Exactly ONE concurrent write to
a dataset succeeds; every other in-flight write is rejected. This is not a
degradation curve — there is no safe concurrency above 1:

| concurrent writes to one dataset (distinct content) | succeeded |
|---|---|
| 2 | 1 |
| 3 | 1 |
| 4 | 1 |
| 6 | 1 |
| 12 | 1 |
| 30 | 2 |

Sequential writes are flawless (8/8) at ~600 ms each, so a dataset absorbs
~100 files/minute *if strictly serialized*. Rejections come back in ~250 ms as
a generic **400 `Failed to add file to dataset.`** — NOT the 403 `dataset
lock` the design anticipated. The speed and the failure at concurrency 2 both
point at optimistic-locking on the dataset version, i.e. architectural rather
than demo being underpowered.

Against the stated criterion — "if the spike shows writes serialize through a
lock at a rate that can't absorb a class section, that is disqualifying" —
this fails: writes don't merely serialize, concurrent ones outright fail.

Not data loss: the 400 maps to `UNAVAILABLE`, which the upload queue retries.
But a 30-person section would push ~29 submissions into the retry queue to
drain serially against a 1-minute backoff, making the queue the primary write
path rather than the exception.

**Also found: Dataverse rejects duplicate CONTENT, not just duplicate names.**
Re-uploading a byte-identical file draws `This file has the same content as
X that is in the dataset.` Under a *different* filename it is accepted with
that text as a warning (200); under the same name it is a 400. DataPipe's
filenames are unique per session, so this is survivable — but it is a real
provider behavior nobody had documented, and it confounded the first spike run
(the script reused one payload, so lock failures and dedup failures were
indistinguishable). `scripts/dataverse-spike.mjs` now sends distinct content
per burst file.

**Gates B and C passed.** `tabIngest=false` was honored (CSV stored as
`text/csv`, not ingested to `.tab`). Duplicate names are silently renamed
(`dupe.json` → `dupe-1.json`) and the adapter reads the stored name back
correctly. `updateFile`'s DELETE + re-add also works on a draft.

**Corrections to the API contract, both live-verified:** dataset creation
returns **201**, not the documented 200 (this threw on every real create until
fixed); `/add` returns **200**, not the documented 201. The published guides
are wrong in both directions.

Options, in the order they should be considered: (1) take the design's
pre-approved path and swap Dataverse for Box; (2) re-run against a production
institutional installation before deciding — cheap, and the one thing that
could overturn this, though the concurrency-2 failure suggests it will not;
(3) keep Dataverse but serialize writes per dataset, which needs a distributed
single-writer lock across Cloud Functions instances (Firestore-based), caps an
experiment at ~100 submissions/minute, and is real architecture, not a tweak.

### Earlier source-verified findings (superseded in part by the live run above)

Recorded 2026-07-25 alongside the Dataverse adapter (backend only, not
exposed). These come from reading Dataverse's Java source and its IQSS
integration tests, **not** from running the spike against a live
installation. They narrow the gates but do not close them — the live
`demo.dataverse.org` run described above is still required, especially for
locking under real burst load.

- **Concurrent-write locking — looks substantially less dangerous than
  assumed.** `UpdateDatasetVersionCommand` → `checkUpdateDatasetVersionLock`
  explicitly *exempts* `Ingest` locks: `hasAtLeastOneLockThatIsNotAnIngestLock`
  gates the block, so a file landing while another file is mid-tabular-ingest
  is generally allowed. Only non-Ingest locks (`EditInProgress`, `Workflow`,
  `DcmUpload`, `GlobusUpload`, `finalizePublication`) reject, and they return
  **HTTP 403** with `Dataset cannot be edited due to dataset lock.` — not the
  409 the design assumed. Since we send `tabIngest=false`, ingest locks should
  rarely arise at all. **This was named the most likely disqualifier; the
  source suggests it probably is not.** Still needs empirical confirmation at
  30–100 writes/minute.
- **Tabular ingest — suppressible, and we suppress it.** `tabIngest` defaults
  to `true` (`OptionalFileParams.java`), so the adapter sends `"false"` on
  every upload. Version-dependence across installations remains unverified.
- **Silent rename — confirmed, and handled.** IQSS's `DuplicateFilesIT`
  asserts a second `README.md` comes back as `README-1.md`. The adapter reads
  `storedFilename` from `data.files[0].label` and never assumes it matches the
  request. Dataverse cannot return a NAME_CONFLICT, so the Firestore collision
  cache is the only duplicate gate for Dataverse experiments.

Two contract details worth carrying forward, both of which contradict the
published guides:

- `/add` returns **200**, not the documented 201.
- `/api/files/{id}/replace` is **unavailable on a never-published draft**, and
  this design keeps datasets in draft indefinitely — so `updateFile` is
  DELETE + re-add, non-atomic, exactly the caveat already recorded for
  Figshare. `DELETE /api/files/{id}` physically deletes while unpublished.

Also note for the federated `serverUrl` open question below: because the
researcher supplies that URL and the backend then makes authenticated
requests to it, it is an SSRF surface. `connect-provider.ts`'s
`isAllowedServerUrl` constrains it (https, no credentials, no odd ports, no IP
literals, no internal/metadata hostnames) — defense in depth only, since a DNS
name can still resolve internally.

## Deployment checklist (gdrive launch)

Accumulated from build steps 1–7; everything below is required before the
Google Drive provider is announced:

1. **Google OAuth app** (step 0): register the OAuth client (drive.file
   scope), set the consent screen, and complete Google's verification to
   published status — until then refresh tokens last 7 days and the app is
   capped at 100 users. Weeks of lead time.
2. **Functions env**: `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`,
   `GDRIVE_REDIRECT_URI` (must point at `https://pipe.jspsych.org/oauth2/connect`).
   `GDRIVE_API_BASE`/`GDRIVE_TOKEN_URL`/`GDRIVE_AUTHORIZE_URL` default to
   the real Google endpoints and need no production values.
3. **Firestore TTL policy** on `filenameClaims` `expiresAt` field
   (console/gcloud). Cost-boundedness only — correctness never depends on
   it.
4. **Firestore index**: the scheduled gdrive refresh queries
   `connectedAccounts.gdrive.tokenExpiresAt` — confirm the single-field
   index exists in production (auto-indexing normally covers it; the
   emulator does not prove it).
5. **FAQ / user docs**: announce Drive support, its quota caveat (15 GB
   shared with Gmail/Photos), and the app-created "DataPipe" folder
   behavior. Copy deliberately not drafted by the migration — researcher-
   facing wording is an editorial decision.
6. **Deploy order**: functions + rules + hosting can ship together; the
   collision cache dual-runs against OSF's 409 for legacy experiments, so
   no data migration or flag-flip is needed.

## Open questions

- **Test-suite hazard (pre-existing, discovered during step 4b)**: the OSF
  token-refresh path has no URL override (unlike GDRIVE_TOKEN_URL), so an
  emulator test that seeds a refresh-due OSF user makes a REAL network call
  to production accounts.osf.io using the credentials in functions/.env.
  The scheduled-refresh regression test deliberately pins a network-free
  path because of this. Fix: introduce an OSF_TOKEN_URL override mirroring
  the gdrive pattern, then pin the live-refresh branch properly.
- Decide the exact collision-cache TTL window (90 days proposed, not yet
  validated against real usage patterns).
- Decide the UX for Dataverse's federated `serverUrl` requirement (does
  DataPipe maintain a picker of known installations, or require researchers to
  paste their institution's Dataverse URL?).
- Do researchers need placement control for the Drive folder strongly enough
  to justify a Google Picker integration, or is the app-created root folder
  acceptable? (Default answer: root folder; revisit on demand.)
- **Zenodo's flat keyspace vs. Psych-DS (raised 2026-08-11, needs a decision).**
  Zenodo cannot store a slash in a file key, so a `metadataActive` experiment's
  live deposition shows `data_raw_subject-1.json` rather than
  `data/raw/subject-1.json`, and is not a valid Psych-DS component while
  collection is in progress. Three options: (a) accept it, and let the
  compaction archive carry the real Psych-DS tree — cheapest, and the archive is
  the artifact researchers actually cite; (b) suppress the derived Psych-DS
  files on Zenodo and generate them only into the archive; (c) treat Zenodo as
  unsupported for `metadataActive` experiments. (a) is the working assumption
  and what the code does today.
