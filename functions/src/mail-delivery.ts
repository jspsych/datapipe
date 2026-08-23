// Delivery for the `mail` collection: the thing that turns a mail document
// into a sent email.
//
// mail.ts writes those documents and owns their shape; this file consumes
// that shape and NEVER changes it. The two writers are
// upload-failure-notify.ts (transactional, inside the episode transaction)
// and send-contact-email-verification.ts (direct).
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL
// ---------------------------------------------------------------------------
//
// The plan was the Firebase "Trigger Email" extension
// (firebase/firestore-send-email). That platform is deprecated, so delivery
// moves in-repo, on Amazon SES via the AWS API directly -- no SMTP, no
// nodemailer. mail.ts's header still describes the extension; its DOCUMENT
// contract is unchanged and still authoritative, which is the whole reason
// the swap costs nothing on the write side.
//
// The outcome fields written below are deliberately the extension's:
// `delivery.state`, `delivery.attempts`, `delivery.startTime`,
// `delivery.endTime`, `delivery.error`, `delivery.info.messageId`. Every
// downstream decision that was ever going to be made from an extension-shaped
// document still works -- including the Firestore TTL policy, which keys on
// `delivery.endTime` (docs/deploy-contact-email.md §4). Nothing new is added
// at the top level of the document, so purge-user-data.ts's
// `datapipe.owner == uid` query is untouched: everything here lives under
// `delivery`.
//
// ---------------------------------------------------------------------------
// AT-LEAST-ONCE IS THE ENTIRE PROBLEM
// ---------------------------------------------------------------------------
//
// Firestore triggers are at-least-once. The same create event can be
// delivered more than once, and a delivery can arrive while a previous one is
// still running. A naive handler therefore sends the same mail twice -- and a
// duplicate "your uploads are failing" email is precisely the annoyance the
// notification feature was built to prevent (upload-failure-notify.ts spends
// its entire header on not crying wolf; sending its one carefully-rationed
// mail twice would undo that work at the last hop).
//
// So nothing is sent until the document has been CLAIMED in a transaction:
//
//   delivery absent                     -> claim  (this is the normal path)
//   delivery.state == PROCESSING, lease live      -> skip, send nothing
//   delivery.state == PROCESSING, lease expired   -> claim (crashed claim)
//   delivery.state == SUCCESS                     -> skip, send nothing
//   delivery.state == ERROR, retryable            -> claim
//   delivery.state == ERROR, not retryable        -> skip, send nothing
//   attempts >= MAX_ATTEMPTS                      -> skip, send nothing
//
// The claim writes a `leaseOwner` id, and the terminal write is itself a
// transaction that refuses to write unless the lease is still ours. A slow
// invocation that lost its lease to a stale-lease takeover therefore cannot
// stomp the newer attempt's result.
//
// WHO RETRIES A RETRYABLE ERROR. `onDocumentCreated` does not re-fire when a
// document is updated, so a retryable ERROR is not retried on a timer. Its
// retriers are (a) at-least-once redelivery of the same create event, which
// is exactly the duplicate this file is built to survive and which here does
// something useful, and (b) an operator re-drive (clear `delivery` on the
// document). The flag exists so the document says plainly whether it is still
// deliverable. Deliberately NOT taken: `retry: true` plus a throw, which
// would let Cloud Functions replay a failing mail send for up to seven days
// -- a crash-looping mail transport is worse than a mail that needs a human.
// See upload-failure-notify.ts's closing comment for the same trade.

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { db } from "./app.js";
import { MAIL_COLLECTION } from "./mail.js";

// ---------------------------------------------------------------------------
// Timings. The relationship between these three numbers is load-bearing.
// ---------------------------------------------------------------------------

// Hard ceiling on one SES call. SES answers in well under a second in the
// normal case; ten seconds is "the network eating the request", not "SES is
// thinking".
export const SES_TIMEOUT_MS = 10 * 1000;

// The function's own timeout. Nothing here holds data -- one document read,
// one HTTPS call, one document write -- so this is generous by an order of
// magnitude, and its real job is to be the hard upper bound on how long an
// invocation can possibly still be running.
export const FUNCTION_TIMEOUT_SECONDS = 60;

