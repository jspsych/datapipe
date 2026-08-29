# Deploying the contact-email feature

Operational notes for rolling out required contact emails + first-failure
upload notifications. See the design doc for the full architecture; this file
covers only what changes at deploy time, in the order it needs to happen.

## 1. Deploy order: rules before functions, and it is not optional

```
firebase deploy --only firestore:rules
firebase deploy --only functions
firebase deploy --only hosting
```

`firestore.rules` must go out **before** the functions and the frontend that
depend on it, for two independent reasons:

- **The contact-email gate's `setDoc` needs `isContactEmailUpdate()` to
  exist.** Deploy the frontend first and a researcher who fills in the gate
  gets a write rejected by the old rules — a silent-looking failure from
  their side, since the client only sees "permission denied."
- **`uploadFailure` needs to be in `serverManagedFieldsUntouched()`.** The
  notification trigger writes `experiments/{id}.uploadFailure` with the Admin
  SDK, which bypasses rules entirely — so the trigger itself is not blocked
  by deploy order. What *is* blocked: the moment `uploadFailure` appears on
  an experiment doc under the *old* rules, any client-side update to that
  experiment (`ExperimentActive.js`, `ExperimentValidation.js`) that the old
  rules validate with a stale field allowlist starts failing, because the
  document now carries a key the old rules don't know to ignore.

Both failure modes are silent-to-the-researcher permission errors, not
crashes, which is exactly the kind of bug that sits undetected until a
support email arrives. Deploy rules first.

## 2. Resend setup

> **This section has been rewritten twice.** The original plan was the Firebase
> Trigger Email extension (`firebase/firestore-send-email`); that platform is
> deprecated, so delivery moved in-repo to `functions/src/mail-delivery.ts`, a
> Firestore `onDocumentCreated("mail/{id}")` trigger deployed as `onmailcreated`.
> That version sent through Amazon SES. **AWS denied the SES production-access
> request**, which would have left every send restricted to verified recipient
> addresses — i.e. failing for every real researcher — so the transport is now
> **Resend**, over its JSON HTTP API.
>
> **Nothing on the write side changed, either time.** `functions/src/mail.ts`
> still owns the document shape, and `mail-delivery.ts` still writes the
> extension's outcome fields (`delivery.state`, `delivery.attempts`,
> `delivery.startTime`, `delivery.endTime`, `delivery.error`,
> `delivery.info.messageId`), so §4's TTL policy and every test that reads the
> `mail` collection are unaffected. `delivery.info.transport` now reads
> `"resend"` rather than `"ses"`.
>
> **What got simpler.** One secret instead of three; no region to keep in sync
> with a verified identity; no IAM user, no long-lived AWS access key, and no
> request signing that a stray newline can break. The `@aws-sdk/client-sesv2`
> dependency is gone — delivery is one `fetch` to one endpoint, so there is no
> SDK on the cold-start path to keep off it either.
>
> **If you are migrating an already-deployed SES setup**, see (f) at the end
> for what to tear down.

### (a) Verify the sending domain, and publish the DNS records

Resend dashboard → **Domains** → *Add Domain* → `jspsych.org`, and pick the
region you want to send from.

Resend then shows the exact records to publish — **the dashboard is the
authority on the values, which are per-account; do not copy them from here.**
The shape is three things:

- a **DKIM** `TXT` record on a `resend._domainkey` host,
- an **SPF** `TXT` record on a `send` subdomain, and
- an **MX** record on that same `send` subdomain, which is the custom
  Return-Path that makes SPF align with your From domain.

Publish all of them and wait for the domain to read **Verified** in the
dashboard. Until it does, every send fails with a `403 validation_error`
("domain is not verified"), which `mail-delivery.ts` classifies as
**permanent** — the mail is not retried, it is marked terminally failed.

Two notes on scope:

- **A verified root domain does not automatically cover subdomains in Resend**,
  unlike an SES identity. This does not matter here — `MAIL_FROM` is an address
  *at* `jspsych.org`, not at `pipe.jspsych.org` — but it is worth knowing before
  someone changes the From address to a subdomain and watches every mail fail.
- **DMARC** is worth adding while DNS is open: `_dmarc.jspsych.org TXT
  "v=DMARC1; p=none; rua=mailto:<an address you read>"`. Start at `p=none`; it
  reports without rejecting.

