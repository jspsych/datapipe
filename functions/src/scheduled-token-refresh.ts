import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "./app.js";
import { refreshAndUpdateUser } from "./refresh-token.js";
import { UserData } from "./interfaces.js";

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

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
      const result = await refreshAndUpdateUser(userId, userData.refreshToken);

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
});