// How long a claim is honored before another invocation may take it over.
//
// WHY 5 MINUTES AND NOT 30 SECONDS. The lease exists for exactly one case: an
// invocation that claimed the document and then died (OOM, instance
// preemption, a deploy mid-flight) without writing a terminal state. Its
// value trades two failures against each other:
//
//   too SHORT -> a second invocation takes over a claim whose original owner
//                is still alive and still inside client.send(). Both send.
//                That is the double-send this whole file exists to prevent.
//   too LONG  -> a genuinely crashed claim sits undelivered for that long.
//
// The floor is therefore the longest an invocation can still be running after
// it claimed, and that is bounded by the FUNCTION timeout (60s), not by the
// SES timeout (10s): past 60 seconds the platform has killed the invocation,
// so it is provably not in client.send() any more. 5 minutes is 5x that
// bound, which absorbs clock skew between instances and any future increase
// of the function timeout short of five minutes. The cost of the choice is
// that a crashed claim waits up to five minutes -- irrelevant for mail whose
// own trigger (upload-failure-notify) already deliberately waits ~5 minutes
// before deciding to send at all.
//
// If FUNCTION_TIMEOUT_SECONDS is ever raised above ~4 minutes, raise this too.
export const LEASE_MS = 5 * 60 * 1000;

// Terminal mail documents (delivered or permanently failed) self-delete this
// long after their outcome, via the Firestore TTL policy on
// `delivery.expireAt` (docs/deploy-contact-email.md §4). Seven days matches
// the product's other retention clocks.
export const MAIL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Total sends attempted for one mail document, across all invocations. Three
// is enough to ride out a throttle and small enough that a persistently
// broken address cannot spin. Reaching it is terminal.
export const MAX_ATTEMPTS = 3;

// Contention budget for the claim transaction. Above the Admin SDK's default
// of 5, well below upload-failure-notify.ts's 25 -- the contenders here are
// duplicate deliveries of ONE create event (a handful at most), not twenty
// derived-file failures converging on one experiment document. The losers also
// stop being writers as soon as the winner commits: they re-read PROCESSING
// and return without touching anything. Giving up would mean losing the mail,
// and attempts are cheap.
const TRANSACTION_ATTEMPTS = 10;

// ---------------------------------------------------------------------------
// Configuration. Read from process.env LAZILY, per invocation -- the same
// convention crypto-utils.ts / payload-crypto.ts use for TOKEN_ENCRYPTION_KEY,
// and for the same reason: tests set these after module load.
//
// The three secret values are written into functions/.env by the deploy
// workflows from repo secrets, exactly as TOKEN_ENCRYPTION_KEY already is
// (.github/workflows/firebase-deploy.yml, firebase-deploy-test.yml). MAIL_FROM
// and MAIL_REPLY_TO are not secret and are written as literals in the same
// block. See docs/deploy-contact-email.md §2.
// ---------------------------------------------------------------------------

export const REQUIRED_CONFIG_KEYS = [
  "SES_REGION",
  "SES_ACCESS_KEY_ID",
  "SES_SECRET_ACCESS_KEY",
  "MAIL_FROM",
] as const;

export interface MailConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  // "DataPipe <notifications@pipe.jspsych.org>" -- the extension's DEFAULT_FROM.
  from: string;
  // The extension's DEFAULT_REPLY_TO. Optional: mail with no Reply-To is
  // deliverable, mail with a bad one is not.
  replyTo?: string;
}

/**
 * Which required config keys are missing or blank. Names only, never values --
 * this list ends up in a log line and in the error written to the document.
 */