**The spam warning still stands, and it is the reason this step is first.**
Without DKIM and SPF alignment in place, a meaningful share of these
notifications will land in spam or be silently dropped — and because this
feature exists specifically to reach a researcher whose data has stopped
arriving, a notification nobody sees is functionally the same as no
notification at all. This needs DNS access to `jspsych.org`. Confirm the
records are in place before flipping this on in prod, and leave `RESEND_API_KEY`
unset in the interim rather than sending from an unverified domain — an unset
secret is a loud, recorded failure (see (d)), not a silent one.

### (b) What replaces the SES sandbox

There is no sandbox to exit, which is the entire reason for the migration. Two
limits take its place, and both behave differently from the SES one:

- **Before the domain is verified**, a Resend account can only send to the
  account owner's own address. Same failure shape as the SES sandbox, same
  terminal classification — and the fix is (a), not a support ticket.
- **After verification, the plan caps apply.** The free plan is **3,000
  emails/month with a 100/day ceiling**; Pro is $20/month for 50,000. DataPipe's
  steady-state volume is far below either — verification codes are one per
  address change (with a resend cooldown in
  `send-contact-email-verification.ts`), and failure notifications are capped at
  one per experiment per 24 hours (`RATE_LIMIT_MS` in
  `upload-failure-notify.ts`).

  **The burst case is the one to size for, not the steady state.** An outage at
  a storage provider puts many experiments into a failure episode at once, and
  100/day is reachable there. When it is reached, Resend answers
  `429 daily_quota_exceeded`, which `mail-delivery.ts` classifies as retryable —
  but nothing retries a retryable error on a timer (see the file header), so in
  practice those notifications are undelivered until someone re-drives them.
  That is precisely the moment these mails matter most, so
  **`daily_quota_exceeded` in the logs is the signal to move to a paid plan.**
  It is the second line worth alerting on, after `MailConfigMissingError`.

### (c) An API key scoped to sending, and to this domain

Resend dashboard → **API keys** → *Create API key*:

- **Permission: sending access**, not full access. A sending-only key cannot
  read the account, list domains, or create other keys.
- **Domain: `jspsych.org`.** The optional domain restriction is the Resend
  equivalent of the `ses:FromAddress` IAM condition it replaces, and it is what
  stops a leaked key from being used to send as anything other than DataPipe.

The key is shown **once**. Put it straight into the repo secret in (d); if it is
lost, delete it and make another rather than leaving an unaccounted-for key
active.

### (d) Two repo secrets, two literals, and the workflows that write them

The credentials reach the functions as ordinary environment variables in
`functions/.env`, written at deploy time from GitHub repo secrets — the same
mechanism `TOKEN_ENCRYPTION_KEY` already uses. There is no Secret Manager entry
and no extension config to keep in sync.

| Function env var | Secret? | Production value from | Test value from |
|---|---|---|---|
| `RESEND_API_KEY` | yes (repo secret) | `PROD_RESEND_API_KEY` | `TEST_RESEND_API_KEY` |
| `MAIL_FROM` | no — literal in the workflow | `DataPipe <datapipe-notifications@jspsych.org>` | `DataPipe (test) <datapipe-notifications@jspsych.org>` — same verified domain, display name marks it as test |
| `MAIL_REPLY_TO` | no — literal in the workflow | `datapipe@jspsych.org` | `datapipe@jspsych.org` |

So: **one new repo secret per environment**, two in total, named in the repo's
existing `PROD_*`/`TEST_*` style (`PROD_CLIENT_SECRET`,
`TEST_GDRIVE_CLIENT_SECRET`, …). This replaces the six `*_SES_*` secrets the
previous version of this section called for.

They are written in the **`Create functions environment file`** step of:

- `.github/workflows/firebase-deploy.yml` (production, on push to `main`)
- `.github/workflows/firebase-deploy-test.yml` (test site, on push to `test`)

immediately after the `TOKEN_ENCRYPTION_KEY` line. `MAIL_FROM` and
`MAIL_REPLY_TO` are plain literals in the same block, like `REDIRECT_URI`.
`.github/workflows/node.js.yml` (CI) deliberately writes **neither** — see
"What happens without configuration" below.

