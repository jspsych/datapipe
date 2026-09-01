import { auth } from "./firebase";

// Experiment creation is now entirely server-side, for every provider.
//
// It used to be split: OSF experiments were built in the browser (fetch the
// researcher's OSF token, POST a child component to the OSF API, then
// batch-write Firestore with the client SDK) while every other provider went
// through /api/createexperiment. That OSF path is gone -- OSF is shutting
// down its projects feature and firestore.rules now refuses to create an
// experiment whose storageProvider is 'osf' (or absent, which meant OSF by
// default). Existing OSF experiments are untouched and keep collecting; see
// lib/osf-sunset.js.
//
// The server needs to own creation anyway: createDataContainer requires the
// decrypted, possibly-refreshed provider token that only resolve-token.ts can
// produce, and the resulting container ref must land in the experiment
// document atomically with its creation.
export async function createProviderExperiment(provider, title, parentFolderId, researcherInput) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("User not authenticated");
  }

  const idToken = await user.getIdToken();

  const response = await fetch("/api/createexperiment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider,
      title,
      uid: user.uid,
      idToken,
      ...(parentFolderId ? { parentFolderId } : {}),
      ...(researcherInput && Object.keys(researcherInput).length > 0
        ? { researcherInput }
        : {}),
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Failed to create experiment: ${response.status}`);
  }

  return {
    experimentId: data.experimentID,
  };
}
