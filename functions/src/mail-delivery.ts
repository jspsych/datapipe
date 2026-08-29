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
// moved in-repo. The transport was then Amazon SES, until AWS denied the
// production-access request that would have let it send to anyone but a
// verified address; it is now Resend, over its plain JSON HTTP API -- no SMTP,
// no nodemailer, and no SDK at all (one `fetch` to one endpoint).
//
// mail.ts's header still describes the extension; its DOCUMENT contract is
// unchanged and still authoritative, which is the whole reason both swaps cost
// nothing on the write side.
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

// Hard ceiling on one Resend API call. Resend answers in well under a second
// in the normal case; ten seconds is "the network eating the request", not
// "Resend is thinking".
export const SEND_TIMEOUT_MS = 10 * 1000;

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
//                is still alive and still inside the send. Both send. That is
//                the double-send this whole file exists to prevent. (Resend's
//                Idempotency-Key makes that collision survivable now -- see
//                the transport seam -- but "survivable" is not "fine", and
//                the lease is still the thing that prevents it.)
//   too LONG  -> a genuinely crashed claim sits undelivered for that long.
//
// The floor is therefore the longest an invocation can still be running after
// it claimed, and that is bounded by the FUNCTION timeout (60s), not by the
// send timeout (10s): past 60 seconds the platform has killed the invocation,
// so it is provably not in the send any more. 5 minutes is 5x that
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
// RESEND_API_KEY is written into functions/.env by the deploy workflows from a
// repo secret, exactly as TOKEN_ENCRYPTION_KEY already is
// (.github/workflows/firebase-deploy.yml, firebase-deploy-test.yml). MAIL_FROM
// and MAIL_REPLY_TO are not secret and are written as literals in the same
// block. See docs/deploy-contact-email.md §2.
//
// ONE secret, not the three SES needed: Resend authenticates with a bearer
// token, so there is no region to keep in sync with a verified identity and no
// request signing to be broken by a stray newline. The trim() below survives
// from the SES version anyway -- a trailing newline in a bearer token is a 401,
// which is just as fatal and rather harder to see.
// ---------------------------------------------------------------------------

export const REQUIRED_CONFIG_KEYS = ["RESEND_API_KEY", "MAIL_FROM"] as const;

export interface MailConfig {
  // Resend API key, "re_..." -- sent as `Authorization: Bearer <key>`.
  apiKey: string;
  // "DataPipe <datapipe-notifications@jspsych.org>" -- the extension's DEFAULT_FROM.
  // Must be on a domain verified in the Resend account, or every send is a 403
  // validation_error.
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
    apiKey: (env.RESEND_API_KEY ?? "").trim(),
    from: (env.MAIL_FROM ?? "").trim(),
    ...(replyTo ? { replyTo } : {}),
  };
}

// ---------------------------------------------------------------------------
// The Resend request, built from the mail document.
// ---------------------------------------------------------------------------