export function missingConfigKeys(
  env: Record<string, string | undefined> = process.env
): string[] {
  return REQUIRED_CONFIG_KEYS.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

export function readMailConfig(
  env: Record<string, string | undefined> = process.env
): MailConfig {
  const replyTo = env.MAIL_REPLY_TO?.trim();
  return {
    region: (env.SES_REGION ?? "").trim(),
    accessKeyId: (env.SES_ACCESS_KEY_ID ?? "").trim(),
    secretAccessKey: (env.SES_SECRET_ACCESS_KEY ?? "").trim(),
    from: (env.MAIL_FROM ?? "").trim(),
    ...(replyTo ? { replyTo } : {}),
  };
}

// ---------------------------------------------------------------------------
// The SES request, built from the mail document.
// ---------------------------------------------------------------------------

interface SesContentPart {
  Data: string;
  Charset: string;
}

// SESv2 SendEmailCommand input, "Simple" content. Declared structurally rather
// than imported from the SDK so this shape is assertable in a pure test with
// no AWS package loaded at all.
export interface SendEmailInput {
  FromEmailAddress: string;
  Destination: { ToAddresses: string[] };
  ReplyToAddresses?: string[];
  Content: {
    Simple: {
      Subject: SesContentPart;
      Body: { Text: SesContentPart; Html?: SesContentPart };
    };
  };
}

const CHARSET = "UTF-8";

// A mail document that cannot be turned into a request. Permanent by
// definition: no amount of retrying fixes a missing recipient.
export const INVALID_DOCUMENT_ERROR = "MailDocumentInvalidError";
// Distinct, loud, and searchable in logs. See deliverMailDocument.
export const CONFIG_MISSING_ERROR = "MailConfigMissingError";

export class MailInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = INVALID_DOCUMENT_ERROR;
  }
}

// mail.ts always writes `to` as an array; the extension contract also allowed
// a bare string, and a hand-written document may well be one. Accept both, and
// drop anything that is not a non-empty string rather than handing SES a
// `null` recipient.
function recipients(to: unknown): string[] {
  const list: unknown[] = Array.isArray(to) ? (to as unknown[]) : [to];
  return list
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * mail document -> SESv2 SendEmailCommand input.
 *
 * Pure, and exported for it: this mapping is where a silent wrong-From or a
 * dropped html part would hide, and it needs no emulator and no AWS package to
 * assert.
 */
export function buildSendEmailInput(
  data: FirebaseFirestore.DocumentData,
  config: MailConfig
): SendEmailInput {
  const to = recipients(data?.to);
  if (to.length === 0) {
    throw new MailInputError("mail document has no usable recipient");
  }

  const message = (data?.message ?? {}) as Record<string, unknown>;
  const subject = typeof message.subject === "string" ? message.subject : "";
  const text = typeof message.text === "string" ? message.text : "";
  const html = typeof message.html === "string" ? message.html : undefined;

  if (subject.length === 0 || text.length === 0) {
    throw new MailInputError(
      "mail document is missing message.subject or message.text"
    );
  }

  const input: SendEmailInput = {
    FromEmailAddress: config.from,
    Destination: { ToAddresses: to },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: CHARSET },
        // Text always, Html only when the document carries one -- mail.ts
        // omits `html` entirely for text-only mail, and an empty Html part is
        // not the same thing as no Html part to a mail client.
        Body: {
          Text: { Data: text, Charset: CHARSET },
          ...(html ? { Html: { Data: html, Charset: CHARSET } } : {}),
        },
      },
    },
  };
  if (config.replyTo) {
    input.ReplyToAddresses = [config.replyTo];
  }
  return input;
}

// ---------------------------------------------------------------------------
// Error taxonomy.
// ---------------------------------------------------------------------------

export interface ClassifiedError {
  name: string;
  message: string;
  retryable: boolean;
}

// Permanent. Retrying changes nothing; a human has to change something.
// MessageRejected is the bad-address case, the rest are configuration and
// account problems.
const PERMANENT_ERRORS = new Set([
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "AccountSuspendedException",
  "SendingPausedException",
  "NotFoundException",
  "BadRequestException",
  "ValidationException",
  "InvalidParameterValue",
  "InvalidParameterValueException",
  "AccessDeniedException",
  "AccessDenied",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "SignatureDoesNotMatch",
  "InvalidSignatureException",
  "ExpiredTokenException",
  "CredentialsProviderError",
  "IncompleteSignature",
  "OptInRequired",
  INVALID_DOCUMENT_ERROR,
  CONFIG_MISSING_ERROR,
]);

