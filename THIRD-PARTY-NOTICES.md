# Third party notices and distribution scope

Wheel-mcp application code is licensed under the root MIT license. This does
not relicense third-party code, media, trademarks or dependencies.

## Runtime npm package

The npm `files` allowlist includes the prebuilt Wheel-mcp runtime, Godot bridge
and editor plugin, explicit setup helpers, and these notices. It excludes the
website, videos, vendor source bundles, examples, tests and local evidence.
Installed dependencies retain their own licenses and notices in their packages:

- `@modelcontextprotocol/sdk`: MIT, Model Context Protocol TypeScript SDK.
- `smol-toml`: MIT, TOML parsing and serialization.
- `yaml`: ISC, YAML parsing and serialization.
- `zod`: MIT, schema validation.
- `fast-uri`: BSD-3-Clause; `ip-address` and `proxy-addr`: MIT. Patched
  compatible versions are pinned directly so consumer packages do not depend
  on development-only overrides to receive these dependency fixes.

Transitive dependencies have their own terms; consult their included license
files and the lockfile/SBOM for the exact dependency versions. This list is not
a blanket MIT declaration for every transitive dependency.

## Godot demo test slice

`vendor/godot-demo-slice/` retains the upstream Godot Engine contributors'
MIT notice and fixed provenance. It contains one script slice, not a complete
game or a license grant for unrelated Godot demo assets. Its license is at
`vendor/godot-demo-slice/LICENSE.md`; it is not shipped in the runtime npm package.

## Website and original UI sources

The existing website contains ThreeUI Predictive Arc source, adapted Sylva
navigation, a supplied showcase video and client brand icons. On October 14,
2026, maintainer EVEDensity stated that these materials were created/cleared by
the maintainer and authorized their public distribution. This is the
maintainer's declaration, not an independent verification of upstream terms.
The declared authority includes the retained website files; they are still
excluded from the runtime npm package.

Original ThreeUI source references and the Godot notice remain intact. Root
MIT does not override third-party ownership or upstream conditions. Do not
describe the registered ThreeUI source bundle as newly authored Wheel-mcp code.
Client logos identify compatibility targets; they do not imply endorsement or
official affiliation. Contact the maintainer for the asset-specific permissions.
