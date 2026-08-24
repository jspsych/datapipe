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

## 2. Amazon SES setup

> **This section replaced the Trigger Email extension.** The plan was
> `firebase/firestore-send-email`; that platform is deprecated, so delivery now
> lives in this repo — `functions/src/mail-delivery.ts`, a Firestore
> `onDocumentCreated("mail/{id}")` trigger deployed as `onmailcreated`, sending
> through the Amazon SES v2 API directly (no SMTP, no nodemailer).
>
> **Nothing on the write side changed.** `functions/src/mail.ts` still owns the
> document shape, and `mail-delivery.ts` still writes the extension's outcome
> fields (`delivery.state`, `delivery.attempts`, `delivery.startTime`,
> `delivery.endTime`, `delivery.error`, `delivery.info.messageId`), so §4's TTL
> policy and every test that reads the `mail` collection are unaffected. What
> changed is that there is no longer an extension to install, and no
> `SMTP_CONNECTION_URI` — the credentials are ordinary function env vars,
> plumbed exactly like `TOKEN_ENCRYPTION_KEY` already is.

### (a) Verify the sending domain, and publish its DKIM records

In the SES console → **Verified identities** → *Create identity* → **Domain**,
enter the sending domain (`jspsych.org` — the org domain, which covers every
subdomain, so `pipe.jspsych.org` needs no separate identity), and leave **Easy DKIM** on
(RSA_2048). SES then hands back **three CNAME records**:

```
<token1>._domainkey.jspsych.org  CNAME  <token1>.dkim.amazonses.com
<token2>._domainkey.jspsych.org  CNAME  <token2>.dkim.amazonses.com
<token3>._domainkey.jspsych.org  CNAME  <token3>.dkim.amazonses.com
```

Publish all three in DNS. Verification usually completes within an hour;
the identity's status must read **Verified** before anything is sent.

Two optional-but-recommended records while you have DNS open:

- **A custom MAIL FROM domain** (e.g. `mail.jspsych.org`), which needs an
  MX record pointing at `feedback-smtp.<region>.amazonses.com` and a TXT
  record `"v=spf1 include:amazonses.com ~all"`. This is what makes SPF align
  with the From domain; without it, SES sends SPF-aligned to
  `amazonses.com` and only DKIM carries alignment.
- **A DMARC record** on the org domain: `_dmarc.jspsych.org  TXT
  "v=DMARC1; p=none; rua=mailto:<an address you read>"`. Start at `p=none`;
  it reports without rejecting.

**The spam warning still stands, and it is the reason this step is first.**
Without DKIM (and ideally SPF alignment) in place, a meaningful share of these
notifications will land in spam or be silently dropped — and because this
feature exists specifically to reach a researcher whose data has stopped
arriving, a notification nobody sees is functionally the same as no
notification at all. This needs DNS access to `jspsych.org`. Confirm the
records are in place (or in progress) before flipping this on in prod, and
leave the SES secrets unset in the interim rather than sending unauthenticated
mail from a new address — an unset secret is a loud, recorded failure (see (d)),
not a silent one.

### (b) Leave the SES sandbox

