# MCP Compatibility and GitHub Ecosystem Gap

## Baseline

This project uses the MCP TypeScript SDK 1.x and implements the standard stdio and
Streamable HTTP transports. MCP defines stdio and Streamable HTTP as standard
transports; the project's WebSocket option, if enabled, remains explicitly custom.

## Comparison

| Area                    | Current project                                                                                                                       | Official SDK / ecosystem                                                                                       | Gap and action                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Protocol and transports | JSON-RPC MCP tools over stdio and Streamable HTTP                                                                                     | Official SDK provides server/client libraries and transport integrations                                       | Keep SDK pinned and schedule compatibility tests for each spec/SDK release                     |
| Stateful runtime        | Persistent Godot bridge, events, scenarios, screenshots, evidence                                                                     | Official SDK is protocol infrastructure, not a Godot lifecycle/runtime harness                                 | This is the project's differentiator                                                           |
| HTTP security           | Host/Origin checks, bearer tokens, rotation overlap, client isolation, path roots, rate/concurrency limits, cancellation and shutdown | SDK provides transport/auth building blocks; deployment TLS and enterprise identity remain deployment concerns | Add OAuth 2.1/IdP integration and managed secret-provider adapters before broad enterprise use |
| Observability           | Structured JSONL audit events and evidence                                                                                            | Mature ecosystem projects commonly add deployment-specific logging/metrics                                     | Add OpenTelemetry/Prometheus export and centralized immutable log integration                  |
| Capabilities            | Tool-focused server; runtime events via notifications                                                                                 | MCP ecosystem also supports resources and prompts                                                              | Add resources/prompts only where they have a stable Godot use case                             |
| Interoperability        | E2E verified with the official TypeScript client                                                                                      | Official projects have broader client/community coverage                                                       | Add at least one additional mainstream client and compatibility fixtures                       |
| Platform evidence       | Real Godot 4.7.2 evidence on Windows: 19/19 PASS                                                                                      | Official repositories target general runtimes and have broader CI/community                                    | Linux/macOS Godot runtime evidence is not yet available                                        |
| Operations              | Deployment checklist for TLS, keys, audit, alerting                                                                                   | Public ecosystem projects benefit from larger community and operational playbooks                              | Obtain external sign-off, publish runbooks, and define support/SLA boundaries                  |

## Production interpretation

The current repository is not a replacement for the official MCP SDK or the
official MCP server collection. Those projects provide protocol primitives,
examples, and a broader ecosystem; this project provides a specialized Godot
runtime control plane. The correct positioning is a Godot-specific MCP server
built on the official SDK, not a claim of feature parity with the entire MCP
community.

The Windows-only release can be called a stable production candidate after the
external deployment review is signed. It should not be presented as a fully
managed, multi-platform enterprise MCP service until TLS termination, secret
management, centralized audit retention, alerting/on-call, and broader runtime
validation are completed in the deployment environment.

## References

- MCP transport specification: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- Official TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Official MCP servers collection: https://github.com/modelcontextprotocol/servers
- Supergateway (community transport gateway): https://github.com/supercorp-ai/supergateway
