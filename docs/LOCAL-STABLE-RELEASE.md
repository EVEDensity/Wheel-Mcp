# Windows local stable release

Each GitHub Release includes an `acceptance.json` for its exact source and artifacts.
The historical [v0.2.0 receipt](releases/0.2.0-windows-local-final.json)
does not qualify later versions. The earlier
[source synchronization snapshot](releases/0.2.0-source-push.json) timed out and
remains historical, not a replacement for fresh checks.

The `0.2.x` series uses a limited local release profile, not the unfinished full
production roadmap. On October 15, 2026, the maintainer requested the shortest
useful release path and removed long-running acceptance from the release scope.
The release is acceptable only when `npm run release:gate` and the independent
receipt check `npm run release:check` both pass for the current source.

## Supported scope

Windows with Godot 4.7.2, Node >=20.19.0 and trusted local projects using MCP
stdio. The gate records the exact installed Node and Godot versions. Other Node
versions meeting the minimum are not individually certified. Codex is the local
client target; the real MCP SDK verifies protocol and runtime behavior. Approval
acceptance in automated tests is a test double, not human desktop UX evidence.

Project discovery, bounded responses, authorized execution, headless launch,
owned-process stop, exact approved file/scene edits and safe save/recovery form
the checked core. Game/renderer-specific screenshot behavior and advanced UI,
physics, animation, shader and import authoring remain experimental, retaining
their existing contracts and safety checks.

Godot executes code with the user's OS permissions; only open trusted projects.
Keep explicit project/evidence roots and host confirmation. Preauthorization is
opt-in, host-configured and hash-bound. HTTP remains loopback-only and is not a
stable network deployment target. Neither background execution nor path checks
make Godot a sandbox.

## Short required acceptance

The local gate builds once, checks formatting/lint and core contracts, exercises
native permissions/undo/save/validation and transaction crash recovery, runs a
headless runtime smoke, and installs the actual tarball in an isolated consumer.
It also audits dependencies, produces an SBOM and binds evidence to current
source, release documentation and the tarball hash. Package installation uses
the controlled lock graph and local cache, not a separate clean Windows machine.

Every test suite must finish with zero failures, skips, cancellations and todos,
and clean its owned scratch directory. A missing engine, failed audit, changed
source, modified artifact or incomplete summary fails the gate. Total execution
is bounded to ten minutes; it never pushes, creates tags, publishes npm packages
or changes GitHub CI settings. Successful runs keep only compact summaries,
tarball and SBOM; failed runs retain bounded diagnostics and owned failure data.

Revision 2 separates build, format, lint and core test budgets instead of putting
a 90-second test inside a 120-second npm parent with its setup work. Child suite
deadlines fit inside parent budgets. Every suite must carry the current run
identity and meet minimum coverage counts; stale summaries cannot qualify new
code. This revises operator budgets, not product request deadlines, permissions,
integrity or rollback requirements.

## Removed release blockers

Long soak/1,000 mixed cycles, 4,096-record stress performance, full rendering and
authoring matrices, independent-machine certification and additional client
certification are deferred, not PASS. The previous mixed-load ledger timeout
remains a known high-load performance limitation; no ledger capacity, replay,
corruption or storage-failure safeguard is removed. A short native ledger smoke
checks real replay and failed storage with 32 completed records and actual
pending byte-quota reservations, not the deferred 4,096-record stress workload.

T31–T35 and G4–G6 continue to describe future full production qualification.
Their original evidence remains intact and production stays `NOT_QUALIFIED`.
They no longer block this explicitly narrower local release. Eight-hour or
high-load stability, public HTTP, macOS/Linux and complete engine/client support
must not be claimed from a passing local gate.

## Commands

```powershell
npm.cmd run release:gate -- --plan
npm.cmd run release:gate
npm.cmd run release:check
```

The receipt is `runs/local-release/latest.json`; the distributable and SBOM are
alongside it. For future full production work, use `npm run release:gate:full`
and `npm run release:check:production`. The maintainer authorized public GitHub
distribution and restoring short push/PR CI on October 15, 2026. Optional engine
smoke remains optional in daily CI; long qualification is not an automatic CI job.
The separate [GitHub release workflow](GITHUB-RELEASE.md) runs the bounded gate
on a fresh hosted Windows runner, verifies the actual uploaded assets in a draft,
then publishes. It is separate from npm publishing and does not certify all
Windows machines, graphics drivers or interactive clients.
