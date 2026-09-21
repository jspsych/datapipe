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

Or from `packages/client`, `npx changeset`. Either way you get a prompt for the
bump type and a summary, and a markdown file lands here. Commit it with your
change.

Both need `packages/client` to have been installed — `npm ci` in that directory,
once. A root `npm install` does not reach it, because this package deliberately
is not a workspace member. Skip it and you get "could not determine executable
to run", which sounds like a broken install rather than a missing one: `npx`
cannot find the local binary, so it tries to fetch a package named `changeset`
from the registry, and the package is actually called `@changesets/cli`.

Write the summary for a researcher reading a changelog, not for a reviewer
reading a diff: say what is different about using the library, and why, rather
than which function you edited.

## Releasing

Pushing to `main` with changesets pending opens a "Release datapipe-client" pull
request that applies the version bump and the changelog. Merging that pull
request publishes to npm. See `.github/workflows/release-client.yml`.

Publishing authenticates with npm **trusted publishing**, so there is no npm
token in this repository's secrets. npm trusts a specific workflow file in a
specific repository, and trades the OIDC token GitHub mints for that run for a
short-lived credential good for one publish.

Two consequences worth knowing before you change anything:

- **The trust is bound to the workflow's filename.** Renaming or moving
  `.github/workflows/release-client.yml` revokes its ability to publish until
  `npm trust github` is re-run to match. The failure looks like an
  authentication error, not a configuration one.
- **The trust is set up with the npm CLI**, not by hand on the website:
  `npm trust github datapipe-client --repo jspsych/datapipe --file
  release-client.yml --allow-publish`, and `npm trust list datapipe-client` to
  see what is configured. See `docs/releasing-the-client.md`.
