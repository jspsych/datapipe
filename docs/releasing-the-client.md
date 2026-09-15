# Releasing datapipe-client

`packages/client` is the only thing this repository publishes to npm. Everything
else here is deployed, and has no version anyone outside the repository depends
on.

Releases authenticate with npm **trusted publishing** rather than a stored
token. npm trusts one named workflow file in one named repository, and trades
the OIDC token GitHub mints for that run for a credential good for a single
publish. Nothing long-lived sits in this repository's secrets, and a leaked
workflow log cannot be replayed into a publish.

## One-time setup

### 1. Publish 0.1.0 by hand

A trusted publisher is configured on a package's settings page, which means the
package has to exist first. There is no way around this for the first release of
a brand-new name. (If npm has since added a way to pre-register a publisher for
an unclaimed name, prefer that and skip this step.)

From `packages/client`, logged in as the account that should own the name:

```
npm run build
npm test
npm publish --access public
```

`datapipe-client` is unscoped, so whoever publishes first owns the name — this
is the step that claims it. Afterwards, add anyone else who needs it:

```
npm owner add <username> datapipe-client
```

Then set `version` in `packages/client/package.json` to `0.1.0` to match what
you just published, and delete the initial changeset, so the automation's first
run computes `0.1.1` (or `0.2.0`) rather than trying to republish `0.1.0`.

### 2. Configure the trusted publisher

On npmjs.com, go to the `datapipe-client` package → Settings → Trusted
Publishing → Add GitHub Actions, and enter:

| Field | Value |
| --- | --- |
| Organization or user | `jspsych` |
| Repository | `datapipe` |
| Workflow filename | `release-client.yml` |
| Environment | leave blank |

The workflow filename is part of the trust. Renaming or moving
`.github/workflows/release-client.yml` revokes publishing until this is updated
to match, and the failure surfaces as an authentication error rather than a
configuration one. If you fill in Environment here, the job in that workflow
must declare the same `environment:`, or every publish is rejected.

### 3. Let Actions open pull requests

Settings → Actions → General → Workflow permissions:

- **Read and write permissions**
- tick **Allow GitHub Actions to create and approve pull requests**

Without the second one, the workflow runs green all the way to the point where
it tries to open the version pull request, then fails. An organization-level
Actions policy can override the repository setting, so check there too if it
does not take effect.

### 4. Turn off any remaining token

If an `NPM_TOKEN` secret exists in this repository from an earlier setup, delete
it. The workflow no longer reads it, and leaving a publish-capable credential
lying around is the thing trusted publishing exists to avoid.

## Cutting a release

1. Land the change on `main` with a changeset (`npm run changeset` at the
   repository root).
2. The workflow opens a pull request titled **Release datapipe-client** that
   applies the version bump and writes `CHANGELOG.md`.
3. Merge it. The workflow publishes and tags.

Provenance is attested automatically under trusted publishing; there is nothing
to configure for it.

## When it goes wrong

npm refuses to republish a version, so a bad release is superseded rather than
fixed. Check the log for these first:

| Symptom | Cause |
| --- | --- |
| `ENEEDAUTH`, or npm asks for a token | The npm CLI is older than 11.5.1 and does not speak OIDC. The workflow pins a newer one; check that step ran. |
| `unable to authenticate` on publish | The trusted publisher does not match: wrong repository, or the workflow file was renamed. |
| Publish rejected, everything else fine | An Environment is set on npm but the job does not declare it. |
| Version pull request never appears | Actions is not allowed to create pull requests (step 3). |
| Version pull request is empty, or "no packages to publish" | `changesets/action` is running with `cwd: packages/client`, which is not a workspace member. Fall back to publishing by hand once and open an issue. |

## Release order

The client is the bottom of a chain. `@jspsych/extension-pipe` depends on it, so
it has to reach npm before the extension's CI can build, and both have to be out
before DataPipe's docs can honestly recommend them.