// Transient. SES answered, and its answer was "not now".
const TRANSIENT_ERRORS = new Set([
  "TooManyRequestsException",
  "ThrottlingException",
  "Throttling",
  "RequestThrottled",
  "RequestThrottledException",
  "SlowDown",
  "LimitExceededException",
  "ServiceUnavailable",
  "ServiceUnavailableException",
  "InternalServiceErrorException",
  "InternalFailure",
  "InternalServerError",
]);

// AMBIGUOUS: the request went out and no answer came back. SES may or may not
// have accepted the message, and SESv2 SendEmail has no idempotency token that
// would let a retry be safe.
//
// These are treated as TERMINAL, not retryable, and that is a deliberate
// asymmetry rather than an oversight. Retrying an ambiguous send is a coin
// flip on delivering a second copy of a notification whose whole value is that
// it arrives once; not retrying loses at most one mail, LOUDLY -- the error
// name is preserved on the document and logged at error level, so it is
// visible and re-drivable by hand, never silent. Given the choice the feature
// itself already made (upload-failure-notify.ts: one mail per episode, a
// 24-hour floor, and an explicit preference for saying nothing over saying it
// twice), losing the coin flip in the quiet direction is the consistent call.
const AMBIGUOUS_ERRORS = new Set([
  "TimeoutError",
  "RequestTimeout",
  "RequestTimeoutException",
  "AbortError",
  "ECONNRESET",
  "EPIPE",
  "ECONNABORTED",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
]);

// Never connected at all, so nothing can have been sent. Safe to retry,
// unlike the ambiguous set above -- the distinction is the whole reason these
// are not one list.
const NEVER_CONNECTED_ERRORS = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function errorName(error: unknown): string {
  if (error === null || typeof error !== "object") return "UnknownError";
  const e = error as { name?: unknown; code?: unknown };
  // `!== "Error"` because a bare `new Error(...)` carries no diagnosis at all;
  // its node-style `code` (ECONNRESET and friends) is the useful signal.
  if (typeof e.name === "string" && e.name.length > 0 && e.name !== "Error") {
    return e.name;
  }
  if (typeof e.code === "string" && e.code.length > 0) {
    return e.code;
  }
  return "UnknownError";
}

/**
 * Classify a failed send.
 *
 * Never returns a stack. `message` is the SES/SDK message text, which
 * describes the refusal ("Email address is not verified"), not the payload --
 * a stack here would end up in a Firestore document and in a log line, and
 * neither is a place for one.
 */
export function classifySesError(error: unknown): ClassifiedError {
  const name = errorName(error);
  const raw = (error as { message?: unknown })?.message;
  const message =
    typeof raw === "string" && raw.length > 0 ? raw.slice(0, 500) : "Unknown error";

  // Explicit names win over status codes: SES returns some permanent refusals
  // with unhelpful status codes, and the name is the precise signal.
  if (PERMANENT_ERRORS.has(name)) return { name, message, retryable: false };
  if (AMBIGUOUS_ERRORS.has(name)) return { name, message, retryable: false };
  if (NEVER_CONNECTED_ERRORS.has(name)) return { name, message, retryable: true };
  if (TRANSIENT_ERRORS.has(name)) return { name, message, retryable: true };

  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  if (typeof status === "number") {
    // 429 and 5xx: SES answered and declined to do the work now.
    if (status === 429 || status >= 500) return { name, message, retryable: true };
    // Any other 4xx is a refusal of THIS request, and it will refuse it again.
    if (status >= 400) return { name, message, retryable: false };
  }

  // The SDK's own judgement, last, because it is coarser than the lists above.
  const retryableHint = (error as { $retryable?: unknown })?.$retryable;
  if (retryableHint) return { name, message, retryable: true };

  // Unknown, unnamed, no status. More likely a defect on our side than a blip
  // on SES's, so it does not get to consume the retry budget.
  return { name, message, retryable: false };
}

// ---------------------------------------------------------------------------
// The claim state machine.
// ---------------------------------------------------------------------------

export type ClaimDecision =
  | "claim"
  | "skip-in-flight"
  | "skip-delivered"
  | "skip-terminal"
  | "skip-attempts-exhausted";

export interface DeliveryRecord {
  state?: unknown;
  attempts?: unknown;
  retryable?: unknown;
  leaseExpiresAt?: unknown;
  startTime?: unknown;
  [key: string]: unknown;
}

