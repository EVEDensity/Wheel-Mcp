# HTTP MCP Security Threat Model

## Scope and trust boundaries

The Node MCP server is a privileged local adapter. A Streamable HTTP client is untrusted until bearer authentication, Host/Origin validation, and client policy checks succeed. Godot processes, project files, evidence directories, token files, and audit sinks are local resources behind the server boundary.

## Assets

- Bearer tokens and client identity
- Project source and runtime control
- Evidence, screenshots, logs, and process metadata
- Runtime bridge sessions and event streams
- Availability of the MCP server and Godot processes

## Threats and controls

| Threat                               | Control                                                                              | Residual risk                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Unauthorized tool execution          | Bearer authentication, timing-safe comparison, expiry, scopes, client ownership      | Token theft remains possible if host filesystem or environment is compromised |
| DNS rebinding / browser-origin abuse | Loopback default, explicit Host and Origin allowlists, SDK rebinding protection      | Misconfigured remote allowlists                                               |
| Client cross-session access          | Session identity is bound to `clientId`; project/evidence roots are policy checked   | In-memory session state is lost on restart                                    |
| Token leakage in logs                | Audit records exclude Authorization, request bodies, and tool parameters             | Operator may log request data elsewhere                                       |
| Brute force / resource exhaustion    | IP and client rate limits, global and per-client concurrency limits, request timeout | Distributed attacks need a reverse proxy/WAF                                  |
| Stale credentials                    | Atomic-style last-known-good reload behavior and expiry checks                       | Rotation file permissions are deployment responsibility                       |
| In-flight cancellation abuse         | Request abort propagation, tool signal merge, bounded graceful shutdown              | Tools that ignore AbortSignal can consume resources until timeout             |
| Evidence path traversal              | Canonical path containment against per-client roots                                  | Symlink policy must be enforced by deployment/filesystem hardening            |
| Supply-chain compromise              | Lockfile, `npm audit --audit-level=high`, CycloneDX SBOM, CI gate                    | Upstream compromise or zero-day vulnerabilities                               |

## Release assumptions

Remote deployment requires TLS and an external identity/secret-management layer. The built-in bearer token mechanism is appropriate for controlled local or trusted-network use, not as a replacement for an enterprise gateway. Review this model whenever transports, tools, dependencies, or deployment topology changes.

## References

- [MCP Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [npm audit](https://docs.npmjs.com/cli/v10/commands/npm-audit)
- [npm sbom](https://docs.npmjs.com/cli/v10/commands/npm-sbom)
- [CycloneDX](https://cyclonedx.org/)
