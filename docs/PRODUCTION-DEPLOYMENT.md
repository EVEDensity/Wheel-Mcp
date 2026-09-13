# Production Deployment Review (Windows-only)

This document is a practical deployment guide for the first Windows-only public release. It is written for a personal project and does not require enterprise certification, approval signatures, or an on-call organization.
It describes the controls that must be in place when Streamable HTTP is exposed
outside the local machine. The repository provides the MCP server, policy checks,
rate/concurrency limits, request cancellation, graceful shutdown, and structured
audit events; it does **not** provision a TLS gateway, secret manager, SIEM, or
on-call service.

## Release scope

The first public release is intentionally limited to:

- Windows 10/11 or Windows Server supported by the deployment owner.
- A validated Godot 4.7.2 runtime (`Godot_v4.7.2-stable_win64_console.exe`).
- Node.js `>=20.19.0`.
- MCP stdio and MCP Streamable HTTP. WebSocket is not an MCP standard transport
  in this release.

Linux and macOS have CI build/test coverage, but no real Godot runtime evidence
is part of this release gate. They are therefore not supported release targets.

## Required deployment topology

The safe default is local-only HTTP:

```text
MCP client -> 127.0.0.1:3000/mcp -> Node MCP server -> Godot process/runtime bridge
```

For a remote client, use a separately managed TLS reverse proxy or load
balancer:

```text
MCP client == TLS ==> Caddy/nginx/Envoy/LB == private network ==> Node MCP server
```

The Node server itself is an HTTP server and is not a TLS terminator. Do not
publish its plain HTTP listener directly to the Internet. A remote bind must be
an explicit operational decision and must set `MCP_HTTP_ALLOW_REMOTE=true`,
with exact `MCP_HTTP_ALLOWED_HOSTS` and `MCP_HTTP_ALLOWED_ORIGINS` values.

### Network review checklist

- [ ] Bind to `127.0.0.1` unless a documented remote deployment requires another
      address.
- [ ] Firewall the Node listener so only the trusted reverse proxy can reach it.
- [ ] Do not use wildcard Host or Origin allowlists in production.
- [ ] Configure the proxy to preserve the intended `Host` and `Origin` values.
- [ ] Trust `X-Forwarded-For` only from explicitly trusted proxy addresses;
      otherwise use the direct peer address for rate limiting and audit data.
- [ ] Apply proxy request-header/body size limits and reject unexpected methods.
- [ ] Set proxy connect, read, idle, and upstream request timeouts. Keep the
      upstream timeout no shorter than the intended MCP operation timeout.
- [ ] Confirm the proxy does not buffer or rewrite Streamable HTTP event streams.
- [ ] Document the private route from proxy to Node and restrict it with host
      firewall rules or mTLS where appropriate.

## TLS review

TLS is mandatory for any deployment reachable by another machine. Terminate TLS
at Caddy, nginx, Envoy, or a managed load balancer using the organization's
approved certificate authority.

Minimum review requirements:

- [ ] TLS 1.2 or newer is enabled; TLS 1.3 is preferred.
- [ ] Weak protocols, anonymous suites, and obsolete ciphers are disabled.
- [ ] The certificate SAN covers the exact public hostname used by clients.
- [ ] The private key is readable only by the proxy service account and its
      secret-management mechanism.
- [ ] Certificate renewal is automatic and tested before the first expiry.
- [ ] Alerts fire before expiry (recommended: 30, 14, and 7 days).
- [ ] HSTS is enabled only after HTTPS is known to be continuously available.
- [ ] TLS access logs do not contain bearer tokens or request bodies.
- [ ] If the proxy-to-Node hop leaves the host, it is protected by a private
      network and, where required by policy, TLS/mTLS as well.
- [ ] A rollback certificate and documented emergency renewal procedure exist.

The application Origin check is still required behind TLS. TLS authenticates
the transport; it does not replace Host/Origin validation or MCP bearer
authentication.

## Token and key management

The built-in HTTP authentication accepts a non-empty bearer token and binds it
to a client policy. For rotation, set `MCP_HTTP_AUTH_TOKENS_FILE` to a JSON
array and optionally set `MCP_HTTP_TOKEN_RELOAD_INTERVAL_MS`. Each entry has a
`token`, `clientId`, `scopes`, `projectRoots`, and `evidenceRoots`, with optional
`expiresAt`.

Production requirements:

- [ ] Prefer a managed secret store (Azure Key Vault, AWS Secrets Manager, GCP
      Secret Manager, or HashiCorp Vault) and inject the current token file via
      a protected deployment mechanism.
- [ ] Never commit tokens to Git, put them in URLs, or expose them in error
      responses, crash dumps, telemetry, or shell history.
- [ ] On Windows, grant the token file read access only to the service account
      and administrators; deny ordinary users and inherited broad ACLs.
- [ ] Use high-entropy, independently generated tokens. Do not use examples or
      human-memorable passwords.
- [ ] Give each client a distinct token and `clientId`; do not share one token
      across tenants or automation jobs.
- [ ] Grant the smallest required scopes (`read`, `run`, `write`, `admin`).
- [ ] Keep project and evidence roots separate per client and verify that the
      configured roots are absolute, intended directories.
