// Server-side experiment creation for non-OSF storage providers
// (scratchpad/step7a-create-endpoint-spec.md, docs/provider-migration-design.md).
//
// OSF experiment creation stays entirely browser-driven (see
// lib/experiment-creation.js) -- the browser calls the OSF API directly and
// batch-writes Firestore with a Firebase client SDK, which is fine because
// the OSF token flow already lives client-side. New providers (starting with
// gdrive) need a server-side path instead: createDataContainer is
// server-only (it needs the decrypted, possibly-refreshed provider token
// that only resolve-token.ts can produce), and the resulting container ref
// must be folded into the experiment doc atomically with its creation.
//
// This endpoint intentionally mirrors createExperimentDocument in
// lib/experiment-creation.js field-for-field (including the
// requiredFields: ["trial_type"] default, which the client hardcodes rather
// than parameterizes) so that gdrive- and OSF-created experiment docs stay
// uniform for every other consumer (api-data.ts, the dashboard, etc.).

import { onRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { customAlphabet } from "nanoid";
import { db } from "./app.js";
import { verifyOwnership } from "./connect-provider.js";
import resolveToken from "./resolve-token.js";
import { getProvider, listProviders } from "./providers/index.js";
import { ContainerRef, StorageProviderId } from "./providers/types.js";
import { ExperimentData, UserData } from "./interfaces.js";
import MESSAGES from "./api-messages.js";

// Same alphabet/length as lib/experiment-creation.js's
// customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 12)
// -- experiment ids must stay uniform whether created client-side (OSF) or
// server-side (gdrive and later providers).
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
    }: {
      provider?: string;
      title?: string;
      idToken?: string;
      uid?: string;
      experimentSettings?: ExperimentSettingsOverrides;
      // Researcher-chosen Drive folder (via the Picker) to create the
      // experiment's data folder under, instead of the default DataPipe
      // root. Optional and provider-shaped -- createDataContainer ignores it
      // for providers that don't understand a parentId.
      parentFolderId?: string;
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

    // OSF creation stays browser-driven; only registered NON-osf providers
    // may be created through this endpoint.
    if (provider === "osf" || !listProviders().includes(provider as StorageProviderId)) {
      res.status(400).json({ error: "Unsupported provider" });
      return;
    }

    const storageProvider = getProvider(provider as StorageProviderId);

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

    let providerContainer: ContainerRef;
    try {
      providerContainer = await storageProvider.createDataContainer(
        { token: tokenResult.token },
        { name: title, ...(parentFolderId ? { parentId: parentFolderId } : {}) }
      );
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
