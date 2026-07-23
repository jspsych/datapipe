import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "./app.js";
import { refreshAndUpdateUser } from "./refresh-token.js";
import { refreshGdriveToken } from "./providers/gdrive-oauth.js";
import { decrypt } from "./crypto-utils.js";
import { UserData } from "./interfaces.js";

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const GDRIVE_DEFAULT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Proactively refreshes gdrive access tokens for users whose token expires
 * within `windowMs` (default 10 minutes). Mirrors the OSF pass's cadence
 * convention, but on a much shorter window since gdrive access tokens are
 * short-lived (~1 hour) rather than the ~1-month OSF refresh-token window.
 *
 * Failures are logged and skipped — a single user's refresh failure must
 * never abort the whole pass, and (in 4b) there is no user-visible state
 * change on failure: the connection is simply left as-is.
 */
export async function refreshExpiringGdriveTokens(windowMs: number = GDRIVE_DEFAULT_WINDOW_MS): Promise<void> {
  const expirationThreshold = Date.now() + windowMs;

  const usersSnapshot = await db
    .collection("users")
    .where("connectedAccounts.gdrive.tokenExpiresAt", "<", expirationThreshold)
    .get();

  if (usersSnapshot.empty) {
    return;
  }

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data() as UserData;
    const gdrive = userData.connectedAccounts?.gdrive;
    const userId = userDoc.id;

    if (!gdrive) {
      continue;
    }

    try {
      const result = await refreshGdriveToken(userId, gdrive);
      if (!result.success) {
        console.error(`Failed to refresh gdrive token for user ${userId}: ${result.detail}`);
      }
    } catch (error) {
      console.error(`Error refreshing gdrive token for user ${userId}:`, error);
    }
  }
}

/**
 * Scheduled function that runs weekly to proactively refresh OAuth tokens
 * for users whose refresh tokens are approaching expiration.
 *
 * This prevents token expiration for researchers with active experiments
 * who may not have logged in recently. Each successful refresh obtains
 * a new refresh token (via rotation), resetting the 1-month expiration window.
 *
 * Schedule: Every Sunday at 2:00 AM UTC
 */
export const scheduledTokenRefresh = onSchedule("0 2 * * 0", async () => {
  const now = Date.now();
  const expirationThreshold = now + TWO_WEEKS_MS;

  // Find OAuth users whose refresh tokens expire within the next 2 weeks
  // OR have already passed their estimated expiration. We still attempt
  // to refresh "expired" tokens because the expiration is our estimate —
  // only a failed refresh confirms the token is truly dead.
  const usersSnapshot = await db
    .collection("users")
    .where("usingPersonalToken", "==", false)
    .where("refreshTokenExpires", "<=", expirationThreshold)
    .get();

  if (usersSnapshot.empty) {
    console.log("No tokens approaching expiration. Nothing to refresh.");
    return;
  }

  console.log(`Found ${usersSnapshot.size} user(s) with tokens approaching or past estimated expiration.`);

  let successCount = 0;
  let failCount = 0;

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data() as UserData;
    const userId = userDoc.id;

    if (!userData.refreshToken) {
      console.warn(`User ${userId} has no refresh token, skipping.`);
      continue;
    }

    try {
      const result = await refreshAndUpdateUser(userId, decrypt(userData.refreshToken));

      if (result.success) {
        console.log(`Successfully refreshed token for user ${userId}.`);
        successCount++;
      } else {
        console.error(`Failed to refresh token for user ${userId}: ${result.error}`);
        failCount++;
      }
    } catch (error) {
      console.error(`Error refreshing token for user ${userId}:`, error);
      failCount++;
    }
  }

  console.log(
    `Token refresh complete. Success: ${successCount}, Failed: ${failCount}`
  );

  // gdrive pass runs after the OSF pass, wrapped so a gdrive-side failure
  // (e.g. a query error) can never break/roll back the OSF pass above —
  // refreshExpiringGdriveTokens itself already isolates per-user failures.
  try {
    await refreshExpiringGdriveTokens();
  } catch (error) {
    console.error("Error during gdrive token refresh pass:", error);
  }
});