- [ ] Store the token file on an encrypted volume where required by policy.
- [ ] Alert on token-file reload failures and investigate before changing the
      last-known-good configuration.

### Rotation runbook

1. Generate a new token in the secret manager.
2. Add it as a new client entry or as an overlap entry while the old token is
   still valid.
3. Reload the file and verify a test request with the new token.
4. Update every client and confirm successful authenticated requests.
5. Remove the old token or set a short, explicit `expiresAt`.
6. Verify the old token receives `401` after the overlap window.
7. Record the change request, operator, timestamps, and verification result in
   the audit system.

## Audit logging and retention

`MCP_HTTP_AUDIT_LOG` enables JSONL audit output. Events include a timestamp,
request ID, client ID when known, method/path, MCP session ID when known, RPC or
tool name when known, status, duration, outcome, remote address, and a reason
when available. Authorization headers, request bodies, and tool parameters are
intentionally excluded.

The application audit logger is an evidence source, not a complete compliance
logging service. In particular, the current implementation does not provide a
built-in SIEM exporter, tamper-proof storage, retention policy, or alert
manager. The external deployment must provide those controls.

- [ ] Write logs to a dedicated directory with service-account-only write
      access and restricted operator read access.
- [ ] Rotate by size/time, compress where allowed, and enforce a disk quota.
- [ ] Forward records to the approved SIEM or centralized logging platform over
      an authenticated channel.
- [ ] Define retention (recommended starting point: 90 days hot/searchable,
      longer only if legal/compliance requires it).
- [ ] Protect archived logs from modification and record export failures.
- [ ] Synchronize Windows time with an approved NTP source; retain UTC ISO-8601
      timestamps.
- [ ] Redact project paths, evidence paths, and personal data in downstream
      enrichment unless required for incident response.
- [ ] Use `requestId` to correlate proxy, application, Godot, and alert records.
- [ ] Alert when the audit destination is unavailable, disk space is low, or
      log rotation fails. The service currently continues after an append error,
      so the external monitor must detect this condition.

## Rate, concurrency, cancellation, and shutdown controls

The server supports IP/client rate limits, global/per-client in-flight limits,
request cancellation, and bounded graceful shutdown. Review and set values for
the actual workload rather than relying on defaults:

- `MCP_HTTP_RATE_LIMIT_WINDOW_MS`
- `MCP_HTTP_RATE_LIMIT_MAX_REQUESTS`
- `MCP_HTTP_RATE_LIMIT_MAX_REQUESTS_PER_CLIENT`
- `MCP_HTTP_MAX_CONCURRENT_REQUESTS`
- `MCP_HTTP_MAX_CONCURRENT_REQUESTS_PER_CLIENT`
- `MCP_HTTP_REQUEST_TIMEOUT_MS`
- `MCP_HTTP_SHUTDOWN_TIMEOUT_MS`

- [ ] Load-test the limits with expected clients and Godot process cost.
- [ ] Alert on sustained `429` responses or repeated concurrency rejections.
- [ ] Confirm cancelled requests terminate or bound the underlying Godot work;
      tools that ignore `AbortSignal` remain limited by operation timeout.
- [ ] Exercise SIGINT/SIGTERM in the Windows service wrapper and verify active
      sessions close within the shutdown budget.
- [ ] Detect orphaned Godot processes and reclaim them according to the runbook.

## Alerting and operational ownership

If this project is exposed beyond localhost, map these conditions to a monitor and a notification method,
and a response target. Suggested initial alerts:

| Condition               | Suggested trigger                                | First response                                          |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| Authentication failures | 401/403 spike or repeated failures by one source | Check client, token rotation, and source allowlist      |
| Host/Origin rejection   | Any unexpected production occurrence             | Inspect proxy headers and possible rebinding/probing    |
| Rate/concurrency limits | Sustained 429/limit events                       | Identify overload or abuse; do not blindly raise limits |
| Tool timeout/cancel     | Error ratio or latency above SLO                 | Inspect Godot health and scenario complexity            |
| Godot crash/orphan      | Any unplanned process exit/orphan                | Preserve evidence, reclaim process, investigate project |
| Evidence write failure  | Any manifest/screenshot failure                  | Check ACLs, path roots, disk, and quota                 |
| Token reload failure    | Any reload error                                 | Keep last-known-good set; repair secret delivery        |
| Audit write failure     | Any sink/append failure                          | Restore logging before remote exposure continues        |
| Shutdown timeout        | Any forced close                                 | Inspect hung requests and process cleanup               |
| Disk pressure           | <20% warning, <10% critical                      | Rotate/archive evidence and logs                        |
| TLS expiry              | 30/14/7-day warnings                             | Renew and verify client trust                           |
| Unexpected remote bind  | Any non-loopback bind without change record      | Disable exposure and review configuration               |

For a personal deployment, these alerting items are recommendations rather than
release blockers. Configure only the monitoring and notifications that are useful
for your own environment.

## Practical release decision

For personal/local Windows use, no external sign-off is required. The project is
ready when the local build, tests, real Godot matrix, and `release:check` pass.
If HTTP is exposed to another machine, configure TLS, protect the bearer token,
and retain enough audit information to diagnose failures. Enterprise identity,
SIEM, formal on-call ownership, and managed secret services are optional future
enhancements rather than release blockers.
