/**
 * @jest-environment node
 */

// RED-phase regression guard for step 4b (scratchpad/step4b-oauth-connect-
// spec.md), case 11 of the test plan.
//
// scheduledTokenRefresh (scheduled-token-refresh.ts) is an onSchedule
// function. The Functions emulator exposes scheduled functions for manual
// invocation over HTTP at the same host:port/project/region/name URL as any
// other function (the Local Emulator Suite's documented manual-trigger
// support for onSchedule functions). This test pins its EXISTING,
// OSF-only observable behavior for one user, so that case 10's gdrive
// generalization -- which the spec requires to wrap the new gdrive pass so
// a gdrive failure "can't break the OSF pass" -- cannot silently change it.
//
// It is kept in its own file (not sharing oauth-connect-refresh-emulator.
// test.js) precisely because that file imports a not-yet-existing named
// export and fails at module load, which would fail every test in the file
// -- this regression guard needs to run and report its own, independent
// result.
//
// IMPORTANT deviation from a literal reading of the spec: NEXT_PUBLIC_OSF_ENV
// is "" (not unset) in functions/.env (loaded ahead of .env.datapipe-test,
// which doesn't override it), so refresh-token.ts's hardcoded token URL
// resolves to the REAL "https://accounts.osf.io/oauth2/token" -- and .env
// also carries real-looking CLIENT_ID/CLIENT_SECRET values. Empirically
// invoking the scheduled function against a seeded user whose refresh token
// is due for refresh made a genuine network call to production OSF (it
// returned {"error":"invalid_request"} for the bogus refresh token). Doing
// that from a repeatable test/CI run is exactly the kind of non-hermetic,
// production-touching side effect this suite should avoid -- there is no
// GDRIVE_TOKEN_URL-style override for OSF's endpoint to redirect it to a
// local mock. So instead of pinning the live-refresh branch, this test pins
// the query + per-user-skip behavior that scheduled-token-refresh.ts already
// has for a user with no refreshToken (see its "if (!userData.refreshToken)
// ... continue" branch): the user still matches the query but is skipped
// before any network call happens, which is fully safe to exercise here.
// The live-refresh branch itself could not be safely pinned without hitting
// production OSF -- flagged in the build-step report rather than forced.

import { initializeApp, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
jest.setTimeout(30000);

const config = { projectId: "datapipe-test" };
// Verified empirically against this repo's firebase-tools (15.8.0): since
// firebase.json's emulator suite doesn't include the Pub/Sub emulator,
// onSchedule functions are registered for manual HTTP invocation under a
// "-<index>" suffixed trigger name (the emulator logs "function ignored
// because the pubsub emulator does not exist or is not running" for the
// bare name, but still lists "...-0" as a valid HTTP target and executes it
// normally when POSTed). The bare, unsuffixed name 404s.
const SCHEDULED_URL = "http://localhost:5001/datapipe-test/us-central1/scheduledtokenrefresh-0";

let db;

beforeAll(async () => {
  let app;
  try {
    app = getApp("oauth-connect-scheduled-regression-test");
  } catch {
    app = initializeApp(config, "oauth-connect-scheduled-regression-test");
  }
  db = getFirestore(app);
});

describe("11. OSF scheduled pass (regression guard)", () => {
  it("matches an OAuth user within the expiration window who has no refreshToken, skips them without a network call, and leaves the doc untouched -- expected to PASS today", async () => {
    const uid = `scheduled-osf-regression-${randomUUID()}`;
    const original = {
      email: `${uid}@example.test`,
      usingPersonalToken: false,
      refreshTokenExpires: Date.now(), // within the 2-week window -- matches the query
      // refreshToken deliberately absent -- exercises the existing
      // "if (!userData.refreshToken) { ...; continue; }" skip branch, so
      // this never reaches the OSF token endpoint.
    };
    await db.collection("users").doc(uid).set(original);

    const response = await fetch(SCHEDULED_URL, { method: "POST" });
    expect(response.ok).toBe(true);

    const persisted = (await db.collection("users").doc(uid).get()).data();
    expect(persisted).toEqual(original);
  });
});
