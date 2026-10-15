# Security Policy

## Supported versions

Security fixes target the latest published release, currently v0.2.0. Its stable
profile is Windows, Godot 4.7.2 and trusted local projects over stdio. The
`0.1.0-preview.*` line is evaluation-only. Public HTTP, Linux/macOS and long/high-load
qualification are outside this release's support scope. See the
[local release scope](docs/LOCAL-STABLE-RELEASE.md).

## Reporting a vulnerability

Do not open a public issue containing exploit details or secrets. If the
repository's Security tab offers **Report a vulnerability**, use that private
channel with affected versions, impact and a minimal reproduction. If it is
unavailable, open a minimal issue requesting a private reporting channel without
publishing the vulnerability details. Do not paste credentials or private project
content. Please allow time for triage and coordinated disclosure.

## Deployment requirements

- Prefer stdio for local use. Non-loopback Streamable HTTP binding is currently disabled; do not bypass it to expose a public endpoint.
- Configure explicit Host and Origin allowlists and a strong bearer-token set.
- Store token files with restrictive filesystem permissions and rotate tokens using `MCP_HTTP_AUTH_TOKENS_FILE`.
- Keep each client's project and evidence roots isolated.
- Treat audit logs and evidence as sensitive operational data.
- Use only trusted projects. Godot executes project code with OS permissions; headless operation is not a sandbox.
- Use the release's `npm run release:gate` and `npm run release:check` for local release acceptance. A short CI pass is not a release gate.
- [`docs/PRODUCTION-DEPLOYMENT.md`](docs/PRODUCTION-DEPLOYMENT.md) describes future deployment concerns, not a certified public hosting path.
- The repository does not itself provision TLS, a managed secret store, a SIEM, or an alert manager. These are optional deployment concerns, not prerequisites for personal/local use.
