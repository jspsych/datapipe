// Triggers a provider adapter's ensureDerivedPaths hook (providers/types.ts)
// right after a researcher switches Psych-DS metadata ON, so the Drive
// data/raw/ chain is pre-created while the container still has zero
// submissions -- the one moment that is guaranteed race-free, because
// firestore.rules freezes metadataActive the instant an experiment has data
// (metadataChoiceRespected/hasCollectedData) and MetadataControl.js enforces
// the same freeze client-side. See gdrive.ts's ensureDerivedPaths for the
// race this removes (spike gate H, 2026-08-21) and why it used to live in
// createDataContainer instead.
//
// Deliberately best-effort end to end: this exists ONLY to remove a race
// that the write path already tolerates (it creates the same folders on
// demand, see gdrive.ts's writeSessionFile). MetadataControl.js calls this
// fire-and-forget immediately after a successful metadataActive write, so a
// failure here must never look like the metadata switch itself failed --
// which is why every branch below resolves 200, and a provider-side failure
// is logged, never thrown as a 5xx.
//
// Auth/ownership shape is copied from api-finalize.ts: Bearer idToken,
// auth.verifyIdToken, load experiments/{id}, require owner === uid, with the
// same 403-for-both convention for "doesn't exist" and "not yours" so this
// endpoint never confirms which experiment ids exist to a caller who
// doesn't already own one.
import { onRequest } from "firebase-functions/v2/https";
import { db, auth } from "./app.js";
import resolveToken from "./resolve-token.js";
import { getProviderForExperiment } from "./providers/index.js";
import { ResolvedAuth, StorageProvider, ContainerRef } from "./providers/types.js";
import { ExperimentData, UserData } from "./interfaces.js";

function experimentRef(experimentID: string) {
  return db.collection("experiments").doc(experimentID);
}

// Same test as firestore.rules' hasCollectedData() and MetadataControl.js's
// own hasCollectedData() -- see either comment for why `sessions` and
// `collisionCache` are the two signals. Re-checked here, server-side, rather
// than trusted from the client: this endpoint must never be usable to touch
// an experiment mid-collection, even by a caller who bypasses the dashboard
// entirely and calls it directly.
function hasCollectedData(expData: ExperimentData): boolean {
  return (typeof expData.sessions === "number" && expData.sessions > 0) || !!expData.collisionCache;
}

export const ensureDerivedPaths = onRequest({ cors: true }, async (req, res) => {
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
  try {
    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    uid = decodedToken.uid;
  } catch {
    res.status(401).json({ error: "Invalid authentication token" });
    return;
  }

  const experimentID = req.body?.experimentID as string | undefined;
  if (!experimentID) {
    res.status(400).json({ error: "experimentID is required" });
    return;
  }

  const expRef = experimentRef(experimentID);
  const expSnap = await expRef.get();
  // Same 403-for-both convention as api-finalize.ts: a nonexistent
  // experiment and someone else's experiment get the identical response.
  if (!expSnap.exists || expSnap.data()?.owner !== uid) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const expData = expSnap.data() as ExperimentData;

  // The gate that matters: metadata off, or data already collected, is a
  // silent no-op rather than an error. Either means there is nothing this
  // endpoint is allowed to do -- metadata off has no derived-path chain to
  // pre-create, and data already collected means metadataActive is already
  // frozen (firestore.rules would refuse the write that would have gotten it
  // here anyway).
  if (expData.metadataActive !== true || hasCollectedData(expData)) {
    res.status(200).json({ status: "noop" });
    return;
  }

  let provider: StorageProvider;
  let container: ContainerRef;
  try {
    ({ provider, container } = getProviderForExperiment(expData));
  } catch {
    // Unresolvable storageProvider id -- nothing to call. Same posture as
    // resolve-token.ts wrapping this same lookup.
    res.status(200).json({ status: "noop" });
    return;
  }

  if (!provider.ensureDerivedPaths) {
    // Most providers: no nested-container race to remove, by design (see
    // StorageProvider.ensureDerivedPaths).
    res.status(200).json({ status: "noop" });
    return;
  }

  const userDoc = await db.doc(`users/${expData.owner}`).get();
  // A missing user doc means resolveToken will report PROVIDER_NOT_CONNECTED
  // below -- same fallback create-experiment.ts uses rather than a special
  // case here.
  const userData: UserData = (userDoc.data() as UserData) || ({} as UserData);

  try {
    const tokenResult = await resolveToken(userData, expData);
    if (!tokenResult.success) {
      console.warn(
        `ensureDerivedPaths: token resolution failed for experiment ${experimentID}: ${tokenResult.error}`
      );
      res.status(200).json({ status: "noop" });
      return;
    }
    const resolvedAuth: ResolvedAuth = { token: tokenResult.token, serverUrl: tokenResult.serverUrl };
    await provider.ensureDerivedPaths(resolvedAuth, container);
  } catch (e) {
    // Never a 5xx for a provider-side failure -- see the module header. The
    // write path still creates the folders on demand, so this endpoint has
    // nothing left to protect once it reaches here.
    console.warn(
      `ensureDerivedPaths: best-effort pre-creation failed for experiment ${experimentID}:`,
      e instanceof Error ? e.message : e
    );
  }

  res.status(200).json({ status: "ok" });
});