// Defensive read of a stored Timestamp, in the same spirit as
// upload-failure-notify.ts's millisOrZero: a hand-edited or future-written
// value that is not a Timestamp must not throw inside a transaction.
function millisOrZero(value: unknown): number {
  if (!value || typeof (value as { toMillis?: unknown }).toMillis !== "function") {
    return 0;
  }
  return (value as { toMillis: () => number }).toMillis();
}

function attemptsOf(delivery: DeliveryRecord | undefined): number {
  const n = delivery?.attempts;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * May this invocation send?
 *
 * Pure, and the single source of truth for "do not send twice". Exported so
 * the table can be asserted directly rather than provoked through Firestore.
 */
export function claimDecision(
  delivery: DeliveryRecord | undefined,
  nowMs: number,
  options: { leaseMs?: number; maxAttempts?: number } = {}
): ClaimDecision {
  const leaseMs = options.leaseMs ?? LEASE_MS;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const state = delivery?.state;

  // Already delivered. The single most important row in this table.
  if (state === "SUCCESS") return "skip-delivered";

  if (state === "PROCESSING") {
    // Someone holds the claim and may be inside client.send() right now.
    if (millisOrZero(delivery?.leaseExpiresAt) > nowMs) return "skip-in-flight";
    // Lease expired: the claimant is provably dead (see LEASE_MS). Recoverable.
  } else if (state === "ERROR") {
    if (delivery?.retryable !== true) return "skip-terminal";
  } else if (state !== undefined && state !== null) {
    // A state this version does not know -- written by a newer deploy, or by
    // hand. Refuse rather than guess; sending is the irreversible option.
    return "skip-terminal";
  }

  // Applies to every claimable branch, including a fresh document with a
  // nonsense attempts count.
  if (attemptsOf(delivery) >= maxAttempts) return "skip-attempts-exhausted";

  return "claim";
}

// ---------------------------------------------------------------------------
// The transport seam.
// ---------------------------------------------------------------------------

export interface SendResult {
  MessageId?: string;
}

export type MailSender = (
  input: SendEmailInput,
  options: { timeoutMs: number }
) => Promise<SendResult>;

// The AWS SDK, described by what this file actually uses. Declared structurally
// so nothing here depends on the SDK's exact exported types, and so the module
// under test never has to load the package.
interface SesSdk {
  SESv2Client: new (config: Record<string, unknown>) => {
    send(command: unknown, options?: unknown): Promise<SendResult>;
  };
  SendEmailCommand: new (input: SendEmailInput) => unknown;
}

let injectedSender: MailSender | null = null;
let cachedSender: MailSender | null = null;
let cachedSenderKey = "";

/**
 * Test seam. Replaces the SES transport with a plain function.
 *
 * A function rather than a client object on purpose: it means no test in this
 * repo -- pure or emulator-backed -- ever loads @aws-sdk/client-sesv2, and it
 * means the mocked surface is exactly the one line of behaviour that matters
 * (an input goes in, a MessageId or a throw comes out). Pass null to restore.
 */
export function _setSesClientForTests(sender: MailSender | null): void {
  injectedSender = sender;
  cachedSender = null;
  cachedSenderKey = "";
}

async function getSender(config: MailConfig): Promise<MailSender> {
  if (injectedSender) return injectedSender;

  // Keyed so a credential rotation between invocations on a warm instance
  // builds a new client instead of reusing one signed with the old key.
  const key = `${config.region}:${config.accessKeyId}`;
  if (cachedSender && cachedSenderKey === key) return cachedSender;

  // Dynamic, not top-level: index.ts imports every module in this codebase, so
  // a top-level AWS import would be paid on the cold start of apidata --
  // DataPipe's hot path -- to send no mail at all.
  const sdk = (await import("@aws-sdk/client-sesv2")) as unknown as SesSdk;
  const client = new sdk.SESv2Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // The SDK's own retries are turned OFF. Attempts are counted on the
    // document and capped there; an invisible second attempt inside send()
    // would be a second send this file cannot see or bound.
    maxAttempts: 1,
  });

  cachedSender = async (input, { timeoutMs }) => {
    const controller = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => controller.abort(),
      timeoutMs
    );
    try {
      return await client.send(new sdk.SendEmailCommand(input), {
        abortSignal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  cachedSenderKey = key;
  return cachedSender;
}

// ---------------------------------------------------------------------------
// Delivery.
// ---------------------------------------------------------------------------

export type DeliveryOutcome =
  | "sent"
  | "retryable-error"
  | "terminal-error"
  | "skipped-in-flight"
  | "skipped-delivered"
  | "skipped-terminal"
  | "skipped-attempts-exhausted"
  | "gone";

const SKIP_OUTCOMES: Record<Exclude<ClaimDecision, "claim">, DeliveryOutcome> = {
  "skip-in-flight": "skipped-in-flight",
  "skip-delivered": "skipped-delivered",
  "skip-terminal": "skipped-terminal",
  "skip-attempts-exhausted": "skipped-attempts-exhausted",
};

interface Claim {
  data: FirebaseFirestore.DocumentData;
  attempts: number;
  leaseOwner: string;
}

// `any` rather than `unknown` for the same reason upload-failure-notify.ts
// gives: these objects go to tx.update, whose UpdateData resolves to an index
// signature of `any`, and they hold a mix of Timestamps, nulls and strings.
type Updates = Record<string, any>;

/**
 * Terminal / release write, guarded by the lease.
 *
 * A transaction and not a bare update: an invocation whose lease expired and
 * was taken over must not overwrite the newer attempt's result, and a document
 * that purge-user-data.ts deleted underneath us must not produce an error
 * (deleting a researcher's queued mail mid-flight is a legitimate,
 * expected event, not a fault).
 *
 * Returns false when the write did not happen.
 */
async function writeIfStillOurs(
  ref: FirebaseFirestore.DocumentReference,
  leaseOwner: string,
  updates: Updates
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const delivery = snap.data()?.delivery as DeliveryRecord | undefined;
    if (delivery?.leaseOwner !== leaseOwner) return false;
    tx.update(ref, updates);
    return true;
  }, { maxAttempts: TRANSACTION_ATTEMPTS });
}

