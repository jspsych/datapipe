// The first-failure notification, as words.
//
// PURE ON PURPOSE. This module reads no Firestore, imports no app.js, and has
// no runtime imports at all (the two imports below are `import type` and are
// erased at compile time). That is what lets the copy be unit-tested with no
// emulator and no network -- see __tests__/upload-failure-copy.test.js -- and
// it is the reason the wording lives here instead of inline in
// upload-failure-notify.ts, where every assertion about a sentence would need
// a transaction to reach it.
//
// The mail this builds is the ONE message DataPipe gets to send about a broken
// upload (upload-failure-notify.ts sends at most one per episode, and at most
// one per experiment per 24 hours). Everything below is shaped by that: a
// researcher who skims it must come away knowing their data is not lost,
// whether they have to do anything, and where to look. Crying wolf, or being
// vague, spends the only signal we have.

import type { StorageProviderId, ProviderErrorCode } from "../providers/types.js";

// Hardcoded rather than read from an env var, matching pages/api-docs.js:14,
// which does the same for the same reason: this is the production hostname and
// there is no server-side base-URL variable in functions/ to read. A staging
// deploy therefore mails production links -- acceptable, because staging mail
// is not delivered at all (the Trigger Email extension is not installed there;
// see functions/src/mail.ts).
export const APP_BASE_URL = "https://pipe.jspsych.org";

export function experimentUrl(experimentID: string): string {
  return `${APP_BASE_URL}/admin/${experimentID}`;
}

export const ACCOUNT_URL = `${APP_BASE_URL}/admin/account`;
export const FAQ_URL = `${APP_BASE_URL}/faq`;

// Five attempts over roughly 31 hours: the slow tier's backoff chain in
// scheduled-upload-retry.ts is 2 + 4 + 8 + 16 h before the fifth attempt is
// abandoned at maxRetries (queue-upload.ts's MAX_RETRIES = 5), plus the ~1 h
// first delay -- ~31 hours end to end. Stated in the mail because "we are
// retrying" without a horizon leaves the researcher unable to judge when
// silence has become a problem.
export const RETRY_WINDOW_DESCRIPTION = "five attempts over about 31 hours";

// Human names for the taxonomy in providers/types.ts. Falls back to a generic
// phrase rather than printing the raw id: "we could not write to gdrive" reads
// like a bug report, not a sentence.
const PROVIDER_NAMES: Record<string, string> = {
  osf: "OSF",
  gdrive: "Google Drive",
  figshare: "Figshare",
  dataverse: "Dataverse",
  zenodo: "Zenodo",
};

// Own-property lookup, not `map[key]`. Both maps below are indexed by values
// that arrive from Firestore documents, and a document field reading
// "constructor" or "toString" would otherwise resolve up the prototype chain
// and interpolate a function into an email. Cheap to prevent, ugly to discover.
function lookup(map: Record<string, string>, key: unknown): string | undefined {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key)
    ? map[key]
    : undefined;
}

export function providerDisplayName(
  provider?: StorageProviderId | string | null
): string {
  return lookup(PROVIDER_NAMES, provider) || "your storage provider";
}

// One clause per ProviderErrorCode, saying what happened in the researcher's
// terms. Deliberately consistent with what the dashboard already tells them
// (components/dashboard/QueuePanel.js's PROVIDER_ERROR_COPY): the mail and the
// queue panel are describing the same queue entry, and a researcher who reads
// one and then the other must not have to reconcile two accounts of it.
const REASON_LINES: Record<string, string> = {
  AUTH_EXPIRED: "your storage connection needs to be reconnected",
  QUOTA_EXCEEDED: "your storage account is out of room",
  RATE_LIMITED: "the provider is asking us to slow down",
  UNAVAILABLE: "the provider was unreachable",
  CONTENTION: "another write to the same folder was in progress",
  NAME_CONFLICT: "a file with that name already exists",
};

// The fallback covers two real populations, not just malformed data: queue
// entries written before providerErrorCode existed, and -- the larger group --
// every failure that never reached the provider at all (token resolution,
// collision-cache trouble, an unreadable payload), since only a provider
// WriteResult carries a code. Saying "the upload did not complete" is honest
// about that and sends them to the queue panel, which does have the detail.
const FALLBACK_REASON = "the upload did not complete";

export function reasonLine(code?: ProviderErrorCode | string | null): string {
  return lookup(REASON_LINES, code) || FALLBACK_REASON;
}

/**
 * What the researcher should actually do, which is usually "nothing".
 *
 * Saying so explicitly matters more than it looks: an alert that never
 * distinguishes "we have got this" from "only you can fix this" trains people
 * to ignore all of them, and the codes in the first group (CONTENTION,
 * UNAVAILABLE, RATE_LIMITED) are the common ones.
 */