// The JSON body of POST https://api.resend.com/emails.
//
// SNAKE_CASE IS NOT A TYPO. Resend's Node SDK takes `replyTo`; the raw REST
// API this file speaks takes `reply_to`, and silently ignores keys it does not
// recognise -- so a camelCase `replyTo` here would not error, it would just
// send every notification with no Reply-To header and nothing would say so.
// That is exactly the class of bug buildSendEmailInput is exported to catch.
export interface SendEmailInput {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  reply_to?: string[];
}

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
// drop anything that is not a non-empty string rather than handing Resend a
// `null` recipient.
function recipients(to: unknown): string[] {
  const list: unknown[] = Array.isArray(to) ? (to as unknown[]) : [to];
  return list
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * mail document -> Resend request body.
 *
 * Pure, and exported for it: this mapping is where a silent wrong-From, a
 * dropped html part, or a camelCased `reply_to` would hide, and it needs no
 * emulator and no network to assert.
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
    from: config.from,
    to,
    subject,
    // Text always, html only when the document carries one -- mail.ts omits
    // `html` entirely for text-only mail, and an empty html part is not the
    // same thing as no html part to a mail client.
    text,
    ...(html ? { html } : {}),
  };
  if (config.replyTo) {
    input.reply_to = [config.replyTo];
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

// Resend names its refusals in the response body (`name`), and those names are
// the precise signal -- more precise than the status, which reuses 403 for
// "unverified domain", "suspended key" and "over quota" alike. Status is the
// fallback for anything not listed here (Resend adds codes); see
// https://resend.com/docs/api-reference/errors.

// Permanent. Retrying changes nothing; a human has to change something.
// Everything here is a configuration, credential, or bad-document problem.
const PERMANENT_ERRORS = new Set([
  // 400/403/422 -- bad field, unverified sending domain, or a free-account
  // restriction to the account owner's own address. The last one is the
  // Resend equivalent of the SES sandbox that started this migration, and it
  // fails exactly as loudly: terminal, named, on the document.
  "validation_error",
  "missing_required_field",
  "missing_required_parameter",
  "invalid_parameter",
  "invalid_attachment",
  // 401/403 -- the key is absent, wrong, scoped wrong, or switched off.
  "missing_api_key",
  "restricted_api_key",
  "suspended_api_key",
  "invalid_permission",
  // 403 -- the account cannot send this at all.
  "email_above_quota",
  // 404/405 -- this code is calling the wrong endpoint. A deploy fixes it, a
  // retry does not.
  "not_found",
  "method_not_allowed",
  // 400/409 -- our Idempotency-Key is malformed, or was reused with a
  // different body. Both are defects here, not conditions at Resend.
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  INVALID_DOCUMENT_ERROR,
  CONFIG_MISSING_ERROR,
]);

// Transient. Resend answered, and its answer was "not now".
const TRANSIENT_ERRORS = new Set([
  // 429 -- the per-second limit. Genuinely momentary.
  "rate_limit_exceeded",
  // 429 -- THE PLAN CAP, and worth understanding before it happens. Nothing
  // retries a retryable error on a timer (see the header): marking these
  // retryable makes the document say "still deliverable" and makes an
  // operator re-drive work, but the mail does not resend itself tomorrow.
  // On the free plan the cap is 100/day, and the burst case that reaches it
  // is a storage-provider outage putting many experiments into failure
  // episodes at once -- i.e. exactly when these notifications matter most.
  // `daily_quota_exceeded` in the logs is the signal to move to a paid plan;
  // it is the second line worth alerting on after MailConfigMissingError.
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  // 409 -- a previous attempt on the same Idempotency-Key is still in flight
  // at Resend. It will finish; ours should stand down and let a later
  // delivery read the result.
  "concurrent_idempotent_requests",
  "resource_locked",
  // 500/503.
  "application_error",
  "service_unavailable",
  "internal_server_error",
]);

// Never connected at all, so nothing can have been sent.
const NEVER_CONNECTED_ERRORS = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

// AMBIGUOUS: the request went out and no answer came back. Resend may or may
// not have accepted the message.
//
// THIS SET IS RETRYABLE NOW, AND IT WAS NOT UNDER SES. That is the one
// behavioural change the transport swap carries, and it is an improvement
// rather than a slip. The old comment here read: "SESv2 SendEmail has no
// idempotency token that would let a retry be safe", and so it chose to lose
// an ambiguous mail rather than risk delivering a second copy of a
// notification whose whole value is arriving once.
//
// Resend takes an Idempotency-Key header, and the transport below sends the
// mail document's own id as that key on every attempt. So a retry after a
// timeout is not a second send: Resend recognises the key and returns the
// original result. The trade the old comment was making no longer exists --
// we can now retry ambiguity AND keep the exactly-once guarantee, instead of
// choosing between them.
//
// THE ONE THING THAT WOULD BREAK THIS: Resend expires an idempotency key after
// 24 hours. Every retry path here is minutes wide (at-least-once redelivery of
// the create event, or a lease takeover bounded by LEASE_MS), so nothing comes
// close. If a retry mechanism is ever added that can fire a day later, this set
// goes back to terminal, or the key stops being sufficient.
const AMBIGUOUS_ERRORS = new Set([
  "TimeoutError",
  "AbortError",
  "RequestTimeout",
  "ECONNRESET",
  "EPIPE",
  "ECONNABORTED",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * A non-2xx answer from Resend, or an unusable one. Carries the HTTP status so
 * classification can fall back on it when the body named nothing familiar.
 */
export class MailTransportError extends Error {
  status?: number;
  constructor(name: string, message: string, status?: number) {
    super(message);
    this.name = name;
    this.status = status;
  }
}

function errorName(error: unknown): string {
  if (error === null || typeof error !== "object") return "UnknownError";
  const e = error as { name?: unknown; code?: unknown; cause?: unknown };

  // `!== "Error"` because a bare `new Error(...)` carries no diagnosis at all;
  // its node-style `code` (ECONNRESET and friends) is the useful signal.
  //
  // `!== "TypeError"` for the same reason, and it is load-bearing: undici --
  // the fetch implementation in Node 22 -- wraps EVERY transport failure as
  // `TypeError: fetch failed` and hangs the real diagnosis off `.cause`. Take
  // the name at face value here and every network error in this file becomes
  // an unrecognised "TypeError", which classifies terminal, which silently
  // turns every transient blip into a permanently lost notification.
  if (
    typeof e.name === "string" &&
    e.name.length > 0 &&
    e.name !== "Error" &&
    e.name !== "TypeError"
  ) {
    return e.name;
  }
  if (typeof e.code === "string" && e.code.length > 0) return e.code;

  const cause = e.cause as { name?: unknown; code?: unknown } | undefined;
  if (cause && typeof cause === "object") {
    if (typeof cause.code === "string" && cause.code.length > 0) return cause.code;
    if (
      typeof cause.name === "string" &&
      cause.name.length > 0 &&
      cause.name !== "Error"
    ) {
      return cause.name;
    }
  }
  return "UnknownError";
}

/**
 * Classify a failed send.
 *
 * Never returns a stack. `message` is Resend's own message text, which
 * describes the refusal ("The gmail.com domain is not verified"), not the
 * payload -- a stack here would end up in a Firestore document and in a log
 * line, and neither is a place for one.
 */
export function classifyMailError(error: unknown): ClassifiedError {
  const name = errorName(error);
  const raw = (error as { message?: unknown })?.message;
  const message =
    typeof raw === "string" && raw.length > 0 ? raw.slice(0, 500) : "Unknown error";

  // Explicit names win over status codes: Resend reuses 403 for problems that
  // are not alike, and the name is the precise signal.
  if (PERMANENT_ERRORS.has(name)) return { name, message, retryable: false };
  if (NEVER_CONNECTED_ERRORS.has(name)) return { name, message, retryable: true };
  if (AMBIGUOUS_ERRORS.has(name)) return { name, message, retryable: true };
  if (TRANSIENT_ERRORS.has(name)) return { name, message, retryable: true };

  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") {
    // 429 and 5xx: Resend answered and declined to do the work now.
    if (status === 429 || status >= 500) return { name, message, retryable: true };
    // Any other 4xx is a refusal of THIS request, and it will refuse it again.
    if (status >= 400) return { name, message, retryable: false };
  }

  // Unknown, unnamed, no status. More likely a defect on our side than a blip
  // at Resend, so it does not get to consume the retry budget.
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
    // Someone holds the claim and may be inside the send right now.
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
  // Resend's `id` for the accepted message. Recorded as
  // delivery.info.messageId, which is the extension's field name.
  id?: string;
}

export interface SendOptions {
  timeoutMs: number;
  // Sent as the Idempotency-Key header. The mail document's id: stable across
  // every attempt on one document, unique across documents. See
  // AMBIGUOUS_ERRORS for what this buys.
  idempotencyKey: string;
}

export type MailSender = (
  input: SendEmailInput,
  options: SendOptions
) => Promise<SendResult>;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

let injectedSender: MailSender | null = null;

/**
 * Test seam. Replaces the Resend transport with a plain function.
 *
 * A function rather than a client object on purpose: it means no test in this
 * repo -- pure or emulator-backed -- ever makes a network call, and it means
 * the mocked surface is exactly the one line of behaviour that matters (an
 * input goes in, an id or a throw comes out). Pass null to restore.
 */
export function _setMailSenderForTests(sender: MailSender | null): void {
  injectedSender = sender;
}

/**
 * The real transport: one POST, no SDK.
 *
 * There is nothing to cache and nothing to construct between calls -- which is
 * why the SES version's client cache and its credential-rotation cache key are
 * both gone. `fetch` is global in Node 22, so this also drops the dynamic
 * import that existed to keep @aws-sdk/client-sesv2 off the cold-start path of
 * apidata (index.ts imports every module in this codebase). There is now no
 * mail dependency to keep off it.
 */
function resendSender(config: MailConfig): MailSender {
  return async (input, { timeoutMs, idempotencyKey }) => {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
      // No retries of its own, deliberately -- the same reason the SES client
      // was built with maxAttempts: 1. Attempts are counted on the document
      // and capped there; an invisible second attempt inside the transport
      // would be a send this file cannot see or bound.
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      // Resend answers errors as {name, message, statusCode}, but that shape
      // is not in its published contract and an edge/proxy failure is HTML.
      // So: try for the body, fall back to the status, never throw from here
      // -- a parse failure must not be reported as the reason the mail failed.
      let name = `HttpError${response.status}`;
      let message = response.statusText || `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as {
          name?: unknown;
          message?: unknown;
        };
        if (body && typeof body === "object") {
          if (typeof body.name === "string" && body.name.length > 0) {
            name = body.name;
          }
          if (typeof body.message === "string" && body.message.length > 0) {
            message = body.message;
          }
        }
      } catch {
        // Not JSON. The status-derived name and message above stand, and
        // classifyMailError falls back to `status` for the verdict.
      }
      throw new MailTransportError(name, message, response.status);
    }

    // 2xx means Resend accepted it. An unreadable body after that point costs
    // us the message id, which is a worse audit trail -- not a failed send, so
    // it must not throw. delivery.info.messageId simply lands null.
    try {
      const body = (await response.json()) as { id?: unknown };
      return { id: typeof body?.id === "string" ? body.id : undefined };
    } catch {
      return {};
    }
  };
}

function getSender(config: MailConfig): MailSender {
  return injectedSender ?? resendSender(config);
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
      `mail-delivery: ${CONFIG_MISSING_ERROR} -- Resend is not configured, mail ${docId} cannot be sent. Missing: ${missing.join(", ")}`
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
    const classified = classifyMailError(error);
    console.error(
      `mail-delivery: ${docId} is not sendable (${classified.name}): ${classified.message}`
    );
    await finish(ref, claim, classified);
    return "terminal-error";
  }

  let result: SendResult;
  try {
    const send = getSender(config);
    result = await send(input, {
      timeoutMs: SEND_TIMEOUT_MS,
      // The document id, so every attempt on this mail carries the same key
      // and Resend collapses them into one delivery. This is what makes an
      // ambiguous timeout safe to retry -- see AMBIGUOUS_ERRORS.
      idempotencyKey: docId,
    });
  } catch (error) {
    const classified = classifyMailError(error);
    // The attempts cap is applied HERE and not in classifyMailError, because
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
    "delivery.info": { messageId: result?.id ?? null, transport: "resend" },
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
    // There is no Resend key in the emulator, so without this gate the live
    // instance would race every one of those fixtures, win some of them, and
    // stamp a terminal MailConfigMissingError on documents whose tests are
    // asserting a delivered state -- a CI-only failure that does not reproduce
    // locally. Worse now than under SES: a real key in a developer's
    // functions/.env would make the racing instance mail a real person from a
    // test run.
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
        `mail-delivery: emulator instance, leaving ${docId} unsent (no Resend here)`
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
