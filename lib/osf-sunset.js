// Single source of truth for DataPipe's OSF wind-down.
//
// OSF is shutting down its projects feature. New experiments can no longer be
// created against OSF (enforced in firestore.rules, not just in the UI), but
// experiments already collecting data keep writing until the date below.
// Everything researcher-facing about the wind-down reads from here so the
// date is stated in exactly one place.

// ISO date (YYYY-MM-DD) after which DataPipe stops writing to OSF, or null if
// no date has been announced yet.
//
// The code tolerates null (banners appear but name no deadline), which is how
// this shipped before the cutoff was agreed. It is set now, so every
// researcher-facing surface states the same date.
export const OSF_SUNSET_DATE = "2026-11-16";

// Human-readable form of OSF_SUNSET_DATE, or null when unset.
export function osfSunsetLabel() {
  if (!OSF_SUNSET_DATE) return null;
  // Parsed as UTC (the "YYYY-MM-DD" form always is) and formatted in UTC, so
  // the date shown is the date written above regardless of the reader's
  // timezone -- otherwise researchers west of UTC would see the day before.
  return new Date(`${OSF_SUNSET_DATE}T00:00:00Z`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// True for an experiment that writes to OSF. Experiments created before the
// provider-migration schema have no storageProvider field at all and always
// meant OSF -- mirrors getProviderForExperiment in
// functions/src/providers/index.ts, which applies the same legacy default.
export function isLegacyOsfExperiment(experiment) {
  if (!experiment) return false;
  return !experiment.storageProvider || experiment.storageProvider === "osf";
}

// True when a users/{uid} document shows any OSF credential, by either route:
// the OAuth grant (authMethod/refreshToken) or the pasted personal access
// token (usingPersonalToken/osfToken). Used to decide whether to show the
// legacy OSF surfaces at all -- a researcher who never connected OSF should
// never see them.
export function hasLegacyOsfConnection(userDoc) {
  if (!userDoc) return false;
  return Boolean(
    userDoc.authMethod === "osf" ||
      userDoc.osfUserId ||
      userDoc.refreshToken ||
      userDoc.osfToken
  );
}
