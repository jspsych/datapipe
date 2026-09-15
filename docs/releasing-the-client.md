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

### 1. Configure the trusted publisher

Run this from `packages/client`, logged in to npm as the account that will own
the package (`npm whoami` to check). It needs npm 11.5.1 or later.

```
npm trust github datapipe-client \
  --repo jspsych/datapipe \
  --file release-client.yml \
  --allow-publish
```

Add `--dry-run` first if you want to see what it will do, and `npm trust list
datapipe-client` afterwards to confirm it took. To undo one, `npm trust revoke
datapipe-client --id=<trust-id>`, with the id from `list`.

`--file` is the workflow's filename, and it is part of the trust: renaming or
moving `.github/workflows/release-client.yml` revokes publishing until this is
re-run to match, and the failure surfaces as an authentication error rather
than a configuration one. There is also `--environment`, which we do not set —
if you add one, the job in that workflow has to declare the same
`environment:`, or every publish is rejected.

`--allow-publish` is what grants ordinary `npm publish`. The separate
`--allow-stage-publish` covers staged publishes, which this release flow does
not use.

### 2. Publish 0.1.0 by hand, if npm asks you to

A trusted publisher may need the package to exist before it can be attached to
it. If step 1 succeeded, skip this. If npm refused because `datapipe-client` is
not published yet, claim the name first and then re-run step 1.

**Bump the version before publishing, not after.** The package sits at `0.0.0`
with a changeset pending — that is the changesets idiom for something that has
never shipped — so `npm publish` on a fresh checkout would put **0.0.0** on the
registry, and npm never lets a version be reused. `changeset version` is what
turns it into 0.1.0, and it writes `CHANGELOG.md` and consumes the changeset in
the same step, so the repository ends up agreeing with the registry:

```
cd packages/client
npx changeset version      # 0.0.0 -> 0.1.0, writes CHANGELOG.md
npm test
npm run build
npm publish --access public
```

Commit the version bump and changelog it produced. The automation then picks up
from 0.1.1 on the next changeset.

`datapipe-client` is unscoped, so whoever publishes first owns the name — this
is the step that claims it. Afterwards, add anyone else who needs it:

```
npm owner add <username> datapipe-client
```

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