`MAIL_FROM` must be an address on the Resend-verified domain from (a), and on
the domain the key is restricted to in (c). `MAIL_REPLY_TO` is a forwarding
alias on `jspsych.org` that reaches the operating team; it is optional (mail
with no Reply-To is deliverable, mail with a bad one is not).

**What happens without configuration.** Missing or blank config is a
**terminal** delivery error with the distinct name `MailConfigMissingError`,
written onto the mail document (`delivery.error.name`, and
`delivery.error.message` naming the missing keys) and logged at error level
naming the keys — never their values. Mail never silently vanishes, but note
that terminal means terminal: **documents that failed this way are not retried
once the config is fixed.** Re-drive them by deleting the `delivery` field, or
accept the loss. Grep production logs for `MailConfigMissingError`; it is the
first line worth alerting on, because it means every notification the
deployment sends is being dropped.

**The test site and the emulator.**

- **`datapipe-test`: set `TEST_RESEND_API_KEY`.** The test site is expected to
  send, and that is a deliberate reversal of the "leave it unset" default an
  earlier draft of this section recommended.

  The reason is that **the test site is the only place delivery is exercised
  before production.** The emulator cannot do it — see the next bullet,
  `onmailcreated` returns before reading, writing or sending — and the unit
  suites mock the transport at a function seam, so nothing below the test site
  proves that a real message leaves the building, passes DKIM/SPF/DMARC and
  lands in an inbox rather than a spam folder. Ship a mail change straight to
  prod without that step and the first real send is to a researcher whose data
  has stopped arriving, which is the worst possible audience for a first
  attempt.

  Use a **separate sending-only key from prod, on the same Resend account.** It
  has to be the same account: the test `MAIL_FROM` is
  `datapipe-notifications@jspsych.org` too, and a `datapipe-test.web.app`
  address can never be verified. Two keys rather than one shared key, because
  test can then be revoked without touching prod, and Resend attributes sends
  per key, so test traffic stays distinguishable in the dashboard.
- **The emulator (and therefore CI)**: `onmailcreated` checks
  `FUNCTIONS_EMULATOR` and returns before doing anything at all — no read, no
  write, no send. Un-delivered mail in an emulator run is expected. This gate
  matters more than it did under SES: a real key sitting in a developer's
  `functions/.env` would otherwise let a local test run mail a real person. It
  is also what keeps the live trigger from racing the test suites' `mail`
  fixtures under `firebase emulators:exec`; see the header of
  `functions/src/__tests__/mail-delivery-emulator.test.js`.

**Verifying delivery before a production deploy.** Two things are worth actually
sending on `datapipe-test`, and they are not equally easy to provoke:

- **A verification code** is trivial: change the contact email on a test
  account and `send-contact-email-verification.ts` mails one. This is the one
  to use for deliverability checks — DKIM/SPF alignment, inbox versus spam
  folder, how the From name and Reply-To render in a real client.
- **An upload-failure notification** needs a real failure *episode*.
  `upload-failure-notify.ts` opens one only on a failure DataPipe has actually
  recorded, and rate-limits to one mail per experiment per 24 hours
  (`RATE_LIMIT_MS`), so it cannot be provoked by repetition — you have to make
  an upload genuinely fail on the test site, e.g. revoke a test experiment's
  storage-provider token and then post data to it. Budget more time for this
  one than for the code, and remember the 24-hour floor between attempts on the
  same experiment.

**Two cautions, both because test and prod share one sending identity.**

- **Reputation is shared.** Both deployments send from
  `datapipe-notifications@jspsych.org` on the same verified domain, so bounces
  and spam complaints generated by test sends damage the reputation that
  *production* notifications depend on. Send test mail only to addresses you
  control, and never to an invented one — an invented address bounces, and
  bounces are the expensive kind of mistake here.
- **Quota is shared.** Both keys draw on the same Resend account plan: on the
  free plan that is 100/day across *both* deployments, not 100 each. The bad
  case is specific — a test run consuming quota while a storage-provider outage
  is firing the production burst described in (b). If the test site sends
  routinely, that argues for the paid plan sooner than production volume alone
  would.

### (e) Region

