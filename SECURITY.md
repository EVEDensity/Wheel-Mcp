# Security Policy

## Supported versions

Security fixes are applied to the latest published version. The `0.1.0-preview.*` line is for evaluation and is not a production security commitment.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Contact the maintainers privately through the repository security advisory mechanism, including reproduction steps, affected versions, impact, and a minimal proof of concept. Please allow time for triage and coordinated disclosure.

## Deployment requirements

- Keep Streamable HTTP bound to loopback unless remote binding is explicitly required.
- Configure explicit Host and Origin allowlists and a strong bearer-token set.
- Store token files with restrictive filesystem permissions and rotate tokens using `MCP_HTTP_AUTH_TOKENS_FILE`.
- Keep each client's project and evidence roots isolated.
- Treat audit logs and evidence as sensitive operational data.
- Run `npm run audit:dependencies`, `npm run sbom`, and the full release gate before publication.
