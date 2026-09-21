/**
 * @jest-environment node
 *
 * The pinned datapipe-client version in the pasted <script> tags has to follow
 * the package. Changesets bumps packages/client/package.json in the release
 * PR. This suite fails there until the docs samples and the client README are
 * bumped to match, so neither goes on pointing at an old release.
 */

import fs from "fs";
import path from "path";
import {
  DATAPIPE_CLIENT_VERSION,
  DATAPIPE_CLIENT_SCRIPT,
  EXTENSION_PIPE_SCRIPT,
} from "../components/dashboard/script-tags";

const clientDir = path.join(__dirname, "..", "packages", "client");
const { version } = JSON.parse(
  fs.readFileSync(path.join(clientDir, "package.json"), "utf8")
);

test("the docs pin the current datapipe-client version", () => {
  expect(DATAPIPE_CLIENT_VERSION).toBe(version);
});

test("the client README pins the current version", () => {
  const readme = fs.readFileSync(path.join(clientDir, "README.md"), "utf8");
  const pins = [...readme.matchAll(/unpkg\.com\/datapipe-client(@[^/"]+)?/g)];
  expect(pins.length).toBeGreaterThan(0);
  for (const [, pin] of pins) expect(pin).toBe(`@${version}`);
});

test("both script tags carry an exact version", () => {
  expect(DATAPIPE_CLIENT_SCRIPT).toMatch(/datapipe-client@\d+\.\d+\.\d+"/);
  expect(EXTENSION_PIPE_SCRIPT).toMatch(/extension-pipe@\d+\.\d+\.\d+"/);
});