A Resend domain is created in a region, and that is the whole of it — the region
lives in the dashboard, not in this repo. There is no `SES_REGION` to keep in
agreement with an identity and an IAM ARN, and no way for the three to drift
apart, which was the failure mode this section used to warn about.

There is no data-residency argument to weigh: the only personal data reaching
Resend is the recipient address and the message body, and both are transient.

### (f) Tearing down the SES setup

Only relevant if the SES half was already deployed. None of it is load-bearing
any more, and all of it is credential surface:

1. **Delete the IAM user** created for `ses:SendEmail`, which deletes its
   long-lived access key with it. This is the one that matters — it is a
   standing credential that nothing reads.
2. **Delete the six `*_SES_*` repo secrets** (`PROD_SES_REGION`,
   `PROD_SES_ACCESS_KEY_ID`, `PROD_SES_SECRET_ACCESS_KEY`, and the `TEST_*`
   three). The workflows no longer reference them.
3. **The SES verified identity and its DNS records can stay or go.** The three
   `*._domainkey.jspsych.org` DKIM CNAMEs are inert once nothing sends through
   SES. Leaving them costs nothing and keeps the option of going back if the
   appeal ever succeeds; removing them is tidier. Do **not** remove the `_dmarc`
   record — Resend wants that one too.
4. If a custom SES MAIL FROM subdomain (`mail.jspsych.org`) was set up, its MX
   and SPF records are now unused. Resend uses its own `send` subdomain for the
   same purpose, so these do not conflict — but leaving a stale SPF record on a
   subdomain nothing sends from is a small, avoidable piece of confusion.

## 3. Backfill run procedure

`migrations/2026-08-contact-email-backfill.cjs` seeds `contactEmail` for
existing accounts that already have a usable address sitting in **Firebase
Auth** (`admin.auth().listUsers()`), never from `users/{uid}.email` — see the
file's header comment for why the OSF-era `email` field is never a legitimate
source (it is either an OSF-API address DataPipe never confirmed, or the
synthetic `user-{id}@osf.io` fallback).

Run order:

1. **Dry run first, always:**
   ```
   node migrations/2026-08-contact-email-backfill.cjs
   ```
   No `--apply` flag means no writes. It walks every Auth user (paginated,
   1000 at a time), logs per-page running totals, and prints a final report:
   auth users seen, how many would be seeded, how many were skipped because
   `users/{uid}.contactEmail` is already set, how many Auth users have no
   corresponding `users/{uid}` document, and how many have no usable Auth
   email at all (ORCID-only, OSF-era with nothing linked). Read the report
   before doing anything else — the "seeded" count is the population that is
   about to change, and it should roughly match expectations for this project
   (email/password + Google + linked-provider accounts).

2. **Apply:**
   ```
   node migrations/2026-08-contact-email-backfill.cjs --apply
   ```
   Same traversal, same report, but batches (500/commit) are actually
   committed. The script is idempotent — it never overwrites a non-empty
   `contactEmail`, so it is safe to re-run (e.g. against users created after
   the first pass, or after fixing a config issue) without risk of clobbering
   an address a researcher has since set themselves.

3. **Target project:** the script uses the same three-way init as the other
   `migrations/*.cjs` scripts — `NODE_ENV=production` or `CI` for a service
   account from `GOOGLE_CREDENTIALS`/application-default credentials against
   `FIREBASE_PROJECT_ID` (default `osf-relay`); `USE_LOCAL_SERVICE_ACCOUNT`
   for a local service-account file against `datapipe-test`; otherwise it
   points at the Firestore *and* Auth emulators (`localhost:8080` /
   `localhost:9099`) against `datapipe-test`. Double-check
   `FIREBASE_PROJECT_ID` before running with `--apply` against a real project.

4. **Rollout sequencing.** Per the design doc: ship the schema + notification
   pipeline + this backfill *before* shipping the account-page gate. That way
   notifications already work for everyone who has a usable address, and the
   backfill has already cleared most of the population that would otherwise
   hit the gate on their very next visit.

## 4. Mail retention: the TTL policy lives in `firestore.indexes.json`

`mail` documents hold a researcher's address (in `to`) and, after delivery, the
audit trail `mail-delivery.ts` writes (`delivery.state`, `delivery.attempts`,
`delivery.error`, `delivery.info`). They should not accumulate indefinitely.

