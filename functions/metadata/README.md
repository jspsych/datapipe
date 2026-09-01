# Vendored @jspsych/metadata (GENERATED — do not hand-edit)

This directory is a **built, committed copy** of `@jspsych/metadata`, produced by
`functions/scripts/sync-metadata.mjs`. `functions/package.json` references it as
`"file:metadata"` and `functions/src` imports it through the `@jspsych/metadata`
package name (never `../metadata/dist/` paths directly), so deploys need no
metadata build step.

## Why vendored instead of an npm dependency?
The version published to npm lags the fixes on the upstream `main` branch (nested
object/array expansion, the `getExtractedArrays`/`getExtractedObjects` APIs, etc.). We
pin to a specific upstream commit and rebuild from it until upstream cuts a fresh release.

## Current pin
- **Package:** @jspsych/metadata 0.0.3
- **Source:** https://github.com/jspsych/metadata.git
- **Commit:** `224d336f8c6e6c67f22e345787f7fd3256bc4cf6` (224d336f8c6e), 2026-06-26T11:29:40-04:00
- **Synced:** 2026-07-01T21:31:30.852Z

(Machine-readable: `VENDORED_FROM.json`.)

## Re-syncing with upstream
```
cd functions
npm run sync:metadata                         # from upstream main
npm run sync:metadata -- --ref <sha|branch>   # from a specific commit
```
Then review the diff, run `npm test` at the repo root, and commit `functions/metadata/`.
A scheduled CI job (`.github/workflows/metadata-drift-check.yml`) flags when upstream main
has moved past this pin.

## Exit plan
When `@jspsych/metadata` ships a released npm version with these fixes, delete this
directory and the sync script, and set the dependency to the published `"^x.y.z"`.