/**
 * Deliver one mail document.
 *
 * ALWAYS RESOLVES. Every expected failure -- a bad address, missing
 * configuration, a throttle, a document deleted mid-flight -- is a returned
 * outcome and a field on the document, never a throw. The trigger below adds
 * a final catch for the unexpected, so a mail send can never crash-loop.
 *
 * Exported as the test seam this codebase already uses for trigger logic
 * (upload-failure-notify.ts's handleQueueWrite, scheduled-upload-retry.ts's
 * retryPendingUploads): tests drive it in-process instead of trying to provoke
 * real trigger deliveries out of the emulator.
 */
export async function deliverMailDocument(docId: string): Promise<DeliveryOutcome> {
  const ref = db.collection(MAIL_COLLECTION).doc(docId);
  const leaseOwner = randomUUID();

  // ---------------- CLAIM -------------------------------------------------
  // Serializable, so twenty concurrent deliveries of the same event produce
  // exactly one claim and nineteen skips. Nothing is sent before this commits.
  const claim = await db.runTransaction<
    Claim | Exclude<ClaimDecision, "claim"> | null
  >(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const data = snap.data() as FirebaseFirestore.DocumentData;
    const delivery = data.delivery as DeliveryRecord | undefined;
    const decision = claimDecision(delivery, Date.now());
    if (decision !== "claim") return decision;

    const now = Timestamp.now();
    const attempts = attemptsOf(delivery) + 1;
    const updates: Updates = {
      "delivery.state": "PROCESSING",
      "delivery.attempts": attempts,
      "delivery.leaseOwner": leaseOwner,
      "delivery.leaseExpiresAt": Timestamp.fromMillis(now.toMillis() + LEASE_MS),
      "delivery.error": null,
      "delivery.retryable": null,
      // The TTL policy keys on endTime (docs/deploy-contact-email.md §4).
      // Explicitly null while in flight so a document being retried cannot be
      // reaped out from under the retry.
      "delivery.endTime": null,
    };
    // startTime is when delivery FIRST began, so a retry does not move it --
    // this is the extension's semantics and it is what makes "how long did
    // this take to deliver" answerable.
    if (delivery?.startTime == null) {
      updates["delivery.startTime"] = now;
    }
    tx.update(ref, updates);
    return { data, attempts, leaseOwner };
  }, { maxAttempts: TRANSACTION_ATTEMPTS });

  if (claim === null) {
    // Deleted before we got to it -- purge-user-data.ts, or the TTL.
    return "gone";
  }
  if (typeof claim === "string") {
    return SKIP_OUTCOMES[claim];
  }

  // ---------------- CONFIG ------------------------------------------------
  // After the claim, deliberately: the document must record that DataPipe
  // tried and could not, rather than the mail evaporating with only a log line
  // behind it.
  const missing = missingConfigKeys();
  if (missing.length > 0) {
    // Loud, at error level, naming the KEYS and never their values. This is
    // the line to alert on: it means every notification this deployment sends
    // is being dropped on the floor.
    console.error(
      `mail-delivery: ${CONFIG_MISSING_ERROR} -- SES is not configured, mail ${docId} cannot be sent. Missing: ${missing.join(", ")}`
    );
    await finish(ref, claim, {
      name: CONFIG_MISSING_ERROR,
      message: `Missing configuration: ${missing.join(", ")}`,
      retryable: false,
    });
    return "terminal-error";
  }
  const config = readMailConfig();

  // ---------------- BUILD + SEND ------------------------------------------
  let input: SendEmailInput;
  try {
    input = buildSendEmailInput(claim.data, config);
  } catch (error) {
    const classified = classifySesError(error);
    console.error(
      `mail-delivery: ${docId} is not sendable (${classified.name}): ${classified.message}`
    );
    await finish(ref, claim, classified);
    return "terminal-error";
  }

  let result: SendResult;
  try {
    const send = await getSender(config);
    result = await send(input, { timeoutMs: SES_TIMEOUT_MS });
  } catch (error) {
    const classified = classifySesError(error);
    // The attempts cap is applied HERE and not in classifySesError, because
    // "retryable in principle" and "we are still willing to retry" are two
    // different facts and the document should be able to show both.
    const exhausted = claim.attempts >= MAX_ATTEMPTS;
    const retryable = classified.retryable && !exhausted;
    // No recipient in this line: the docId is the handle, and the neighbours
    // (upload-failure-notify.ts, send-contact-email-verification.ts) log ids
    // and uids, never addresses.
    console.error(
      `mail-delivery: ${docId} attempt ${claim.attempts}/${MAX_ATTEMPTS} failed (${classified.name}, ${
        retryable ? "retryable" : "terminal"
      }): ${classified.message}`
    );
    await finish(ref, claim, { ...classified, retryable });
    return retryable ? "retryable-error" : "terminal-error";
  }

  // ---------------- SUCCESS -----------------------------------------------
  const now = Timestamp.now();
  const wrote = await writeIfStillOurs(ref, claim.leaseOwner, {
    "delivery.state": "SUCCESS",
    "delivery.endTime": now,
    // The Firestore TTL policy keys on expireAt, not endTime: native TTL
    // deletes as soon as the timestamp passes, so keying on endTime would
    // mean "gone within a day of delivery". Seven days matches every other
    // retention clock in the product (queued payloads, recoverable
    // downloads) -- long enough to debug deliverability, short enough to
    // keep the address-retention promise.
    "delivery.expireAt": Timestamp.fromMillis(now.toMillis() + MAIL_RETENTION_MS),
    "delivery.leaseExpiresAt": null,
    "delivery.error": null,
    "delivery.retryable": false,
    "delivery.info": { messageId: result?.MessageId ?? null, transport: "ses" },
  });
  if (!wrote) {
    // The mail WAS sent. Only the receipt is missing -- either the document is
    // gone (purged), or a stale-lease takeover has already written its own.
    // Worth a line, because it is the one state where the document and reality
    // disagree.
    console.warn(
      `mail-delivery: ${docId} was sent but its receipt could not be recorded (document deleted or claim superseded)`
    );
  }
  return "sent";
}

