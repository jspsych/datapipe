import { FieldValue } from "firebase-admin/firestore";
import { db } from "./app.js";

// The one and only place DataPipe writes outbound mail.
//
// Delivery is the Firebase "Trigger Email" extension
// (firebase/firestore-send-email), which watches the `mail` collection and
// sends what it finds. Nothing in this codebase knows an SMTP host, a
// provider, or a credential: the connection URI is extension configuration in
// Secret Manager and is chosen at DEPLOY time, not here. Switching providers
// is a config change, not a redeploy of these functions.
//
// Why an extension rather than nodemailer inside the functions: it keeps a
// mail transport out of the same process that writes research data, it gets
// retries and a `delivery.{state,attempts,error}` audit trail for free, and it
// makes every test that touches this path assertable with no network and no
// mock -- the emulator has no extension, so tests read the `mail` collection
// and check that the right document appeared. That document IS the contract
// DataPipe owns; delivery is the extension's.
//
// `mail` needs no entry in firestore.rules. Firestore default-denies every
// unmatched path, so the collection is already invisible and unwritable from
// any client. Stated here, and in firestore.rules, so nobody "fixes" it later
// by adding a permissive rule.

export const MAIL_COLLECTION = "mail";

export interface MailMessage {
  // Single recipient. The extension accepts a string or an array; we always
  // write an array, so the shape is uniform for tests and for purge queries.
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// Written under a `datapipe` key that the extension ignores (it only reads
// `to`/`cc`/`bcc`/`message`/`template`). Two jobs: telling one kind of mail
// from another when debugging, and giving purge-user-data.ts something to
// query on -- `datapipe.owner == uid` is served by an automatic single-field
// index, so account deletion can find and delete a researcher's queued mail
// without leaving their address behind.
export interface MailMeta {
  // Discriminator, e.g. "upload-failure" or "contact-email-verification".
  kind: string;
  // Owning user's uid. Always set it: this is the purge handle.
  owner?: string;
  experimentID?: string;
  [key: string]: unknown;
}

interface MailInput extends MailMessage {
  meta: MailMeta;
}

function mailDocument({ to, subject, text, html, meta }: MailInput) {
  return {
    to: [to],
    message: html === undefined ? { subject, text } : { subject, text, html },
    datapipe: { ...meta, queuedAt: FieldValue.serverTimestamp() },
  };
}

// A fresh, unwritten document reference in the mail collection. Callers that
// enqueue inside a transaction need the ref BEFORE the transaction body runs
// (a transaction may not allocate ids mid-flight), so this is separate from
// enqueueMail.
export function newMailRef(): FirebaseFirestore.DocumentReference {
  return db.collection(MAIL_COLLECTION).doc();
}

// Transactional enqueue. The mail document is created as part of the caller's
// commit, so the mail and whatever flag records that it was sent land together
// or not at all -- there is no window in which a researcher is mailed but the
// "already told them" flag is lost, which would mail them again on the next
// failure.
//
// tx.create (not set) is deliberate: the ref comes from newMailRef() and is
// therefore new, so a create is a cheap assertion that we are not overwriting
// an unsent message.
export function enqueueMail(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  input: MailInput
): void {
  tx.create(ref, mailDocument(input));
}

// Non-transactional enqueue, for senders with nothing to keep consistent with
// the send (the contact-email verification code, which is a direct response to
// a request the researcher just made). Returns the ref so the caller can log
// or assert on it.
export async function sendMail(
  input: MailInput
): Promise<FirebaseFirestore.DocumentReference> {
  const ref = newMailRef();
  await ref.create(mailDocument(input));
  return ref;
}

// ---------------------------------------------------------------------------
// Recipient resolution.
//
// MIRROR of lib/contact-email.js -- keep the two in sync. They cannot be one
// file: functions/ is a separate package whose tsconfig rootDir is ./src, and
// its deploy bundle contains only functions/, so a root-level lib/ import
// would neither compile nor deploy. The same two constraints (the synthetic
// OSF pattern and the 254-character cap) are also restated in firestore.rules.
// ---------------------------------------------------------------------------

export const MAX_CONTACT_EMAIL_LENGTH = 254;

// oauth2-callback.ts's `user-${osfUserId}@osf.io` fallback, which is sitting
// in real user documents' `email` field today and is undeliverable.
const OSF_SYNTHETIC_EMAIL_PATTERN = /^user-[a-z0-9]+@osf\.io$/i;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// The address to mail, or null when this user has none we can reach. Callers
// must treat null as "suppress and record why", never as "skip silently":
// twenty derived files failing at once would otherwise open twenty
// transactions and decide nothing.
export function contactEmailRecipient(
  userData: FirebaseFirestore.DocumentData | undefined
): string | null {
  const v = normalize(userData?.contactEmail);
  if (v.length === 0 || v.length > MAX_CONTACT_EMAIL_LENGTH) return null;
  if (!EMAIL_FORMAT.test(v)) return null;
  if (OSF_SYNTHETIC_EMAIL_PATTERN.test(v)) return null;
  return v;
}

export function hasContactEmail(
  userData: FirebaseFirestore.DocumentData | undefined
): boolean {
  return contactEmailRecipient(userData) !== null;
}
