# Contributing

## Development

Use Node.js 20 or newer and install from the lockfile:

```powershell
npm ci
npm run check
npm run security:check
```

Changes to HTTP transport, authentication, process control, evidence paths, or runtime bridges require focused tests and documentation updates. Do not commit `node_modules`, `build`, `dist`, `.harness`, credentials, or `runs` evidence.

## Pull requests

Explain the behavioral change, security impact, test commands, and any platform-specific limitations. New dependencies require a justification, lockfile update, vulnerability review, and SBOM review.
