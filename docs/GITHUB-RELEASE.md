# GitHub packaging and release

Wheel-mcp publishes a prebuilt runtime archive through GitHub Releases, not the
npm registry. Releases cover Windows, Godot 4.7.2 and trusted local stdio projects.
The daily push/PR workflow stays short; the release workflow runs only on a
version tag or explicit manual dispatch.

Current published installation target: **v0.2.8**. Both acceptance-only and
tag-triggered runs passed 193 tests; automatic publication and independent public
download verification also passed. See the [verification record](releases/0.2.8-ci-cd-verification.json).
v0.2.6 and v0.2.7 remain unaccepted source candidates, not published releases.
Never reuse or move their tags. The next tag example requires the next version's
source and changelog; it does not authorize retagging this release.

## Prepare the source

Keep `package.json`, the root/package lock versions and
`scripts/lib/local-release.mjs` in sync. Update the changelog and install examples.
Run `npm.cmd run release:gate`, then `npm.cmd run release:check`. The gate has a
ten-minute total limit and rejects failures, skipped tests, stale evidence,
unfinished cleanup, changed source and mismatched artifacts.

Commit the accepted source to main and push it. Review the short CI result.
First run the complete hosted acceptance on main without making a release:

```powershell
gh workflow run release.yml --ref main -f acceptance_only=true
```

This mode needs no tag. The build performs the same checks and prepares the
same artifacts, but its `publish=false` output prevents the write job from
running. An acceptance-only success is not a published Release. Review the
receipt and source commit before creating an annotated tag on that same commit:

```powershell
git tag -a v0.2.9 -m "Wheel-mcp 0.2.9 Windows local stable"
git push origin v0.2.9
```

Use the next unused version for subsequent releases. Never move a published tag
or overwrite its assets. To publish via manual dispatch, explicitly set
`acceptance_only=false`; this still requires an existing tag matching the
checkout and package version, reachable from origin/main. Tag-triggered runs
always require that existing exact tag and repeat acceptance before publication.

## Hosted acceptance and publication

The Windows build job uses a read-only token, pinned actions, locked dependencies
and a SHA-256 verified Godot download. It repeats the bounded release gate,
including native safety, headless runtime and installation of the actual archive.
The build job is capped at fifteen minutes; it does not run the deferred soak or
full authoring/renderer matrix.
The real archive install runs before native safety and runtime tests, so a
packaging failure is reported without first repeating engine acceptance. This
ordering does not omit any suite or relax its deadline.
The hosted gate starts directly with Node, matching the isolated suite entry
points. Consumer installs do not inherit parent project npm lifecycle metadata;
explicit registry, cache and proxy settings remain available. Windows process
checks prefer an already-installed absolute PowerShell 7 executable, falling
back to system Windows PowerShell without relaxing identity checks or deadlines.
The locked consumer archive check uses `--offline` against the cache primed by
the required source `npm ci`, still verifies integrity and runs normal lifecycle
handling. A cache miss fails; it does not silently use source node_modules,
retry installation or certify cold-cache/network installation. Phase names and
elapsed times survive an outer timeout, without recording environment values.
The safety suite also keeps bounded per-file progress. Its explicit queue uses
the public Node test-runner API to start expensive validation files first;
every file, process isolation, two-worker concurrency and the original deadlines
remain required. A completed case is not a completed suite or proof of cleanup.

For a packaging-only failure, manually dispatch `ci.yml` with `package=true`
and `engine=false` to repeat the real archive install check without native
engine acceptance. Normal push/PR CI does not run that optional check. It retains
the same bounded install and consumer lifecycle checks, with npm diagnostic output
included only in bounded failure diagnostics. This diagnostic run cannot replace
the complete source-bound release gate.

A separate job receives only the generated artifacts, not a source checkout.
It checks local hashes and the accepted receipt, resolves the remote tag to the
accepted commit, then creates a draft. All uploads, remote hash checks and the
final publish use the numeric release ID returned by that create request, not
a scan of the release list. It uploads four assets, then checks the
GitHub-reported upload state, size and SHA-256 of every asset before publishing:

- `wheel-mcp-VERSION.tgz`: prebuilt runtime in npm archive format.
- `sbom.json`: CycloneDX dependency inventory.
- `acceptance.json`: exact source, versions, suite results and package hashes.
- `SHA256SUMS`: checksums for the archive, SBOM and acceptance receipt.

Only the publication job has repository write permission. No job publishes npm
packages or changes repository visibility. Build artifacts and bounded failure
diagnostics expire after seven days; published release assets remain available.
Failure artifacts include their attempt number. Successful build artifact names
are exported by the producing build, and the publisher downloads that exact
name even when only its job is rerun. Do not select a failure artifact by a
shared name across attempts. Bounded failure details are included; cache-hit
noise is removed from npm errors without removing the underlying failure.

## Install and verify the download

Download the four assets from the same release and compare their hashes against
`SHA256SUMS` before installation. On Windows, for example:

```powershell
Get-FileHash .\wheel-mcp-0.2.8.tgz -Algorithm SHA256
npm.cmd install --ignore-scripts .\wheel-mcp-0.2.8.tgz
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
The publisher uses fixed HTTPS API hosts, rejects redirects and bounds every
request to fifteen seconds. It does not retry creation, uploads or publication:
a lost response may have committed the operation, so inspect the exact draft ID
before any manual recovery. Existing versions are never overwritten. Unit tests
exercise the actual workflow body with synthetic HTTP/files, not a live publish.

The v0.2.5 run passed its second hosted build (190 tests) but failed the old
draft-list lookup guard. Its release was subsequently independently verified
and published manually; the red workflow remains historical failure evidence.
That guard combined several conditions, and the failed run did not retain the
list response, so its exact failing condition cannot now be proven. The new
ID-bound flow removes list visibility/lookup ambiguity without weakening the
receipt or asset checks. v0.2.8 completed both modes and automatic publication
with independent download verification; never move v0.2.5 to install this fix.

Approvals in automated acceptance are explicit test doubles. Hosted tests are
headless; the local screenshot pixel checks do not certify hosted GPU behavior.
Other platforms/clients, public HTTP, high-load/long-session behavior and complete
authoring remain outside the local stable profile. Full production qualification
remains `NOT_QUALIFIED`; see [release scope](LOCAL-STABLE-RELEASE.md).
