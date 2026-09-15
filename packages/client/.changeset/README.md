# Changesets

This folder holds unreleased changes to `datapipe-client`, the one thing in this
repository that is published to npm. Everything else here — the Next.js app and
the Cloud Functions — is deployed, not published, and has no version number that
anyone outside this repository depends on.

## Why this lives in `packages/client` and not at the repository root

Changesets enumerates packages through a workspace configuration, so putting it
at the root would mean declaring npm workspaces there. That would re-hoist the
root `node_modules`, which the Firebase emulators and the Jest setup are
particular about (see the comments in `jest.config.js`), and it would put the
vitest suites in `packages/client/test/` inside the root Jest project's default
`testMatch`. None of that buys anything while there is exactly one publishable
package.

If a second package is ever published from this repository, move this folder to
the root and add `"workspaces": ["packages/*"]` at that point.

## Adding a changeset

From the repository root:

```
npm run changeset
```

Or from this directory, `npx changeset`. Either way you get a prompt for the
bump type and a summary, and a markdown file lands here. Commit it with your
change.

Write the summary for a researcher reading a changelog, not for a reviewer
reading a diff: say what is different about using the library, and why, rather
than which function you edited.

## Releasing

Pushing to `main` with changesets pending opens a "Release datapipe-client" pull
request that applies the version bump and the changelog. Merging that pull
request publishes to npm. See `.github/workflows/release-client.yml`.