export function actionLine(
  code: ProviderErrorCode | string | null | undefined,
  provider: StorageProviderId | string | null | undefined
): string {
  const name = providerDisplayName(provider);
  // Absent storageProvider means a legacy OSF experiment -- the field is
  // additive and pre-migration documents have none (see interfaces.ts's
  // ExperimentData) -- so both shapes are the same case here.
  const legacyOsf = !provider || provider === "osf";

  switch (code) {
    case "AUTH_EXPIRED":
      // Reconnecting is the standard fix and the wrong advice for OSF: OSF is
      // retiring the projects feature DataPipe writes into, so a researcher
      // sent to reconnect would be trying to repair something that is going
      // away. The FAQ is where that story is told (pages/faq.js).
      return legacyOsf
        ? `OSF is winding down the projects feature DataPipe writes into, so reconnecting may not fix this. ${FAQ_URL} explains the options for an OSF experiment.`
        : `Reconnect ${name} from your account settings: ${ACCOUNT_URL}`;
    case "QUOTA_EXCEEDED":
      return `Free up room in ${name}, or move this study to a provider with more space. Until there is room, further uploads will keep failing.`;
    case "RATE_LIMITED":
      return `Nothing to do right now -- ${name} has asked us to slow down and DataPipe is waiting it out. Check the experiment page if the queue is still backed up tomorrow.`;
    case "UNAVAILABLE":
      return `Nothing to do right now -- this usually means ${name} had an outage, and DataPipe keeps retrying until it is back.`;
    case "CONTENTION":
      return "Nothing to do right now -- this is normal when several participants finish at once, and it usually clears within minutes.";
    case "NAME_CONFLICT":
      return `Check ${name} for a file with the same name. The data may already be there under a name DataPipe did not expect.`;
    default:
      return (
        "Open the experiment page below. The queue panel lists every waiting file, " +
        "explains each one, and lets you download it directly."
      );
  }
}

export interface UploadFailureCopyInput {
  experimentID: string;
  // The experiment doc's `title`. Optional because nothing guarantees one on
  // an old document, and a mail with a blank name in the subject would be
  // worse than a mail that names the id.
  title?: string | null;
  storageProvider?: StorageProviderId | string | null;
  providerErrorCode?: ProviderErrorCode | string | null;
  // uploadFailure.failureCount AFTER this failure is counted. Normally 1: this
  // mail is only composed on the first failure of an episode, so the count has
  // just been incremented from 0. It can be higher only when a caller composes
  // for an already-open episode, so the extra line below is conditional rather
  // than always rendered -- "1 file is waiting so far" is noise.
  failureCount?: number;
}

export interface UploadFailureEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Builds the subject and both bodies for a first-failure notification.
 *
 * Order is consequence, then reassurance, then mechanism, then action
 * (PRODUCT.md principle 2). The first sentence has to survive being the only
 * one read -- in a notification list it may be all that is shown -- so it
 * carries the whole event: whose study, what did not happen, and where.
 */
export function buildUploadFailureEmail(
  input: UploadFailureCopyInput
): UploadFailureEmail {
  const { experimentID, title, storageProvider, providerErrorCode } = input;
  const name = (title || "").trim();
  const provider = providerDisplayName(storageProvider);
  const link = experimentUrl(experimentID);
  const reason = reasonLine(providerErrorCode);
  const action = actionLine(providerErrorCode, storageProvider);
  const failureCount = input.failureCount ?? 0;

  const subject = name
    ? `DataPipe couldn't upload a data file for "${name}"`
    : "DataPipe couldn't upload a data file for your experiment";

  const study = name ? `"${name}"` : `your experiment (${experimentID})`;

  const opening =
    `A participant finished ${study} and DataPipe could not write their data file to ${provider}.`;

  // The single most important sentence in the mail, kept separate so the HTML
  // body can bold it without pulling it back out of a longer string. A
  // researcher who reads "upload failed" and stops reading assumes lost data
  // and starts a support thread, or worse, re-runs participants.
  const NOT_LOST = "The file is not lost.";
  const retryExplanation =
    "DataPipe saved a copy before the upload was attempted and is " +
    `retrying automatically, with increasing delays, across ${RETRY_WINDOW_DESCRIPTION}. ` +
    "Most upload failures clear on their own. Any file that never lands can be downloaded " +
    "from the experiment page.";
  const reassurance = `${NOT_LOST} ${retryExplanation}`;

  const reasonSentence = `What went wrong: ${reason}.`;
  const actionSentence = `What to check: ${action}`;

  // Only when a burst was already in progress. See failureCount above.
  const burstSentence =
    failureCount > 1
      ? `${failureCount} files from this experiment are waiting so far. `
      : "";

  const cadence =
    `${burstSentence}We will only email you once about this -- not once per file. ` +
    "If more files fail after this experiment's queue clears, you'll hear from us again.";

  const footer =
    "You are getting this because DataPipe needs to be able to tell you when your data stops " +
    "arriving. It is the only kind of message sent to this address -- no announcements, no " +
    `mailing list -- and it is never shown to participants. Change the address: ${ACCOUNT_URL}`;

  const text = [
    opening,
    reassurance,
    reasonSentence,
    actionSentence,
    cadence,
    `See the queue and download any waiting file: ${link}`,
    "--",
    footer,
  ].join("\n\n");

  // `title` is researcher-supplied and reaches this string unfiltered, so it
  // is escaped -- along with everything else, so no future edit has to
  // remember which values were trusted.
  const html = [
    `<p>${escapeHtml(opening)}</p>`,
    `<p><strong>${escapeHtml(NOT_LOST)}</strong> ${escapeHtml(retryExplanation)}</p>`,
    `<p>${escapeHtml(reasonSentence)}</p>`,
    `<p>${escapeHtml(actionSentence)}</p>`,
    `<p>${escapeHtml(cadence)}</p>`,
    `<p><a href="${escapeHtml(link)}">See the queue and download any waiting file</a><br>${escapeHtml(link)}</p>`,
    "<hr>",
    `<p style="font-size:0.9em;color:#555">${escapeHtml(footer)}</p>`,
  ].join("\n");

  return { subject, text, html };
}
