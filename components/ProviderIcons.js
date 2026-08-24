// Marks for the storage providers in lib/provider-config.js, keyed by the
// same registry id, plus OSF (reused from components/OsfIcon.js) for
// contexts that still reference it. Kept out of lib/ on purpose, same
// reasoning as components/AuthProviderIcons.js: lib/ holds plain data so it
// stays importable from plain unit tests without JSX.
//
// These are the providers' real marks, in the monochrome Simple Icons
// cut that ships with react-icons (already a dependency). Monochrome, not
// full-color: DataPipe is a dark-only theme and DESIGN.md forbids stray
// hues, so a single-color mark that inherits `currentColor` is the only
// treatment that sits on every surface here. The hand-drawn generic
// glyphs that preceded these read as "a triangle", not "Google Drive".
//
// `aria-hidden` is baked in at the source, the way AuthProviderIcons does
// it: every mark is decoration beside a text label that carries the
// accessible name. Size is react-icons' `size` prop (it sets both width and
// height AFTER spreading props, so width/height props are ignored).
//
// Adding a provider means adding an entry here as well as to
// STORAGE_PROVIDERS in lib/provider-config.js. A missing icon is not fatal --
// callers guard with `PROVIDER_ICONS[id] &&` the same way AuthProviderButtons
// guards AUTH_PROVIDER_ICONS.
import { SiGoogledrive, SiDataverse, SiZenodo } from "react-icons/si";

import { OsfIcon } from "./OsfIcon";

export const GoogleDriveIcon = (props) => (
  <SiGoogledrive aria-hidden="true" {...props} />
);

export const DataverseIcon = (props) => (
  <SiDataverse aria-hidden="true" {...props} />
);

export const ZenodoIcon = (props) => <SiZenodo aria-hidden="true" {...props} />;

// OsfIcon predates react-icons and takes width/height; adapt it to the same
// `size` prop the other three accept so callers need one calling convention.
const OsfProviderIcon = ({ size = "1em", ...props }) => (
  <OsfIcon width={size} height={size} aria-hidden="true" {...props} />
);

export const PROVIDER_ICONS = {
  osf: OsfProviderIcon,
  gdrive: GoogleDriveIcon,
  dataverse: DataverseIcon,
  zenodo: ZenodoIcon,
};
