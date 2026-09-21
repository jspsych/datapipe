import * as auth from "firebase-functions/v1/auth";
import { purgeUserData } from "./purge-user-data.js";

// Backstop for auth records deleted outside the app: the Firebase console, the
// Admin SDK, a support action. The normal path is the deleteAccount HTTPS
// function, which purges first and deletes the auth record afterwards; this
// trigger covers the deletions that never touch it.
//
// It is a backstop rather than the primary mechanism on purpose. It fires
// after the account is already gone, so a failure here strands data with no
// owner and no way for the researcher to sign back in and retry -- and there
// is evidence in datapipe-test that this has already happened at least twice.
// Whether the miss was a trigger that did not fire or an experiment missing
// from the users/{uid}.experiments array it used to read, relying on
// after-the-fact cleanup as the only line of defence is the wrong shape.
//
// purgeUserData is idempotent, so running after deleteAccount has already
// purged is harmless.
export const onUserDeleted = auth.user().onDelete(async (user) => {
  const counts = await purgeUserData(user.uid);
  console.log(`Purged data for deleted user ${user.uid}:`, counts);
});
