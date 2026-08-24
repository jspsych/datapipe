// Marks for the storage providers in lib/provider-config.js, keyed by the
// same registry id, plus OSF (reused from components/OsfIcon.js) for
// contexts that still reference it (e.g. the OSF-specific sign-in and
// account-linking surfaces). Kept out of lib/ on purpose, same reasoning as
// components/AuthProviderIcons.js: lib/ holds plain data so it stays
// importable from plain unit tests without JSX.
//
// Unlike AuthProviderIcons' federated-sign-in marks, these are hand-authored
// monochrome glyphs rather than brand reproductions -- DataPipe is a
// dark-only theme and DESIGN.md forbids stray hues, so there is no "on brand
// background" surface for a multi-color logo to sit on. Every mark below
// draws only with `currentColor`, inherits the surrounding text's color, and
// is deliberately generic (a drive, a stacked dataset, an archive box) rather
// than a copy of the provider's actual logo.
//
// Adding a provider means adding an entry here as well as to
// STORAGE_PROVIDERS in lib/provider-config.js. A missing icon is not fatal --
// callers guard with `PROVIDER_ICONS[id] &&` the same way AuthProviderButtons
// guards AUTH_PROVIDER_ICONS.
import { OsfIcon } from "./OsfIcon";

export const GoogleDriveIcon = (props) => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="currentColor"
    aria-hidden="true"
    {...props}
  >
    <path d="M12 3.5 3.5 18.5h17z" />
  </svg>
);

export const DataverseIcon = (props) => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
    <path d="M4.5 5.5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" />
    <path d="M4.5 11.5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" />
  </svg>
);

export const ZenodoIcon = (props) => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M3.5 8.5 5.75 4.5h12.5l2.25 4" />
    <rect x="3.5" y="8.5" width="17" height="11" rx="1.25" />
    <path d="M9 13h6" />
  </svg>
);

export const PROVIDER_ICONS = {
  osf: OsfIcon,
  gdrive: GoogleDriveIcon,
  dataverse: DataverseIcon,
  zenodo: ZenodoIcon,
};
