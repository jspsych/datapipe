// Points the README's unpkg URLs at the version in package.json.
//
// Runs as part of `npm run version-packages`, after `changeset version` has
// bumped package.json, so the "Release datapipe-client" PR carries the new
// pin and npm publishes a README whose script tag loads the release it
// ships with. The DataPipe site needs no counterpart: its samples read the
// version from package.json directly (components/dashboard/script-tags.js).
//
// Fails, rather than doing nothing, if the README has no unpkg URL to pin.
// A silent no-op would ship a README pointing at the previous release.

import { readFileSync, writeFileSync } from "node:fs";

const packageURL = new URL("../package.json", import.meta.url);
const readmeURL = new URL("../README.md", import.meta.url);

const { version } = JSON.parse(readFileSync(packageURL, "utf8"));
const readme = readFileSync(readmeURL, "utf8");

// Matches the URL with or without a version, so an unpinned one gets pinned.
const pin = /unpkg\.com\/datapipe-client(@[^/"\s]+)?/g;
if (!pin.test(readme)) {
  console.error("sync-readme-pin: README.md has no unpkg.com/datapipe-client URL to pin.");
  process.exit(1);
}

const updated = readme.replace(pin, `unpkg.com/datapipe-client@${version}`);
if (updated !== readme) {
  writeFileSync(readmeURL, updated);
  console.log(`sync-readme-pin: README.md now pins datapipe-client@${version}.`);
} else {
  console.log(`sync-readme-pin: README.md already pins datapipe-client@${version}.`);
}
