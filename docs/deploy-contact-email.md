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

## 2. Trigger Email extension install

DataPipe sends no mail directly — every notification is a document written to
the `mail` collection (`functions/src/mail.ts`), and the Firebase "Trigger
Email" extension (`firebase/firestore-send-email`) is the only thing that
turns those documents into delivered mail.

```
firebase ext:install firebase/firestore-send-email --project=<prod>
```

Configuration:

| Setting | Value |
|---|---|
| `MAIL_COLLECTION` | `mail` |
| `SMTP_CONNECTION_URI` | Secret Manager — **never a config literal**. SMTP provider is chosen at install time (Owner question 1 in the design doc: Amazon SES or Brevo were the candidates); whichever is picked, the connection string goes in Secret Manager, not `extensions/*.env`. |
| `DEFAULT_FROM` | `DataPipe <notifications@pipe.jspsych.org>` (or whatever sending address was decided) |
| `DEFAULT_REPLY_TO` | The contact address already used by `pages/contact.js` |
| Location | Match the existing functions region (`us-central1`) |

**SPF/DKIM warning.** The sending domain needs SPF and DKIM records before
this extension goes live in production. Without them, a meaningful share of
these notifications will land in spam or be silently dropped — and because
this feature exists specifically to reach a researcher whose data has stopped
arriving, a notification nobody sees is functionally the same as no
notification at all. This needs DNS access to `jspsych.org`; confirm the
records are in place (or in progress) before flipping this on in prod. Do not
install the production SMTP config until DNS is ready — install with a
placeholder or leave the extension config unset in the interim rather than
sending unauthenticated mail from a new address.

**Install in `datapipe-test` too**, or accept that staging queues `mail`
documents that are never delivered. Un-delivered mail in the emulator/staging
project is not a bug — the extension does not run against the emulator at
all, which is why the test suites assert on the `mail` collection directly
rather than mocking a transport.

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

## 4. Extension TTL / mail retention

`mail` documents hold a researcher's address (in `to`) and, after delivery,
the extension's own audit trail (`delivery.state`, `delivery.attempts`,
`delivery.error`). They should not accumulate indefinitely:

- Configure the extension's Firestore TTL policy: **TTL field
  `delivery.endTime`, TTL value 30 days.** Processed mail documents
  self-delete a month after the extension finishes with them; this is a
  Firestore TTL policy on the `mail` collection, set once at extension
  install/config time, not something DataPipe's own code manages.
- This TTL is a backstop, not the only cleanup path. Account deletion
  (`functions/src/purge-user-data.ts`) also deletes a purged user's `mail`
  documents directly (queried on `datapipe.owner == uid`) and their
  `contactEmailVerifications/{uid}` doc, so a deleted account's mail does not
  wait out the 30-day TTL — it is gone as part of the same purge pass that
  removes their experiments and queue entries.
- If the TTL policy is ever missed at install time, `mail` will grow
  unbounded — it is not covered by any other retention mechanism.

## Not covered here

Firestore index changes (none expected — see the design doc §3.4/§7 on why
the existing `uploadQueue` composite index already serves the drain query;
confirm with `firebase firestore:indexes` before deploy anyway) and function
secrets (none new — verification codes are SHA-256 hashed, not encrypted, and
`TOKEN_ENCRYPTION_KEY` is untouched) are addressed in the main design doc, not
here.
