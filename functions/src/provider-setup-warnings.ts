// Advisory-only endpoint, checked when a researcher is setting up an
// experiment against a non-OSF provider (docs/provider-migration-design.md).
// Surfaces non-blocking, researcher-facing warnings about things the
// connected provider *installation* can't honor -- the motivating case is
// Dataverse's tabIngest suppression param (added in 5.11), which an older
// installation silently ignores with no error anywhere (see
// providers/dataverse.ts's setupWarnings). A warning at setup beats
// discovering the problem months later.
//
// Auth + request shape mirrors get-provider-access-token.ts closely (POST
// only, { provider, uid, idToken } body, verifyOwnership for 401/403,
// resolveToken for the decrypted credential). The key difference: THIS
// ENDPOINT NEVER RETURNS AN ERROR STATUS FOR A PROVIDER-SIDE PROBLEM. It is
// advisory only -- every failure mode (unknown provider aside, which is a
// caller bug, not a provider problem) degrades to 200 { warnings: [] }
// rather than blocking or confusing experiment setup.

import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";
import { verifyOwnership } from "./connect-provider.js";
import resolveToken from "./resolve-token.js";
import { getProvider } from "./providers/index.js";
import { StorageProviderId } from "./providers/types.js";
import { ExperimentData, UserData } from "./interfaces.js";

export const providerSetupWarnings = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const {
      provider,
      uid,
      idToken,
    }: { provider?: string; uid?: string; idToken?: string } = req.body || {};

    if (!provider || !uid) {
      res.status(400).json({ error: "Missing required parameters" });
      return;
    }

    // The provider must be registered and not "osf" -- OSF's identity flow
    // is a separate legacy path (oauth2-callback.ts) with no
    // connectedAccounts entry to resolve here. Opaque "Unknown provider" for
    // both rejections, same convention as connect-provider.ts/
    // get-provider-access-token.ts: a registered-but-wrong-shape provider
    // looks identical to the caller as genuinely unknown.
    let storageProvider;
    try {
      storageProvider = getProvider(provider as StorageProviderId);
    } catch {
      res.status(400).json({ error: "Unknown provider" });
      return;
    }
    if (storageProvider.id === "osf") {
      res.status(400).json({ error: "Unknown provider" });
      return;
    }

    // Verify the caller owns the uid they claim -- no signup path here.
    const authCheck = await verifyOwnership(uid, idToken);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    const userDoc = await db.doc(`users/${uid}`).get();
    // A freshly-signed-up user may have no Firestore doc yet -- treat that
    // the same as "no connected accounts" rather than throwing, same as
    // get-provider-access-token.ts/create-experiment.ts.
    const userData: UserData = (userDoc.data() as UserData) || ({} as UserData);

    const tokenResult = await resolveToken(userData, {
      storageProvider: provider as StorageProviderId,
      owner: uid,
    } as ExperimentData);

    // Any token-resolution failure (not connected, expired, etc.) becomes
    // an empty warnings list, NOT an error response -- this endpoint is
    // advisory only and must never block or confuse setup. The connect flow
    // and create-experiment.ts are where a real, blocking error for these
    // cases belongs; by the time setup UI calls this, the "connect your
    // account" CTA has already been decided from userData directly.
    if (!tokenResult.success) {
      res.status(200).json({ warnings: [] });
      return;
    }

    if (!storageProvider.setupWarnings) {
      res.status(200).json({ warnings: [] });
      return;
    }

    let warnings: string[];
    try {
      warnings = await storageProvider.setupWarnings({
        token: tokenResult.token,
        serverUrl: tokenResult.serverUrl,
      });
    } catch (e) {
      // setupWarnings is documented to never throw, but this endpoint is
      // advisory-only -- defend against a provider implementation that
      // breaks that contract rather than letting it 500 an experiment-setup
      // page.
      console.error(
        "Error getting provider setup warnings:",
        e instanceof Error ? e.message : "Unknown error"
      );
      warnings = [];
    }

    res.status(200).json({ warnings });
  } catch (error) {
    // Never a 5xx for a provider-side problem -- but a genuinely unexpected
    // failure here (e.g. a Firestore outage) still needs *some* response,
    // and 200 { warnings: [] } is indistinguishable from "nothing to
    // report", which is the correct fail-open behavior for an advisory-only
    // endpoint.
    console.error(
      "Error getting provider setup warnings:",
      error instanceof Error ? error.message : "Unknown error"
    );
    res.status(200).json({ warnings: [] });
  }
});
