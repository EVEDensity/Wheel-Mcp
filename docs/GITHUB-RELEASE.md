# GitHub packaging and release

Wheel-mcp publishes a prebuilt runtime archive through GitHub Releases, not the
npm registry. Releases cover Windows, Godot 4.7.2 and trusted local stdio projects.
The daily push/PR workflow stays short; the release workflow runs only on a
version tag or explicit manual dispatch.

## Prepare the source

Keep `package.json`, the root/package lock versions and
`scripts/lib/local-release.mjs` in sync. Update the changelog and install examples.
Run `npm.cmd run release:gate`, then `npm.cmd run release:check`. The gate has a
ten-minute total limit and rejects failures, skipped tests, stale evidence,
unfinished cleanup, changed source and mismatched artifacts.

Commit the accepted source to main and push it. Review the short CI result.
Create an annotated stable version tag on that exact commit, then push the tag:

```powershell
git tag -a v0.2.2 -m "Wheel-mcp 0.2.2 Windows local stable"
git push origin v0.2.2
```

Use the next unused version for subsequent releases. Never move a published tag
or overwrite its assets. Manual dispatch of `release.yml` also requires an
existing tag matching the checkout and package version, reachable from origin/main.

## Hosted acceptance and publication

The Windows build job uses a read-only token, pinned actions, locked dependencies
and a SHA-256 verified Godot download. It repeats the bounded release gate,
including native safety, headless runtime and installation of the actual archive.
The build job is capped at fifteen minutes; it does not run the deferred soak or
full authoring/renderer matrix.

A separate job receives only the generated artifacts, not a source checkout.
It checks local hashes, creates a draft, uploads four assets, then checks the
GitHub-reported size and SHA-256 of every asset before publishing:

- `wheel-mcp-VERSION.tgz`: prebuilt runtime in npm archive format.
- `sbom.json`: CycloneDX dependency inventory.
- `acceptance.json`: exact source, versions, suite results and package hashes.
- `SHA256SUMS`: checksums for the archive, SBOM and acceptance receipt.

Only the publication job has repository write permission. No job publishes npm
packages or changes repository visibility. Build artifacts and bounded failure
diagnostics expire after seven days; published release assets remain available.

## Install and verify the download

Download the four assets from the same release and compare their hashes against
`SHA256SUMS` before installation. On Windows, for example:

```powershell
Get-FileHash .\wheel-mcp-0.2.2.tgz -Algorithm SHA256
npm.cmd install --ignore-scripts .\wheel-mcp-0.2.2.tgz
```

Godot must be installed separately. Configure the installed server's absolute
path in the MCP client with explicit project/evidence roots and least-privilege
scopes. See [first project setup](GETTING-STARTED.md). Restart the MCP server after
updating; running sessions do not automatically load a new bridge script.

## Failure recovery and scope

A failed build cannot publish a Release. An upload or hash failure leaves a draft
for investigation, not a public release. Do not rerun over an existing release:
inspect the failure and choose a new version for changed source. Keep failed
acceptance as failure rather than replacing it with a partial successful check.

Approvals in automated acceptance are explicit test doubles. Hosted tests are
headless; the local screenshot pixel checks do not certify hosted GPU behavior.
Other platforms/clients, public HTTP, high-load/long-session behavior and complete
authoring remain outside the local stable profile. Full production qualification
remains `NOT_QUALIFIED`; see [release scope](LOCAL-STABLE-RELEASE.md).
