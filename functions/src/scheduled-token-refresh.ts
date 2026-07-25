import { onSchedule } from "firebase-functions/v2/scheduler";
import { getProvider, listProviders } from "./providers/index.js";

/**
 * Scheduled function that runs weekly to proactively refresh OAuth tokens
 * for users whose tokens are approaching expiration.
 *
 * This prevents token expiration for researchers with active experiments
 * who may not have logged in recently. Each provider defines its own
 * refresh cadence and window via `refreshExpiringTokens` (see
 * providers/types.ts); this dispatcher just loops over the registry and
 * never names a provider itself.
 *
 * Schedule: Every Sunday at 2:00 AM UTC
 */
export const scheduledTokenRefresh = onSchedule("0 2 * * 0", async () => {
  // Registration order in providers/index.ts is osf then gdrive, so this
  // loop preserves the historical OSF-then-gdrive run order.
  for (const id of listProviders()) {
    const provider = getProvider(id);
    if (!provider.refreshExpiringTokens) continue;

    try {
      await provider.refreshExpiringTokens();
    } catch (error) {
      // DELIBERATE BEHAVIOR CHANGE: previously the OSF pass was unwrapped
      // (a hard failure, e.g. a Firestore query error, threw out of the
      // scheduled function and the run was marked failed), while the
      // gdrive pass was wrapped and swallowed. A uniform loop must pick
      // one convention -- we wrap every provider, so one provider's
      // failure can never prevent another's pass from running. Failures
      // are logged rather than thrown, and are not re-thrown in
      // aggregate after the loop.
      console.error(`Token refresh pass failed for provider ${id}:`, error);
    }
  }
});