/**
 * Write an ERROR outcome. `endTime` is set only when the outcome is TERMINAL,
 * because that is the field the Firestore TTL policy keys on -- a still-
 * deliverable document must not become eligible for deletion.
 */
async function finish(
  ref: FirebaseFirestore.DocumentReference,
  claim: Claim,
  classified: ClassifiedError
): Promise<void> {
  const updates: Updates = {
    "delivery.state": "ERROR",
    "delivery.retryable": classified.retryable,
    // Structured, and never the stack: name + message only.
    "delivery.error": { name: classified.name, message: classified.message },
    // Lease released either way. On a retryable error that is what lets the
    // next invocation claim immediately instead of waiting out five minutes.
    "delivery.leaseExpiresAt": null,
    "delivery.endTime": classified.retryable ? null : Timestamp.now(),
  };
  if (!classified.retryable) {
    // Terminal errors expire on the same 7-day clock as successes -- see the
    // SUCCESS write. Retryable errors keep expireAt absent along with
    // endTime: the document is still live work, not a record.
    updates["delivery.expireAt"] = Timestamp.fromMillis(
      Date.now() + MAIL_RETENTION_MS
    );
  }
  await writeIfStillOurs(ref, claim.leaseOwner, updates);
}

// ---------------------------------------------------------------------------
// The trigger.
// ---------------------------------------------------------------------------

