# Incremental Session Upload — Design Doc

Status: **built** (2026-09-02), on `feat/streaming-ingest` and, for the client
half, `feat/pipe-streaming` in `jspsych-contrib`. The cost figures below were
measured against production before implementation and are unchanged.

**Four decisions differ from the design as originally written**, and the
sections they affect are annotated inline. In summary:

1. **Session ids are minted server-side** by `POST /api/session`
   (`functions/src/api-session-start.ts`), which runs the same four gates
   `api-data.ts` runs. This ANSWERS open question 1 and **deletes the
   `openExperiments` mirror and its reconciliation pass** from the design. Cost:
   a second function invocation per session (~20,000/month against a
   2,000,000/month free tier).
2. **No assembly on the happy path.** A clean completion still POSTs the whole
   dataset, because the browser still has it; `sessionId` only names the staged
   copy to discard. This removes the only line item in the cost table below and
   keeps validation, CSV support and the metadata pipeline byte-identical.
3. **Partial sessions** upload as `<name>.partial.json`, do not increment
   `sessions`, and do not arm the upload-failure notifier. This answers open
   question 2.
4. **Staged trials are not encrypted at the application layer**, contrary to
   this document's "safe default" in open question 4. The writer is the
   participant's browser: it has no key, and a key shipped in a plugin bundle
   is a key every participant holds. They get unreadability by rule
   (`.read` is granted to nobody at any depth), Google's default at-rest
   encryption, and a window of minutes. `pages/docs/privacy.js` was corrected
   to say so rather than leave its "two copies" claim standing.

## Background

DataPipe accepts a session's data exactly once, at the end. The participant's
browser runs the whole experiment, accumulates the dataset in memory, and POSTs
it to `/api/data` when the last trial finishes. If the participant closes the
tab, loses wifi, or the browser crashes at trial 199 of 200, **every trial is
lost** — DataPipe never saw any of it.

The obvious fix is to send data as it is produced: a POST per trial, or per
handful of trials. That fix is what this document argues against, and then
replaces.

## Why "just call the endpoint more often" is the wrong fix

The cost of an invocation is *not* the reason. Cloud Functions bill $0.40 per
million invocations after 2M free per month, and production runs roughly 10,000
sessions/month (see "Measured volume" below). Even at 200 trials per session
that is 2M invocations — call it a dollar. **Nobody should re-litigate this on
price grounds.** Three other things break first:

1. **The instance ceiling.** `functions/src/index.ts:44` sets
   `maxInstances: 20`, and `api-data.ts:21` sets `concurrency: 1` — one request
   per instance, twenty instances, so **twenty in-flight requests globally**.
   Today that is twenty simultaneous *sessions submitting*, which is plenty.
   Per-trial it becomes twenty simultaneous *trials*, across every experiment
   DataPipe hosts. A single lecture-hall study would saturate it.

2. **The provider write.** Every accepted submission performs a real API write
   to OSF/Drive/Zenodo/Dataverse. Two hundred of those per session is not a
   scaling problem, it is a correctness problem: Zenodo caps a deposition at
   100 files, and `compaction.ts` exists precisely to relieve that cap. Fanning
   out per-trial writes would manufacture, at the ingest layer, the exact
   condition compaction was built to undo.

3. **The log collection.** `api-data.ts` calls `writeLog` on every request.
   Per-trial ingest multiplies `logs/{experimentId}` by ~100×, immediately
   after #208 did the work to make that collection readable, bounded, and
   queryable.

So the requirement is sharper than "fewer function calls":

> **Get each trial durable without a function invocation, and keep exactly one
> provider write per session.**

The second half is already solved. `persist-pending.ts` → `uploadQueue` →
`compaction.ts` → `finalization.ts` decouple "DataPipe has the data" from
"the provider has the data". This design only has to add a staging layer in
front of that machinery, not rework it.

## Requirements

