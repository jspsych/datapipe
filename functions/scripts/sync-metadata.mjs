#!/usr/bin/env node
/**
 * sync-metadata.mjs — refresh the vendored @jspsych/metadata copy in functions/metadata/.
 *
 * WHY THIS EXISTS
 *   DataPipe depends on @jspsych/metadata, but the version published to npm is stale
 *   (it lags the fixes that live on the repo's main branch — e.g. nested-object/array
 *   expansion and the getExtractedArrays/Objects APIs). Until upstream cuts a fresh npm
 *   release, we vendor the package: build it from a PINNED upstream commit and commit the
 *   built dist into functions/metadata/. `functions/package.json` references it as
 *   "file:metadata", and functions/src imports "../metadata/dist/index.js" directly, so
 *   deploys need NO metadata build step.
 *
 * WHAT IT DOES
 *   1. Clone the upstream repo into a temp dir at a chosen ref (default: main).
 *   2. Install + build packages/metadata there.
 *   3. Replace functions/metadata/ with the freshly built dist + package.json + LICENSE.
 *   4. Record exact provenance (source repo, commit SHA, commit date) in VENDORED_FROM.json
 *      and regenerate functions/metadata/README.md.
 *
 * USAGE
 *   npm run sync:metadata                       # vendor from upstream main
 *   npm run sync:metadata -- --ref <sha|branch> # vendor from a specific commit/branch
 *   METADATA_REPO=/path/to/local/clone npm run sync:metadata   # use a local clone (faster)
 *
 * EXIT PLAN
 *   The day @jspsych/metadata ships a released npm version containing these fixes, delete
 *   this script + functions/metadata/, and set functions/package.json's dependency to the
 *   published "^x.y.z". Then semver does the tracking and this whole mechanism goes away.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = "https://github.com/jspsych/metadata.git";
const PACKAGE_SUBDIR = "packages/metadata";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const functionsDir = join(scriptDir, "..");           // functions/
const vendorDir = join(functionsDir, "metadata");     // functions/metadata/

function parseArgs(argv) {
  const args = { ref: "main", repo: process.env.METADATA_REPO || DEFAULT_REPO };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ref") args.ref = argv[++i];
    else if (argv[i] === "--repo") args.repo = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

// Run a command, streaming its output; throws on non-zero exit. shell:true so npm/npm.cmd
// resolves on Windows as well as POSIX.
function run(cmd, cmdArgs, cwd) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(" ")}   (in ${cwd})`);
  return execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell: true });
}

function capture(cmd, cmdArgs, cwd) {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: "utf8", shell: true }).trim();
}

function main() {
  const { ref, repo } = parseArgs(process.argv.slice(2));
  const tmp = mkdtempSync(join(tmpdir(), "metadata-sync-"));
  const checkout = join(tmp, "metadata");

  try {
    console.log(`Vendoring @jspsych/metadata from ${repo} @ ${ref}`);

    // 1. Clone + pin. Cloning a local path works too (copies committed history only).
    run("git", ["clone", "--no-single-branch", repo, checkout], tmp);
    run("git", ["checkout", ref], checkout);
    const commit = capture("git", ["rev-parse", "HEAD"], checkout);
    const commitDate = capture("git", ["show", "-s", "--format=%cI", "HEAD"], checkout);
    const shortSha = commit.slice(0, 12);

    // 2. Install the monorepo, then build just the metadata package.
    const pkgDir = join(checkout, PACKAGE_SUBDIR);
    if (!existsSync(pkgDir)) throw new Error(`${PACKAGE_SUBDIR} not found in ${repo}@${ref}`);
    const installCmd = existsSync(join(checkout, "package-lock.json")) ? "ci" : "install";
    run("npm", [installCmd, "--no-audit", "--no-fund"], checkout);
    run("npm", ["run", "build"], pkgDir);

    const builtDist = join(pkgDir, "dist");
    if (!existsSync(builtDist)) throw new Error("build did not produce a dist/ directory");
    const pkg = JSON.parse(capture("node", ["-p", "JSON.stringify(require('./package.json'))"], pkgDir));
    const version = pkg.version;

    // 3. Replace functions/metadata/ with the fresh build. Wipe first so removed upstream
    //    files don't linger. Keep only what runtime/deploy needs: dist, package.json, LICENSE.
    rmSync(vendorDir, { recursive: true, force: true });
    mkdirSync(vendorDir, { recursive: true });
    cpSync(builtDist, join(vendorDir, "dist"), { recursive: true });

    // Sanitize package.json: we ship only the built dist, so strip everything that would
    // run or resolve against source at install time. Crucially, drop `scripts` — upstream
    // has a `prepare: "npm run build"` that npm runs for `file:` deps on install; with no
    // src/build-config/build-deps here that would fail `npm install` in functions/. Keep the
    // runtime `dependencies` (e.g. csv-parse, which dist/index.js imports, not bundled).
    delete pkg.scripts;
    delete pkg.devDependencies;
    pkg.files = ["dist"];
    writeFileSync(join(vendorDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    // Preserve the upstream license for attribution. It may sit in the package dir or, in a
    // monorepo, only at the repo root — check the package first, then fall back to the root.
    for (const lic of ["LICENSE", "LICENSE.md", "license"]) {
      const src = existsSync(join(pkgDir, lic)) ? join(pkgDir, lic)
        : existsSync(join(checkout, lic)) ? join(checkout, lic)
        : null;
      if (src) { cpSync(src, join(vendorDir, "LICENSE")); break; }
    }

    // 4. Provenance + generated README.
    const provenance = {
      source: repo === process.env.METADATA_REPO ? DEFAULT_REPO : repo,
      package: "@jspsych/metadata",
      version,
      ref,
      commit,
      commitDate,
      syncedAt: new Date().toISOString(),
      note: "Generated by functions/scripts/sync-metadata.mjs — do not edit dist/ by hand.",
    };
    writeFileSync(join(vendorDir, "VENDORED_FROM.json"), JSON.stringify(provenance, null, 2) + "\n");
    writeFileSync(join(vendorDir, "README.md"), renderReadme(provenance, shortSha));

    console.log(`\n✔ Vendored @jspsych/metadata ${version} @ ${shortSha} (${commitDate})`);
    console.log("  Review the diff, run the functions tests, then commit functions/metadata/.");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function renderReadme(p, shortSha) {
  return `# Vendored @jspsych/metadata (GENERATED — do not hand-edit)

This directory is a **built, committed copy** of \`@jspsych/metadata\`, produced by
\`functions/scripts/sync-metadata.mjs\`. \`functions/package.json\` references it as
\`"file:metadata"\` and \`functions/src\` imports \`../metadata/dist/index.js\` directly, so
deploys need no metadata build step.

## Why vendored instead of an npm dependency?
The version published to npm lags the fixes on the upstream \`main\` branch (nested
object/array expansion, the \`getExtractedArrays\`/\`getExtractedObjects\` APIs, etc.). We
pin to a specific upstream commit and rebuild from it until upstream cuts a fresh release.

## Current pin
- **Package:** ${p.package} ${p.version}
- **Source:** ${p.source}
- **Commit:** \`${p.commit}\` (${shortSha}), ${p.commitDate}
- **Synced:** ${p.syncedAt}

(Machine-readable: \`VENDORED_FROM.json\`.)

## Re-syncing with upstream
\`\`\`
cd functions
npm run sync:metadata                         # from upstream main
npm run sync:metadata -- --ref <sha|branch>   # from a specific commit
\`\`\`
Then review the diff, run \`npm test\` at the repo root, and commit \`functions/metadata/\`.
A scheduled CI job (\`.github/workflows/metadata-drift-check.yml\`) flags when upstream main
has moved past this pin.

## Exit plan
When \`@jspsych/metadata\` ships a released npm version with these fixes, delete this
directory and the sync script, and set the dependency to the published \`"^x.y.z"\`.
`;
}

main();
