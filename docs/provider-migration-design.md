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
  on OSF's Waterbutler API, and explicitly relying on OSF's `409 Conflict` response
  as the sole collision-detection mechanism for per-session data files.
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
   for the life of a study (months).
2. A file-write API (atomic create-if-absent is a nice-to-have, not a hard
   requirement — see "Collision detection" below for why).
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
- **Zenodo, Figshare (as archival), Harvard Dataverse, ICPSR, Dryad, Databrary,
  DANS** — the entire "research-data-specific repository" category is built
  around a curate-once-publish-once-mint-a-DOI workflow, structurally mismatched
  to DataPipe's hundreds-of-small-incremental-writes-over-months pattern. This
  turned out to be a category-wide limitation, not specific to any one vendor —
  confirmed across every Dataverse-software installation (Harvard, Borealis,
  DataverseNL, DataverseNO, DANS all share the same open-source codebase, same
  static-token-only auth, same silent-rename-on-duplicate-filename behavior).
  ICPSR has no automated API at all. Dryad supports incremental draft writes but
  only via a shared service-account grant (no per-researcher OAuth consent) and
  charges a $150/dataset publishing fee. Databrary is architecturally a gated,
  human-reviewed video library, not a general write target.
- **Box, Amazon S3, Dropbox, Microsoft OneDrive/Graph** — all technically solid,
  generic-storage options with no platform-fit ambiguity. Box has the strongest
  native atomic-write guarantee of anything evaluated and is already common at
  universities; S3 has the best region control and longest clean API history but
  breaks OAuth-onboarding simplicity (self-provisioned IAM). These remain
  reasonable fallback options but were not selected as the initial three.

**Selected for initial implementation: Google Drive, Figshare, Dataverse.**
OSF is retained as a legacy adapter — existing connected users and in-flight
studies keep working unmodified; new experiments default to one of the three
new providers.

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

  // ongoing writes
  writeSessionFile(auth, containerRef, filename, data) -> WriteResult
  updateFile(auth, containerRef, existingFileRef, data) -> WriteResult

  // needed for collision-cache rehydration (see below) and dashboard file counts
  listFiles(auth, containerRef) -> FileRef[]

  capabilities: { nativeSubfolders: bool, supportsRegion: bool }
}
```

`capabilities` is descriptive (UI hints, subfolder fallback behavior), not a
correctness gate — provider-side atomicity is no longer load-bearing (see below).

### Collision detection: a cache, not a new system of record

None of the three selected providers offer OSF's atomic `409`-on-duplicate
behavior (Drive allows same-name files silently, Dataverse silently renames,
Figshare's behavior is unconfirmed). Rather than build three different
reliability models behind one interface, collision detection moves entirely into
Firestore, decoupled from the provider:

- Before any provider write, atomically claim `(experimentId, filenameHash)` in a
  Firestore transaction. A failed claim means "duplicate filename" — no
  provider round-trip needed to know that.
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
- Edge cases to handle explicitly: rehydration should fail loudly (prompt the
  researcher to reconnect) if the provider container is missing or access was
  revoked, rather than silently accepting duplicates; large containers need
  paginated listing.

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
    dataverse?: { authMethod: 'static-token', encryptedToken, serverUrl },
  }
}
```

`crypto-utils.ts` (AES-256-GCM) and `generate-oauth-state.ts` (CSRF state
handling) carry over unchanged — already provider-agnostic.

### Per-provider adapter notes

| | Google Drive | Figshare | Dataverse |
|---|---|---|---|
| Auth | OAuth2, `drive.file` scope | OAuth2, `authorization_code` + `refresh_token` | Static API token — same shape as today's OSF PAT fallback (`usingPersonalToken`) |
| Container | Subfolder under a researcher-picked parent folder | Article inside a Project (two levels only) | Dataset inside a Collection |
| Subfolders | Native | **None** — filename-prefix fallback, surfaced in UI as a known limitation | Native via `directoryLabel` |
| Federation | Single global service | Single global service | **Federated** — Harvard, Borealis, DataverseNL, etc. are different servers; `serverUrl` must be stored per researcher |
| DOI/publish | N/A | Publishing an Article snapshots it | Dataset publish bumps a major version — dataset should stay in **draft indefinitely**; publish (and DOI mint) becomes a manual researcher action at study completion, not something DataPipe triggers |
| Needs a pre-build spike | No | Confirm actual upload conflict behavior empirically (docs are silent/unconfirmed) | Confirm and handle the silent-rename response explicitly, even though Firestore is the real collision gate |

### OAuth generalization

Replace today's 4–5 near-duplicated OSF-auth-URL-building blocks and single
OSF-hardcoded `oauth2-callback` function with a small provider registry
(`{authorizeUrl, tokenUrl, clientId, clientSecret, scope}` per provider) and one
generic callback function parameterized by a `provider` field carried in the
existing CSRF state payload.

### Frontend changes

- `admin/new.js`: provider selector + provider-specific sub-form.
- `account/*`: collapse per-provider components (`SignUpWithOSF`, `OSFToken`,
  `OAuthTokenStatus`, etc.) into one generic connect-button + token-status
  component, parameterized by a small per-provider config (name, icon, docs
  link).
- `ExperimentInfo.js` / `QueuePanel.js`: replace hardcoded OSF links and OSF
  status-code copy with a generic error taxonomy (`RATE_LIMITED`,
  `AUTH_EXPIRED`, `NAME_CONFLICT`, `UNAVAILABLE`) that each adapter maps its own
  provider's errors into.
- `firestore.rules`: generalize the field whitelist to the `connectedAccounts.*`
  shape; the experiment `hasAll` check becomes conditional on `storageProvider`.

## Build sequence

1. Define the provider interface + registry + additive Firestore schema (no
   behavior change yet).
2. Refactor existing OSF code into an OSF adapter implementing the new
   interface — pure refactor, proves the abstraction before adding anything new.
3. Land the Firestore collision-cache (salted hash + TTL + lazy rehydration) and
   metadata-ref tracking for the OSF adapter first, while there's still only one
   provider to reason about.
4. Google Drive adapter (simplest OAuth2, most rate-limit headroom, proves the
   multi-provider auth flow end-to-end).
5. Figshare adapter (after the upload-conflict-behavior spike).
6. Dataverse adapter (static-token path, "stays in draft" publish workflow).
7. Frontend: provider selection UI, generalized connect/status components,
   generalized dashboard links and error copy.
8. FAQ/docs, `firestore.rules`, env config for new provider client
   IDs/secrets.

## Open questions / spikes before implementation

- Empirically verify Figshare's upload behavior on a duplicate filename.
- Confirm Dataverse's exact response shape on a silent rename, so DataPipe can
  detect and surface it rather than trust the returned filename blindly.
- Decide the exact collision-cache TTL window (90 days proposed, not yet
  validated against real usage patterns).
- Decide the UX for Dataverse's federated `serverUrl` requirement (does
  DataPipe maintain a picker of known installations, or require researchers to
  paste their institution's Dataverse URL?).
