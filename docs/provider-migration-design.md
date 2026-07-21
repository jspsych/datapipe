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
   for the life of a study (months). **Deliberately relaxed for Dataverse**,
   which only offers static API tokens: accepted because DataPipe already
   maintains an equivalent PAT path for OSF, but Dataverse tokens expire
   (commonly yearly, installation-configurable), so the unattended-for-months
   constraint requires expiry-warning UX, not just token storage.
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

`crypto-utils.ts` (AES-256-GCM) and `generate-oauth-state.ts` (CSRF state
handling) carry over unchanged — already provider-agnostic.

### Per-provider adapter notes

| | Google Drive | Figshare | Dataverse |
|---|---|---|---|
| Auth | OAuth2, `drive.file` scope | OAuth2, `authorization_code` + `refresh_token` | Static API token — same shape as today's OSF PAT fallback (`usingPersonalToken`) |
| Auth longevity | Refresh tokens are revoked after ~6 months of disuse — paused studies need reconnect UX. App must reach **published** OAuth verification status: testing mode means 7-day refresh tokens and a 100-user cap | Long-lived; confirm rotation/expiry behavior in the spike | Tokens **expire** (commonly yearly, installation-configurable) — needs expiry-warning UX, not just storage |
| Container | **App-created "DataPipe" folder at Drive root.** Under `drive.file` the app can only touch files it created or the user explicitly picked — a researcher-picked parent would force a Google Picker frontend integration for little gain. Revisit only if researchers demand placement control | Article inside a Project (two levels only) | Dataset inside a Collection |
| Subfolders | Native | **None** — filename-prefix fallback, surfaced in UI as a known limitation | Native via `directoryLabel` |
| Media / size limits | Free quota is 15 GB **shared with Gmail/Photos** — quota exhaustion is an expected support scenario for audio/video studies, not an edge case | Per-file and total-quota caps on the free tier; upload is a multi-step multipart flow (initiate → parts → complete) with correspondingly more failure modes; no in-place update (delete + re-upload) | Per-installation size caps (federation → varies); CSV uploads are **"ingested"** into archival `.tab` format unless suppressed, which transforms presentation and extends dataset locking — suppression support is version-dependent |
| Federation | Single global service | Single global service | **Federated** — Harvard, Borealis, DataverseNL, etc. are different servers; `serverUrl` must be stored per researcher, and DataPipe integrates whatever software version each installation runs (version drift is a permanent fact of this adapter) |
| DOI/publish | N/A | Publishing an Article snapshots it | Dataset publish bumps a major version — dataset should stay in **draft indefinitely**; publish (and DOI mint) becomes a manual researcher action at study completion, not something DataPipe triggers |
| Gating spike | None (comfortable fit) — but OAuth app verification has **weeks of lead time**; start it at build step 0 | See "Gating spikes" below — duplicate-filename behavior, per-item **file-count cap** (historically ~500 files/item; a semester-long study can exceed it), multipart burst behavior | See "Gating spikes" below — **dataset locking under concurrent adds** (most likely disqualifier in the plan), tabular-ingest suppression, silent-rename response shape |

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
- **Dataverse — tabular ingest.** Confirm CSV ingest-into-`.tab` can be
  suppressed on the installations researchers actually use (suppression is
  version-dependent, and federation means DataPipe doesn't choose the version).
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

## Open questions

- Decide the exact collision-cache TTL window (90 days proposed, not yet
  validated against real usage patterns).
- Decide the UX for Dataverse's federated `serverUrl` requirement (does
  DataPipe maintain a picker of known installations, or require researchers to
  paste their institution's Dataverse URL?).
- Do researchers need placement control for the Drive folder strongly enough
  to justify a Google Picker integration, or is the app-created root folder
  acceptable? (Default answer: root folder; revisit on demand.)