The extension used to configure this for you. `mail-delivery.ts` cannot — a TTL
policy is project configuration, not something an SDK write can set. So it is
declared in `firestore.indexes.json` and deployed with everything else:

```json
"fieldOverrides": [
  {
    "collectionGroup": "mail",
    "fieldPath": "delivery.expireAt",
    "ttl": true,
    "indexes": [
      { "order": "ASCENDING",  "queryScope": "COLLECTION" },
      { "order": "DESCENDING", "queryScope": "COLLECTION" },
      { "arrayConfig": "CONTAINS", "queryScope": "COLLECTION" }
    ]
  }
]
```

**DO NOT create this by hand with `gcloud`, and do not remove it from this
file.** An earlier version of this section said to run
`gcloud firestore fields ttls update` once per project. That is worse than
useless, and here is what actually happened when someone followed it:

```
14:51  gcloud ... --enable-ttl --project=datapipe-test   → ACTIVE
15:02  PR merged to `test`
15:04  firestore: Deleting 1 field overrides...          ← the deploy
15:10  TTL gone
```

The deploy step is `firebase deploy --only firestore,functions,hosting
--force`, and `--only firestore` **reconciles** field overrides against this
file. With `"fieldOverrides": []` in it, a hand-made TTL is not merely
un-managed — it is something the deploy is actively instructed to delete. The
`--force` flag suppresses the confirmation prompt that would otherwise say so,
and the deploy reports success. A manual TTL therefore survives exactly until
the next deploy of any kind, silently, and the retention promise quietly stops
being kept while the runbook says it is.

The three default single-field indexes in the block above are deliberate. A
`fieldOverride` replaces the field's whole index configuration, so writing
`"indexes": []` would additionally turn OFF single-field indexing for
`delivery.expireAt` — a second, unrelated change nobody asked for. The block
above is what `firebase firestore:indexes` emits for a field with TTL on and
default indexing, so it round-trips.

Confirm after a deploy with either:

```
gcloud firestore fields ttls list --collection-group=mail --project=datapipe-test
gcloud firestore fields ttls list --collection-group=mail --project=osf-relay
```

`state: ACTIVE` is what you want. `CREATING` means the field-level backfill is
still running — it takes several minutes regardless of collection size, because
it is a control-plane operation, not a data one. `Listed 0 items` after a deploy
means this block is missing from `firestore.indexes.json`.

Three things about this policy that are worth knowing:

- **`delivery.endTime` is set only on a TERMINAL outcome** — `SUCCESS`, or an
  `ERROR` that will not be retried. A document in a retryable error state has
  `delivery.endTime: null` and is therefore *never* eligible for deletion,
  which is deliberate: the TTL must not reap a mail that is still deliverable.
  The flip side is that a document stuck in retryable `ERROR` lives forever.
  Those are worth a periodic look (`delivery.state == "ERROR"` and
  `delivery.retryable == true`); there is no automatic sweeper.
- **The retention window is seven days, by design.** `mail-delivery.ts`
  writes `delivery.expireAt = endTime + 7 days` on every terminal outcome
  (delivered or permanently failed), and the TTL policy above keys on it.
  Seven days matches every other retention clock in the product (queued
  payloads, recoverable downloads): long enough to debug deliverability,
  short enough to keep the address-retention promise. Retryable errors carry
  no `expireAt` — they are live work, not records — which is the flip side
  noted above.
- **TTL deletes are ordinary deletes** and fire document triggers. Nothing in
  this codebase triggers on `mail` deletes, and `onmailcreated` is an
  `onDocumentCreated` trigger, so there is no loop here — stated so nobody adds
  one by accident.

This TTL is a backstop, not the only cleanup path. Account deletion
(`functions/src/purge-user-data.ts`) also deletes a purged user's `mail`
documents directly (queried on `datapipe.owner == uid`) and their
`contactEmailVerifications/{uid}` doc, so a deleted account's mail does not wait
out the TTL — it is gone as part of the same purge pass that removes their
experiments and queue entries. That query is unaffected by delivery:
`mail-delivery.ts` writes only under the `delivery` key and never touches `to`,
`message` or `datapipe`. A purge racing an in-flight send is expected and
handled (the send resolves, the receipt has nowhere to land, one warning is
logged).