A new SES account is in the **sandbox**: it can only send *to* verified
addresses, and is capped at 200 messages/day. Every notification to a real
researcher would be rejected with `MessageRejected` ("Email address is not
verified"), which `mail-delivery.ts` classifies as **permanent** — the mail is
not retried, it is marked terminally failed. So a production deploy that skips
this step does not degrade gracefully; it fails every send.

SES console → **Account dashboard** → *Request production access*. The request
asks for the use case; the honest answer is short and is what gets approved:
transactional-only mail, to addresses the recipient entered themselves on their
own account page, one notification per experiment per 24 hours maximum
(`RATE_LIMIT_MS` in `upload-failure-notify.ts`), plus verification codes the
recipient just asked for. No marketing, no lists, no purchased addresses.
Mention that bounces and complaints are visible because the sending volume is
tiny. Turnaround is typically one business day.

Sanity-check the granted **sending quota** afterwards. DataPipe's steady-state
volume is minuscule, but the burst case is real: an outage at a storage
provider can put many experiments into a failure episode at once.

### (c) An IAM user scoped to `ses:SendEmail`, and nothing else

Cloud Functions has no way to assume an AWS role, so this is a long-lived
access key. Keep it worth as little as possible:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendOnlyFromDataPipeIdentity",
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:<region>:<account-id>:identity/jspsych.org",
      "Condition": {
        "StringEquals": {
          "ses:FromAddress": "datapipe-notifications@jspsych.org"
        }
      }
    }
  ]
}
```

Create the IAM user with **no console access**, attach only this policy, and
create one access key. `ses:SendEmail` covers the v2 `SendEmail` call this code
makes; `ses:SendRawEmail` is *not* needed (nothing here sends raw MIME), and
neither is any `ses:Get*`/`ses:List*` — the function never reads SES state.
The `Resource` and the `ses:FromAddress` condition are what stop a leaked key
from being used to send as anything other than DataPipe.

### (d) Three repo secrets, two literals, and the workflows that write them

The credentials reach the functions as ordinary environment variables in
`functions/.env`, written at deploy time from GitHub repo secrets — the same
mechanism `TOKEN_ENCRYPTION_KEY` already uses. There is no Secret Manager
entry and no extension config to keep in sync.

| Function env var | Secret? | Production value from | Test value from |
|---|---|---|---|
| `SES_REGION` | yes (repo secret) | `PROD_SES_REGION` | `TEST_SES_REGION` |
| `SES_ACCESS_KEY_ID` | yes (repo secret) | `PROD_SES_ACCESS_KEY_ID` | `TEST_SES_ACCESS_KEY_ID` |
| `SES_SECRET_ACCESS_KEY` | yes (repo secret) | `PROD_SES_SECRET_ACCESS_KEY` | `TEST_SES_SECRET_ACCESS_KEY` |
| `MAIL_FROM` | no — literal in the workflow | `DataPipe <datapipe-notifications@jspsych.org>` | `DataPipe (test) <datapipe-notifications@jspsych.org>` — same verified address, display name marks it as test |
| `MAIL_REPLY_TO` | no — literal in the workflow | `datapipe@jspsych.org` | `datapipe@jspsych.org` |

So: **three new repo secrets per environment** (region, access key id, secret
access key), six in total, named in the repo's existing
`PROD_*`/`TEST_*` style (`PROD_CLIENT_SECRET`, `TEST_GDRIVE_CLIENT_SECRET`, …).
The region is a secret rather than a literal only so that prod and test can
point at different SES accounts without editing a workflow.

They are written in the **`Create functions environment file`** step of:

- `.github/workflows/firebase-deploy.yml` (production, on push to `main`)
- `.github/workflows/firebase-deploy-test.yml` (test site, on push to `test`)

immediately after the `TOKEN_ENCRYPTION_KEY` line. `MAIL_FROM` and
`MAIL_REPLY_TO` are plain literals in the same block, like `REDIRECT_URI`.
`.github/workflows/node.js.yml` (CI) deliberately writes **none** of them — see
"What happens without configuration" below.

`MAIL_FROM` must be an address on the SES-verified identity from (a), and it
must match the `ses:FromAddress` condition in (c). `MAIL_REPLY_TO` is a
forwarding alias on `jspsych.org` that reaches the operating team; it is optional (mail with
no Reply-To is deliverable, mail with a bad one is not).

**What happens without configuration.** Missing or blank SES config is a
**terminal** delivery error with the distinct name `MailConfigMissingError`,
written onto the mail document (`delivery.error.name`, and
`delivery.error.message` naming the missing keys) and logged at error level
naming the keys — never their values. Mail never silently vanishes, but note
that terminal means terminal: **documents that failed this way are not retried
once the config is fixed.** Re-drive them by deleting the `delivery` field, or
accept the loss. Grep production logs for `MailConfigMissingError`; it is the
single line worth alerting on, because it means every notification the
deployment sends is being dropped.

**The test site and the emulator.**

- **`datapipe-test`**: leaving the three `TEST_SES_*` secrets unset is the safe
  default — the trigger records `MailConfigMissingError` and mails nobody, which
  is visible rather than silent. If you do want the test site to send, the
  `TEST_SES_*` credentials must belong to an SES account (or the production
  one, with a separate IAM user) in which `jspsych.org` is a verified identity,
  because the test `MAIL_FROM` is `datapipe-notifications@jspsych.org` too —
  an address on `datapipe-test.web.app` can never be verified and was rejected
  by SES. If that account is still in the SES sandbox it can only deliver
  *to* verified recipient addresses as well.
- **The emulator (and therefore CI)**: `onmailcreated` checks
  `FUNCTIONS_EMULATOR` and returns before doing anything at all — no read, no
  write, no send. Un-delivered mail in an emulator run is expected, exactly as
  it was when the extension (which also never ran against the emulator) was the
  plan. This gate is also what keeps the live trigger from racing the test
  suites' `mail` fixtures under `firebase emulators:exec`; see the header of
  `functions/src/__tests__/mail-delivery-emulator.test.js`.

### (e) Region

Pick one region and keep the identity, the IAM policy's `Resource` ARN, and
`SES_REGION` in agreement — a verified identity exists **per region**, and an
identity verified in `us-east-1` does not exist in `us-west-2`.

`us-east-2` is this deployment's region -- the AWS project lives there, so the identity, the IAM user, and `SES_REGION` all say `us-east-2`. (Historically `us-east-1` was the SES default suggestion,
it is the region most SES documentation and tooling assumes, and it is closest
to the functions' own `us-central1`, which keeps the cross-region hop on the
send negligible. There is no data-residency argument to weigh here — the only
personal data crossing to AWS is the recipient address and the message body,
and both are transient.

Whatever you choose, it must match on all three of: the verified identity, the
`arn:aws:ses:<region>:...` in the IAM policy, and `PROD_SES_REGION` /
`TEST_SES_REGION`.

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
   `FIREBASE_PROJECT_ID` (default `datapipe-prod`); `USE_LOCAL_SERVICE_ACCOUNT`
   for a local service-account file against `datapipe-test`; otherwise it
   points at the Firestore *and* Auth emulators (`localhost:8080` /
   `localhost:9099`) against `datapipe-test`. Double-check
   `FIREBASE_PROJECT_ID` before running with `--apply` against a real project.

4. **Rollout sequencing.** Per the design doc: ship the schema + notification
   pipeline + this backfill *before* shipping the account-page gate. That way
   notifications already work for everyone who has a usable address, and the
   backfill has already cleared most of the population that would otherwise
   hit the gate on their very next visit.

## 4. Mail retention: the TTL policy is now a MANUAL step

`mail` documents hold a researcher's address (in `to`) and, after delivery, the
audit trail `mail-delivery.ts` writes (`delivery.state`, `delivery.attempts`,
`delivery.error`, `delivery.info`). They should not accumulate indefinitely.

**This is the one thing the extension used to configure for you and now nobody
does.** There is no install step that creates the TTL policy any more, and
`mail-delivery.ts` cannot create one — a TTL policy is project configuration,
not something an SDK write can set. If this step is skipped, `mail` grows
unbounded forever, holding researcher addresses, and nothing else will catch
it. Create it by hand, once per project:

```
gcloud firestore fields ttls update 'delivery.expireAt' \
  --collection-group=mail \
  --enable-ttl \
  --database='(default)' \
  --project=datapipe-prod
```

(Console equivalent: Firestore → **Time-to-live (TTL)** → *Create policy* →
collection group `mail`, timestamp field `delivery.endTime`.) Repeat with
`--project=datapipe-test`. Confirm afterwards with:

```
gcloud firestore fields ttls list --collection-group=mail --project=datapipe-prod
```

Three things about this policy that are worth knowing before you run it:

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

## Not covered here

Firestore index changes (none expected — see the design doc §3.4/§7 on why
the existing `uploadQueue` composite index already serves the drain query;
confirm with `firebase firestore:indexes` before deploy anyway) are addressed
in the main design doc, not here.

Function secrets: the contact-email feature itself adds none — verification
codes are SHA-256 hashed, not encrypted, and `TOKEN_ENCRYPTION_KEY` is
untouched. The three `*_SES_*` secrets in §2(d) belong to **delivery**, which
was the extension's job when that sentence was written and is now
`functions/src/mail-delivery.ts`'s.
