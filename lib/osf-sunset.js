// Single source of truth for DataPipe's OSF wind-down.
//
// OSF is shutting down its projects feature, so DataPipe is moving to a
// multi-backend storage model. Everything researcher-facing about the
// wind-down reads from here so the date is stated in exactly one place.

// ISO date (YYYY-MM-DD) after which DataPipe stops writing to OSF, or null if
// no date has been announced yet.
//
// The code tolerates null (banners appear but name no deadline), so the date
// can be retracted without touching any of the surfaces that display it.
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