// 256MiB, matching onUploadFailure: this reads one document, makes one HTTPS
// request and writes one document, and never touches a payload.
//
// No `retry: true` -- see the header. The claim makes a redelivered event safe;
// what it must never do is guarantee redelivery of a send that keeps failing.
export const onMailCreated = onDocumentCreated(
  {
    document: `${MAIL_COLLECTION}/{id}`,
    memory: "256MiB",
    timeoutSeconds: FUNCTION_TIMEOUT_SECONDS,
  },
  async (event) => {
    const docId = event.params.id;

    // -----------------------------------------------------------------------
    // THE EMULATOR NEVER SENDS, AND NEVER TOUCHES THE DOCUMENT.
    // -----------------------------------------------------------------------
    //
    // Under `firebase emulators:exec` (which is how CI runs the whole test
    // suite -- .github/workflows/node.js.yml) this trigger is LIVE, and it
    // fires on every mail document every suite creates: upload-failure-notify,
    // contact-email-verify, purge-user-data, and this file's own tests.
    //
    // There is no SES in the emulator and there are no AWS credentials there,
    // so without this gate the live instance would race every one of those
    // fixtures, win some of them, and stamp a terminal MailConfigMissingError
    // on documents whose tests are asserting a delivered state -- a CI-only
    // failure that does not reproduce locally.
    //
    // The gate makes that instance a PROVABLE no-op: it returns before the
    // claim transaction, so it performs no read, no write and no send, and
    // every existing suite's mail documents stay byte-identical to what
    // mail.ts wrote. mail-delivery-emulator.test.js then drives
    // deliverMailDocument() directly -- below this check -- so its coverage is
    // unaffected by the gate and cannot be raced by the live instance.
    //
    // This is also simply correct: the extension never ran against the
    // emulator either (docs/deploy-contact-email.md §2 states undelivered mail
    // in the emulator is expected, not a bug), and a test run must not be able
    // to mail a real person. FUNCTIONS_EMULATOR is set to "true" by the
    // Firebase emulator and never by a deployed function -- the same gate
    // providers/zenodo.ts uses to make its API-base override safe.
    if (process.env.FUNCTIONS_EMULATOR === "true") {
      console.log(
        `mail-delivery: emulator instance, leaving ${docId} unsent (no SES here)`
      );
      return;
    }

    try {
      const outcome = await deliverMailDocument(docId);
      console.log(`mail-delivery: ${docId} -> ${outcome}`);
    } catch (error) {
      // deliverMailDocument is written not to throw; this is the backstop for
      // the unexpected (Firestore unavailable mid-transaction). Swallowed on
      // purpose: without `retry: true` a throw is only a red log line, and
      // with it, it would be a seven-day replay of a failing mail send.
      console.error(
        `mail-delivery: ${docId} failed unexpectedly:`,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }
);
