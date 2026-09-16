import { ExperimentData, UserData } from './interfaces';
import { getProviderForExperiment } from "./providers/index.js";
import { TokenResult } from "./providers/types.js";

export { TokenResult };

// api-data.ts, api-base64.ts and scheduled-upload-retry.ts all have to agree
// on what a failed TokenResult MEANS, because they act on it differently:
// the two API endpoints decide whether to queue the submission for retry or
// reject it outright, and the retry worker decides which taxonomy code (if
// any) to hand handleRetryFailure so QueuePanel and the failure-notification
// email describe it as a credential problem instead of a raw string. One
// classifier, shared, is what keeps those three decisions from drifting
// apart -- see the CHANGES section of the commit this landed in.
//
// RECOVERABLE: a connection to the provider EXISTS, but the credential
// behind it is currently unusable -- an expired or revoked refresh token, an
// error or transient network fault hit while exchanging it, or a static
// token that has expired or been marked invalid. All of these can heal with
// no code change: the researcher reconnects (OAuth2 providers) or pastes a
// fresh token (static-token providers), and the very next retry succeeds.
// Queuing the submission is what makes that automatic instead of requiring
// the participant to come back. Every provider's resolveToken funnels this
// case into one of:
//   INVALID_REFRESH_TOKEN   -- gdrive, osf, zenodo: the refresh grant was
//                              rejected, OR the refresh HTTP call itself
//                              threw (gdrive-oauth.ts's refreshGdriveToken
//                              folds a network exception into this same
//                              code -- see its catch block), OR persisting
//                              the rotated credential failed (zenodo-oauth.ts).
//                              osf.ts only reaches this after its own PAT
//                              fallback (hasValidPAT) also came up empty.
//   INVALID_OSF_TOKEN       -- osf: a stored personal access token is marked
//                              invalid.
//   PROVIDER_TOKEN_EXPIRED  -- dataverse: the static token has expired and
//                              there is no refresh token to rotate.
//
// NOT RECOVERABLE: there is no connection for this owner/provider at all --
// nothing stored to refresh, expire, or reconnect. Retrying against the same
// state fails forever until a human connects an account, a step DataPipe
// cannot take on its own, so holding the submission in the queue only delays
// a refusal the participant should see immediately instead.
//   PROVIDER_NOT_CONNECTED  -- every OAuth2/static-token provider when
//                              userData has no connectedAccounts entry for
//                              it, AND resolve-token.ts's own wrapper above
//                              for an unregistered/unsupported
//                              storageProvider id.
//
// Anything NOT in the NOT-RECOVERABLE set below defaults to RECOVERABLE --
// deliberately the safer direction to be wrong in. A caller that wrongly
// treats a recoverable failure as terminal REJECTS a submission that could
// have been saved by queuing it; a caller that wrongly treats a terminal
// failure as recoverable merely queues a submission that will sit until its
// retries run out and the researcher downloads it by hand. The first
// mistake loses data outright; the second does not. So a provider error code
// this module has never seen -- a future adapter, a typo -- queues rather
// than rejects.
export type TokenFailureBucket = "RECOVERABLE" | "NOT_RECOVERABLE";

const NOT_RECOVERABLE_TOKEN_ERRORS: ReadonlySet<string> = new Set([
  "PROVIDER_NOT_CONNECTED",
]);

export function classifyTokenFailure(error: string): TokenFailureBucket {
  return NOT_RECOVERABLE_TOKEN_ERRORS.has(error) ? "NOT_RECOVERABLE" : "RECOVERABLE";
}

export default async function resolveToken(
  user_data: UserData,
  exp_data: ExperimentData,
): Promise<TokenResult> {
  // getProviderForExperiment -> getProvider throws for an unregistered/
  // unsupported storageProvider id, but historically an unsupported provider
  // here returned a failure result rather than throwing. Callers distinguish
  // the two: a returned !success becomes an HTTP 400 with a specific message,
  // while a throw is caught elsewhere and becomes an HTTP 500
  // TOKEN_RESOLUTION_ERROR. So the lookup is wrapped to preserve the old
  // failure-result behavior; the resolveToken call itself is allowed to
  // throw as it always has.
  let provider;
  try {
    ({ provider } = getProviderForExperiment(exp_data));
  } catch {
    return {
      success: false,
      error: "PROVIDER_NOT_CONNECTED",
      detail: `Unsupported storage provider: ${exp_data.storageProvider}`,
    };
  }

  return provider.resolveToken(user_data, exp_data.owner);
}
