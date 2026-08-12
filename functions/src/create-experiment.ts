// Server-side experiment creation
// (scratchpad/step7a-create-endpoint-spec.md, docs/provider-migration-design.md).
//
// This is now the ONLY way an experiment gets created. It used to be one of
// two: OSF experiments were built in the browser (which was viable only
// because the OSF token flow lived client-side), and everything else came
// through here. OSF is shutting down its projects feature, so that path is
// gone along with the option to create an OSF experiment at all -- see the
// provider check below, backed by firestore.rules.
//
// A server-side path is what the design wanted regardless:
// createDataContainer needs the decrypted, possibly-refreshed provider token
// that only resolve-token.ts can produce, and the resulting container ref
// must be folded into the experiment doc atomically with its creation.
//
// The field defaults below (including requiredFields: ["trial_type"]) are the
// ones the removed client-side path also wrote, so documents created before
// and after the change stay uniform for every other consumer (api-data.ts,
// the dashboard, etc.).

import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { customAlphabet } from "nanoid";
import { db } from "./app.js";
import { verifyOwnership } from "./connect-provider.js";
import resolveToken from "./resolve-token.js";
import { getProvider, listProviders } from "./providers/index.js";
import { ContainerRef, StorageProviderId, ResolvedAuth } from "./providers/types.js";
import { ExperimentData, UserData } from "./interfaces.js";
import MESSAGES from "./api-messages.js";

// Same alphabet/length the removed client-side OSF path used, so experiment
// ids stay uniform across everything created before and after that path was
// retired.
const generateExperimentId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12
);

interface ExperimentSettingsOverrides {
  nConditions?: number;
  useValidation?: boolean;
  allowJSON?: boolean;
  allowCSV?: boolean;
  requiredFields?: string[];
  limitSessions?: boolean;
  maxSessions?: number;
}

export const createExperiment = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const {
      provider,
      title,
      idToken,
      uid,
      experimentSettings,
      parentFolderId,
      researcherInput,
    }: {
      provider?: string;
      title?: string;
      idToken?: string;
      uid?: string;
      experimentSettings?: ExperimentSettingsOverrides;
      // Researcher-chosen Drive folder (via the Picker) to create the
      // experiment's data folder under, instead of the default DataPipe
      // root. Optional and provider-shaped -- createDataContainer ignores it
      // for providers that don't understand a parentId. This is a LEGACY
      // wire param that predates the generic containerInput mechanism below;
      // new providers use researcherInput instead, but this must keep
      // working because the shipped Drive-picker client sends it and
      // several tests pin the wire name.
      parentFolderId?: string;
      // Generic, provider-shaped researcher input for createDataContainer
      // (e.g. collectionAlias/authorName/... for Dataverse). Validated below
      // against the target provider's declared containerInput fields --
      // create-experiment never names a specific provider's shape.
      researcherInput?: Record<string, unknown>;
    } = req.body || {};

    if (!provider || !title || !uid) {
      res.status(400).json(MESSAGES.MISSING_PARAMETER);
      return;
    }

    // Verify the caller owns the uid they claim -- same shape as
    // connect-provider.ts's storage-grant flow (401 missing/invalid token,
    // 403 uid mismatch). No signup path here, ever.
    const authCheck = await verifyOwnership(uid, idToken);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    // OSF is closed to new experiments -- it is shutting down its projects
    // feature. The osfProvider adapter stays registered (in-flight
    // experiments still write through it) and its createDataContainer throws
    // "not implemented", but this rejects the request up front rather than
    // relying on that. firestore.rules enforces the same thing on the
    // document itself.
    if (provider === "osf" || !listProviders().includes(provider as StorageProviderId)) {
      res.status(400).json({ error: "Unsupported provider" });
      return;
    }

    const storageProvider = getProvider(provider as StorageProviderId);

    // Build the container input generically -- no provider is ever named
    // here. `title` is always injected: every provider needs a human name
    // for its container, and gdrive's adapter reads it as `name`.
    const containerInput: Record<string, unknown> = {
      name: title,
      title,
      ...(researcherInput || {}),
    };
    // Legacy wire param: this predates the containerInput mechanism above.
    // The shipped Drive-picker client sends parentFolderId at the top level
    // (not inside researcherInput), so fold it in unconditionally -- no
    // provider branch, just "if this legacy field was sent, map it in".
    // New providers use researcherInput instead.
    if (parentFolderId) {
      containerInput.parentId = parentFolderId;
    }

    // Validate against the provider's declared containerInput spec BEFORE
    // resolving a token -- no point refreshing/decrypting a credential for a
    // request that cannot possibly succeed.
    const missing = storageProvider.containerInput
      .filter((f) => f.required && !containerInput[f.name])
      .map((f) => f.name);
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing required fields for ${provider}: ${missing.join(", ")}` });
      return;
    }

    const userDocRef = db.doc(`users/${uid}`);
    const userDoc = await userDocRef.get();
    // A freshly-signed-up user may have no Firestore doc yet -- treat that
    // the same as "no connected accounts" rather than throwing, so the
    // PROVIDER_NOT_CONNECTED surface below applies uniformly.
    const userData: UserData = (userDoc.data() as UserData) || ({} as UserData);

    const tokenResult = await resolveToken(userData, {
      storageProvider: provider as StorageProviderId,
      owner: uid,
    } as ExperimentData);

    if (!tokenResult.success) {
      const errorMessage =
        MESSAGES[tokenResult.error as keyof typeof MESSAGES] || MESSAGES.TOKEN_RESOLUTION_ERROR;
      res.status(400).json(errorMessage);
      return;
    }

    const auth: ResolvedAuth = { token: tokenResult.token, serverUrl: tokenResult.serverUrl };

    let providerContainer: ContainerRef;
    try {
      providerContainer = await storageProvider.createDataContainer(auth, containerInput);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Unknown error";
      res.status(502).json({ error: "Failed to create storage container", detail });
      return;
    }

    const settings = experimentSettings || {};
    const nConditions = settings.nConditions ?? 1;
    const useValidation = settings.useValidation ?? true;
    const allowJSON = settings.allowJSON ?? true;
    const allowCSV = settings.allowCSV ?? true;
    const requiredFields = settings.requiredFields ?? ["trial_type"];
    const limitSessions = settings.limitSessions ?? false;
    const maxSessions = settings.maxSessions ?? 1;

    const experimentID = generateExperimentId();

    const experimentDocRef = db.collection("experiments").doc(experimentID);

    const batch = db.batch();
    batch.set(experimentDocRef, {
      title,
      active: false,
      activeBase64: false,
      activeConditionAssignment: false,
      sessions: 0,
      limitSessions,
      maxSessions,
      id: experimentID,
      owner: uid,
      nConditions,
      currentCondition: 0,
      useValidation,
      allowJSON,
      allowCSV,
      requiredFields,
      storageProvider: provider,
      providerContainer,
    });
    // set+merge (not update) -- a freshly-signed-up user may have no
    // Firestore doc yet, same rationale as connect-provider.ts's
    // set()+mergeFields for connectedAccounts.
    batch.set(
      userDocRef,
      { experiments: FieldValue.arrayUnion(experimentID) },
      { merge: true }
    );

    await batch.commit();

    res.status(200).json({ success: true, experimentID, providerContainer });
  } catch (error) {
    console.error("Error creating experiment:", error instanceof Error ? error.message : "Unknown error");
    res.status(500).json({ error: "Failed to create experiment" });
  }
});