- A participant's browser can make a trial durable **without invoking a
  function**, and without an authenticated Firebase user — experiments are
  served from arbitrary hosts (Prolific, lab domains, jsPsych's own CDN pages).
- Disconnection is detected **without polling and without a per-session timer
  function**.
- Exactly **one provider write per session**, unchanged from today.
- **No per-write function trigger.** An `onDocumentCreated` on the staging
  collection would silently reinstate the per-trial invocation this design
  exists to avoid. This is the single easiest way to get this wrong.
- Staged trials are **participant data at rest** and inherit the retention and
  encryption posture of `payload-crypto.ts` and `upload-retention.ts`.

## Mechanisms evaluated

### Rejected — GCS resumable upload

This is the mechanism that *sounds* like the answer ("streaming upload"), so it
is recorded here to stop it being re-proposed.

Cloud Storage supports resumable uploads of unknown total size: intermediate
chunks carry `Content-Range: bytes 0-524287/*` and the final chunk supplies the
total. One function mints the session URL, one `onObjectFinalized` trigger fires
at the end. Two invocations per session — ideal, on paper.

**It fails the recovery requirement.** Intermediate chunks must be a multiple of
**256 KiB**. A jsPsych trial is roughly 0.5–5 KB, so nothing becomes durable
until 50–500 trials have accumulated, and many complete sessions never reach
256 KiB at all. The participant who disconnects at trial 199 still loses
everything. This buys the invocation savings and none of the durability.

(Verified against Cloud Storage documentation, 2026-09-02.)

### Rejected as primary, retained as fallback — Firestore staging

The participant's browser writes one document per trial to a staging
collection, governed by security rules; the completion call reads them back.
This works, and it has one large advantage: **no new product**. Firestore rules,
emulator wiring, and test infrastructure already exist in this repo.

Two reasons it is not the primary choice:

- **No `onDisconnect` equivalent.** Detecting abandonment means either a client
  heartbeat (writes, therefore cost, therefore per-session churn) or a sweep
  that cannot distinguish "still running" from "gone" except by age. That makes
  the recovery window coarse and the semantics muddy.
- **Per-operation billing.** ~$13/month at 25,000 sessions × 200 trials, versus
  ~$0 for RTDB (table below). Small money, but it scales with the thing this
  feature is designed to increase.

If the RTDB spike fails, this is the fallback, and it is a perfectly acceptable
system. **If it is built: do not attach a trigger to the staging collection.**

### Chosen — Realtime Database staging

RTDB fits this problem for two reasons that are specific, not aesthetic:

1. **It does not bill operations at all.** Storage ($5/GB-month above 1 GB) and
   downloads ($1/GB above 360 MB/day) only. Participants writing trials is
   free, at any rate, forever.

2. **`onDisconnect()` solves abandonment server-side, with zero invocations.**
   The client queues a write when it connects; Firebase's servers execute it
   when the connection drops — per Firebase's documentation, "whether the client
   disconnects cleanly or not... even if a connection is dropped or a client
   crashes." Tab close, closed laptop, dead wifi. No heartbeat, no timer, no
   function.

That second property is the actual reason to adopt RTDB. **If the design ends up
not using `onDisconnect`, this decision should be revisited in favour of
Firestore staging** — the cost delta alone does not justify a second datastore.

## Architecture

### Data model

```
staging/{experimentId}/{sessionId}/
    meta/
        startedAt      : server timestamp
        abandonedAt    : written by onDisconnect(), removed on clean completion
    trials/
        {seq}          : one trial's JSON, append-only
```

`sessionId` is a client-generated UUID. It is unguessable, which is what makes
a write-only rule safe: knowing an `experimentId` (which is public — it is in
the experiment's own JS) does not let you find or overwrite anyone's session.

### Security rules, and the one thing they cannot do

Rules must enforce: **write-only** (no read, at all), **append-only**
(`!data.exists()` on each trial key, so a trial cannot be rewritten), a **size
cap** per trial and per session, and that the target experiment is **open for
collection**.

That last one is the problem: **RTDB rules cannot read Firestore.** They cannot
see `active`, `finalized`, or `limitSessions`/`maxSessions` — the four gates
`api-data.ts` checks today before accepting anything.

> **SUPERSEDED (decision 1).** The mirror below was NOT built. `POST
> /api/session` runs the four gates in a function, against Firestore, and
> writes `openSessions/{sessionId}`; rules gate on that node existing. A session
> id that no function minted is worth nothing, which is what closes open
> question 1 — the mirror left the tier writable by anyone holding an
> experiment id, which is public by construction.
>
> Two other things the mirror got wrong, worth recording: it needed a
> reconciliation pass or a half-failed toggle left an experiment permanently
> open, and it could not have been written where this section assumes. The
> researcher's active toggle is a CLIENT-SIDE Firestore write
> (`components/dashboard/ExperimentActive.js:91`), not server code, so it would
> have needed an `onDocumentWritten` trigger as well.

The rejected fix was a mirror. A small node, written only by existing server
code:

```
openExperiments/{experimentId} : true | absent
```

`create-experiment.ts` writes it; the researcher's active/finalize toggles
update it; `finalization.ts` removes it. Rules then gate on
`root.child('openExperiments').child($experimentId).exists()`. The mirror is
derived state, so it needs a reconciliation path — a scheduled pass that
compares it against Firestore, in the shape of `scheduled-pending-recovery.ts`
— or a toggle that fails halfway leaves an experiment permanently closed or
permanently open to staging.

Session limits deliberately stay **unenforced at the rules layer** and are
checked at completion, as today. Enforcing a count in rules requires a
read-modify-write of a shared counter, which is both a hot spot and a read path
into data that must stay unreadable.

### Session lifecycle

1. **Start.** Client generates `sessionId`, opens the RTDB connection, and
   registers `onDisconnect()` to set `meta/abandonedAt`. No function call.
2. **Each trial.** Client writes `trials/{seq}`. No function call. Batched
   client-side (see below) so this is every few trials, not literally every one.
3. **Clean completion.** Client cancels the `onDisconnect`, then calls
   `/api/data` **once** with `sessionId` **alongside** the payload — not in
   place of it (decision 2). The browser still holds the dataset, so the
   request is what it always was and the whole existing pipeline runs on it
   untouched: validation, `persistPending`, `queueUpload`, metadata,
   compaction. `sessionId` only names the staging node to delete afterwards.
   Reading the session back would have cost the one billed operation in the
   table below, and assembling it server-side would have meant reimplementing
   jsPsych's CSV serializer in `functions/` — a silent-corruption risk on the
   path 100% of sessions take, to save work the client had already done.
4. **Abandonment.** `meta/abandonedAt` is set by Firebase's servers. A scheduled
   sweep — modelled on `scheduled-pending-recovery.ts`, including its
   `MAX_FILES_PER_RUN` batching — picks up sessions abandoned longer than some
   threshold, assembles what exists, and pushes it through the same pipeline
   flagged as partial. **One invocation per sweep, not per session.**

Invocation count per completed session: **one**, exactly as today. Per abandoned
session: **a fraction of one**.

### What does not change

`persist-pending.ts`, `queue-upload.ts`, `compaction.ts`, `finalization.ts`,
`upload-retention.ts`, the provider adapters, and the notification path are all
untouched. This design adds a staging tier in front of `api-data.ts` and a
sweep beside it. That is the whole surface.

## Measured volume and cost

Production (`osf-relay`), queried 2026-09-02:

- **2,596 experiments**, **476,757 lifetime sessions**, mean 184 sessions per
  experiment.
- Over the repo's 48 months that averages **~9,900 sessions/month**. The current
  rate is presumably higher; the table covers 1–10× that.

A per-date breakdown was not possible: `createdAt` and `lastRequestAt` do not
exist on any production experiment document. They are written by
`create-experiment.ts:235`, which has not yet reached `main`. See "Related
finding" below.

Billing model: participant writes are **free** (RTDB does not bill operations,
and uploads are not downloads). The billed download was to be the function
reading each session back once. **Decision 2 removed it**: a completed session
is never read back, so the only downloads are the sweep reading abandoned
sessions — a fraction of the table below. Storage is transient — staged data is
deleted at completion.

```
  volume/mo              |  data through staging       | RTDB   | Firestore-staging
 ------------------------+-----------------------------+--------+------------------
  10,000 sess 200KB 200tr|   2.0 GB/mo (  67 MB/day)   |  $0.00 |   $5.20
  25,000 sess 200KB 200tr|   5.0 GB/mo ( 167 MB/day)   |  $0.00 |  $13.00
  25,000 sess 500KB 400tr|  12.5 GB/mo ( 417 MB/day)   |  $1.70 |  $26.00
  50,000 sess 300KB 300tr|  15.0 GB/mo ( 500 MB/day)   |  $4.20 |  $39.00
  50,000 sess 500KB 500tr|  25.0 GB/mo ( 833 MB/day)   | $14.20 |  $65.00
 100,000 sess 500KB 500tr|  50.0 GB/mo (1667 MB/day)   | $39.20 | $130.00
```

**$0/month until roughly 4–5× current volume.** Cloud Functions stay inside the
2M free tier either way. Three caveats:

- **The 360 MB download allowance is per _day_, not pooled monthly.** A study
  collecting 2,000 sessions in one afternoon can exceed it while the monthly
  average looks harmless. Expect occasional dollars, not a smooth curve.
- **Simultaneous connections are capped at 200K and not billed.** At 10,000
  sessions/month averaging ~20 minutes, concurrency is around **5**. Irrelevant
  at this scale, and worth re-checking only if DataPipe grows 1000×.
- **A broken sweep is the expensive failure.** RTDB storage is $5/GB-month —
  about 190× Cloud Storage's $0.026/GB. The design assumes staged sessions are
  deleted promptly. Orphaned staging data accumulates at the highest per-GB
  rate in the stack, so **sweep health needs a monitored metric**, not just a
  scheduled function that might be quietly failing.

## Client-side batching (do this regardless)

Independently of the backend choice, the plugin should buffer trials and flush
every N trials or T seconds, plus `navigator.sendBeacon` on `visibilitychange`
for the tail. This cuts write volume by an order of magnitude, costs nothing to
build, and — if "recover if it disconnects" turns out to mean "lose at most a
minute" rather than "lose at most a trial" — **may be sufficient on its own,
against the current backend, with no staging tier at all.** That possibility
should be tested before any of the above is built.

The client work lives in `@jspsych-contrib/plugin-pipe`, not this repo. Every
option here ships as a coordinated pair of releases.

## Risks and open questions

1. **ANSWERED (decision 1).** ~~The unauthenticated write path is the main
   risk.~~ Today `api-data.ts`
   gates submissions on experiment existence, `active`, `finalized`, and session
   limits before anything is persisted. Rules plus the `openExperiments` mirror
   are a weaker gate, and the staging tier is writable by anyone who can read an
   experiment's public ID. App Check is the standard hardening answer but sits
   badly with experiments served from arbitrary hosts. **Unresolved — this needs
   an answer before the spike, not after.**

2. **ANSWERED (decision 3): `<name>.partial.json`, uncounted, no notification.**
   The sweep re-checks `finalized` and `active` before queueing, because a
   researcher can seal an experiment between staging and recovery, and a file
   landing outside a merged archive is exactly what `docs/finalization-spec.md`
   prevents. ~~What a partial session *is*.~~ Recovered fragments become files in the
   researcher's Drive/OSF/Zenodo. They need a distinct marker or path, or
   DataPipe quietly makes datasets non-Psych-DS — the same class of problem
   `docs/finalization-spec.md` addresses for archives. Does a partial session
   count against `maxSessions`? Does it trigger the upload-failure notification?

3. **Retention of staged data.** Trials sitting in RTDB are participant data
   that no researcher has been told about. `upload-retention.ts` documents why
   the plain age test was not enough for the upload queue; the same reasoning
   applies to a sweep threshold here, and the answer is a policy decision, not
   a constant.

4. **ANSWERED, AGAINST THE SAFE DEFAULT (decision 4).** ~~Encryption at rest.~~ `persist-pending.ts` encrypts pending payloads
   because they hold raw submissions for up to seven days. Staged trials hold
   the same data for minutes to hours. Whether that shorter window changes the
   answer is undecided; the safe default is that it does not.

5. **Ordering and duplicates.** Client-assigned `seq` on an append-only node
   makes replays idempotent, but a retrying client must not renumber. The
   assembly step should tolerate gaps (a lost flush) rather than reject them.

## If this is built

Deployment surface, none of which exists yet:

- `database.rules.json` at the repo root, plus a `"database"` entry in
  `firebase.json` (which currently declares only storage, firestore, hosting,
  emulators, functions).
- An RTDB emulator port in `firebase.json` — default 9000 — and rules tests
  alongside `__tests__/firestore-rules.test.js`.
- `--only database` added to the deploy line in **both**
  `.github/workflows/firebase-deploy-test.yml` and
  `firebase-deploy.yml`. The production workflow currently deploys
  `firestore,functions,hosting`; a rules file that is never deployed is worse
  than no rules file.

Suggested order: **client-side batching first** (cheap, independently useful,
and may settle the requirement) → RTDB spike behind a flag on the test site →
the sweep → the `openExperiments` mirror and its reconciliation → cut over.

**As built**, all of the above exists except the mirror, plus:

- `functions/src/staging.ts` and `staging-assembly.ts` (the RTDB half and the
  pure half, split so trial ordering, gap tolerance and filename sanitisation
  are testable without an emulator).
- `functions/src/api-session-start.ts`, `scheduled-staging-sweep.ts`.
- `systemStatus/staging`, written on every sweep run including a no-op one —
  the monitored metric this document asks for. A stale `lastRunAt` is the alarm.
- `__tests__/database-rules.test.js` (30), `staging-assembly.test.js` (16),
  `staging-emulator.test.js` (22), and 23 in the plugin.

**Batching was not tested as a standalone alternative first**, contrary to the
suggestion above. A POST per flush is a provider write per flush, which is the
condition §2 says compaction exists to undo; batching lives inside the client's
`record()` instead.

The staging database's address is resolved at runtime, not assumed:
`STAGING_DATABASE_URL` if set, else `FIREBASE_CONFIG.databaseURL` (which
`firebase deploy` fills from the Management API, so any region works), else
derived from the project id, which is right only for us-central1.
`functions/.env.local` pins it for the emulator, which otherwise puts functions
and rules in different namespaces while a project has no instance.

Two prerequisites that are NOT code and are easy to miss:

1. **An RTDB instance must be created in each Firebase project** before
   `firebase deploy --only database` will work. It is not auto-provisioned.
2. The deploy line in both workflows now includes `database`.

## Related finding (2026-09-02)

While measuring production volume: **`createdAt` and `lastRequestAt` are absent
from all 2,596 production experiment documents.** They are written by
`create-experiment.ts:235` on the unreleased `test` branch, and no migration in
`migrations/` backfills them. After PR #188 merges they will populate only for
newly created experiments, so the "no requests since March" versus "created
yesterday, no requests yet" distinction described at `create-experiment.ts:224`
will be blank for every experiment that predates the release. A backfill would
have to synthesise `createdAt` from another source, or accept a null era.

Unrelated to streaming ingest; recorded here because this is where it surfaced.