## 5. When sending is unavailable: the breaker

The two things DataPipe mails fail differently, and the difference only matters
when quota runs out:

| | Verification code | Upload-failure notification |
|---|---|---|
| Nature | **Realtime.** Someone is watching a form. | **Deferrable.** Still true an hour later. |
| Delivered by | The request itself, synchronously | `onmailcreated`, then the sweeper |
| Retried? | **Never** | Yes, `scheduledmailretry` |
| On failure | 503, vague message, cooldown cleared | Stays queued, swept later |

**`systemStatus/mail` is the breaker.** `mail-delivery.ts` writes it after every
send: the daily quota reading on success, a shut breaker on
`daily_quota_exceeded`. It is server-only — no `firestore.rules` match, so it is
default-denied to every client, and the account page learns nothing from it
directly.

**The proactive part is a response header.** Resend returns
`x-resend-daily-quota` — the quota *used* today — on ordinary **successful**
responses, so DataPipe learns it is at 94/100 while sending still works rather
than by failing. Verification stops at a ceiling (currently 90 of 100) while
upload-failure notifications keep going to the full limit. That asymmetry is the
point: a researcher waiting on a code can come back later, but a notification
that their data has stopped arriving is the only signal they get.

The header is documented as free-plan-only, so it disappears on a paid plan.
Absent reads as "no daily cap applies", which is correct — the reserve logic
turns itself off on upgrade instead of needing to be removed.

**When does it reopen?** Resend publishes no daily-reset time, and nothing here
depends on knowing one. `unavailableUntil` is set to the next UTC midnight as a
*ceiling*; what actually reopens sending is the sweeper landing a successful
send. The deferrable path probes, the realtime path only ever reads. If the real
reset is later than midnight UTC the sweeper's next attempt re-arms the breaker;
if it is earlier, the sweeper finds out first.

**What a researcher sees:** *"We can't send verification codes right now. Please
try again in a little while."* Deliberately vague, and deliberately the same
message for an exhausted quota, an unverified domain and a revoked key — the
cause is operational detail they cannot act on differently. The code-entry form
is not opened, because there is no code out there to enter, and the resend
cooldown is cleared so they can retry the moment it comes back.

**To force the feature open or shut by hand**, edit
`systemStatus/mail.unavailableUntil` (a Timestamp, or null). Useful for testing
the message, and for shutting off verification during a Resend incident without
a deploy.

## 6. Alerting: two metrics, no code

**You cannot email yourself that you are out of email.** Same account, same
quota. Alerting has to be out-of-band, which in practice means Cloud Monitoring
delivering it rather than DataPipe.

No code is needed — `mail-delivery.ts` already logs everything at error level.
Create log-based metrics on the functions' logs and alert on them:

| Match | Why |
|---|---|
| `MailConfigMissingError` | **First.** Every notification the deployment sends is being dropped. |
| `daily_quota_exceeded` | Sending has stopped. Reactive — it is already happening. |
| `mail-availability` + `dailyQuotaUsed` above ~80 | **The useful one.** Leading indicator, from the success-response header, while there is still time to act. |

Route them to a channel Google delivers — Slack, PagerDuty, or an email address
that is **not** on the `jspsych.org` sending domain, so an alert about mail
being broken does not depend on mail working.

Worth watching alongside, though neither needs an alert: `scheduled-mail-retry`
lines reporting a non-zero `agedOut` (notifications that expired undelivered),
and any accumulation of `delivery.state == "ERROR"` with `retryable == true`,
which is the sweeper's backlog.

## Not covered here

Firestore index changes (none expected — see the design doc §3.4/§7 on why
the existing `uploadQueue` composite index already serves the drain query;
confirm with `firebase firestore:indexes` before deploy anyway) are addressed
in the main design doc, not here.

Function secrets: the contact-email feature itself adds none — verification
codes are SHA-256 hashed, not encrypted, and `TOKEN_ENCRYPTION_KEY` is
untouched. The `RESEND_API_KEY` secret in §2(d) belongs to **delivery**, which
was the extension's job when that sentence was written and is now
`functions/src/mail-delivery.ts`'s.
