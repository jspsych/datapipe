// Tiered retry backoff for the upload queue (scheduled-upload-retry.ts's
// handleRetryFailure). Split into its own module -- rather than living
// inline in scheduled-upload-retry.ts -- so it can be imported by a pure
// unit test without dragging in providers/index.js (and therefore every
// adapter's module-scope `node-fetch` import, which Jest's CJS transform
// cannot parse) or app.js's Firestore/Storage clients. See
// functions/src/__tests__/backoff-arithmetic.test.js.
import { isFastRetry } from "./queue-upload.js";
import { ProviderErrorCode } from "./providers/types.js";

// Slow tier cap: 24 hours, unchanged since before the fast tier existed.
export const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

// Fast tier (CONTENTION, see queue-upload.ts's isFastRetry): a much shorter
// cap, since write contention clears in seconds rather than needing an
// outage to end.
export const FAST_MAX_BACKOFF_MS = 30 * 60 * 1000;

/**
 * The delay, in ms, before the next retry of an upload-queue item, given the
 * retry count it is about to be recorded with, the provider error code from
 * the attempt that just failed, and any Retry-After the provider sent.
 *
 * Tiered by provider error code: CONTENTION ("another write to this
 * container is in flight") resolves in seconds, unlike AUTH_EXPIRED /
 * QUOTA_EXCEEDED / RATE_LIMITED / UNAVAILABLE (or no code at all), which need
 * human action, a rate-limit window, or an outage to end -- so the fast tier
 * gets a minutes-scale base/cap (~2, 4, 8, 16, 30 minutes) instead of the
 * hours-scale one (~2, 4, 8, 16, 24 hours).
 *
 * A Retry-After is honored when the provider sent one, and clamped to
 * MAX_BACKOFF_MS -- never to the item's tier cap: the header is the provider
 * stating how long it will keep refusing, so clamping it DOWN to the fast
 * tier's 30 minutes would schedule a retry the provider already told us
 * would fail.
 */
export function computeBackoffMs(
  newRetryCount: number,
  providerErrorCode: ProviderErrorCode | string | null | undefined,
  retryAfterSeconds?: number | null
): number {
  const fastTier = isFastRetry(providerErrorCode);
  const baseMs = fastTier ? 60 * 1000 : 60 * 60 * 1000;
  const capMs = fastTier ? FAST_MAX_BACKOFF_MS : MAX_BACKOFF_MS;

  return retryAfterSeconds
    ? Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS)
    : Math.min(Math.pow(2, newRetryCount) * baseMs, capMs);
}
