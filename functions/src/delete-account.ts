import { onRequest } from "firebase-functions/v2/https";
import { auth } from "./app.js";
import { purgeUserData } from "./purge-user-data.js";

// Account deletion, moved server-side.
//
// It used to be a bare client-side deleteUser(auth.currentUser), with the
// cleanup hanging off the onUserDeleted auth trigger. That arrangement has an
// ordering problem that no amount of care in the trigger can fix: the auth
// record is destroyed first, so if the cleanup does not run -- or runs
// partially -- the researcher's data is stranded with no owner and no way for
// them to sign in and try again. datapipe-test still carries the residue:
// user documents and a still-`active` experiment belonging to accounts that no
// longer exist.
//
// Here the order is inverted. Purge first, delete the auth record only once
// the purge has returned. A failure now leaves the account intact and the
// operation retryable, which is the safe direction to fail in.
//
// onUserDeleted is kept as a backstop for deletions that do not come through
// this endpoint (the Firebase console, the Admin SDK, a support action).

// Firebase's own threshold for auth/requires-recent-login. Client-side
// deleteUser enforced this for us; server-side nothing does, so the check has
// to be explicit or moving the call server-side would quietly weaken it -- a
// stolen session token would be enough to destroy an account.
const MAX_AUTH_AGE_SECONDS = 5 * 60;

export const deleteAccount = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let uid: string;
  let authTime: number;
  try {
    const idToken = authHeader.split("Bearer ")[1];
    // checkRevoked: a researcher who signed out everywhere should not be able
    // to delete the account with a token minted before that.
    const decodedToken = await auth.verifyIdToken(idToken, true);
    uid = decodedToken.uid;
    authTime = decodedToken.auth_time;
  } catch {
    res.status(401).json({ error: "Invalid authentication token" });
    return;
  }

  const tokenAgeSeconds = Date.now() / 1000 - authTime;
  if (tokenAgeSeconds > MAX_AUTH_AGE_SECONDS) {
    // A distinct code so the client can say "sign in again" rather than
    // showing a generic failure.
    res.status(403).json({
      error: "Please sign in again before deleting your account.",
      code: "requires-recent-login",
    });
    return;
  }

  try {
    const counts = await purgeUserData(uid);
    await auth.deleteUser(uid);
    res.status(200).json({ success: true, deleted: counts });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error(`Account deletion failed for ${uid}: ${detail}`);
    // The account still exists and still owns whatever survived, so the
    // researcher can retry. Say so rather than leaving them guessing.
    res.status(500).json({
      error:
        "Could not finish deleting your account. Nothing was lost -- please try again.",
    });
  }
});
