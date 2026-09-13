# Benchmarks

There are two different evaluations; do not combine their success rates.

## Capability smoke benchmark

`npm run benchmark` runs the existing capability/workflow evaluation. This is
useful for API and runtime coverage, but is not evidence of arbitrary defect
repair or model-token savings.

## Controlled upstream game repair benchmark

`npm run benchmark:repair` runs an official MCP SDK client against the stdio
server, persistent runtime bridge, and real windowed Godot. Seven pinned
upstream demo projects each receive one controlled defect. The benchmark checks
healthy, broken, approved repair, independent rerun, and ineffective repair
cases, then compares a scripted fine-grained MCP repair workflow.

Prerequisites:

1. Install dependencies and an available Windows Godot renderer.
2. Set `GODOT_PATH` to the console executable.
3. Check out `godotengine/godot-demo-projects` at
   `a3b5c113112f77291d5f3d1360f33a882fdc52f7` in
   `.harness/benchmark-sources/godot-demo-projects`, or set `GODOT_DEMO_SOURCE`.
4. Run `npm run benchmark:repair`. The runner checks the source revision,
   preserves MIT licensing, copies projects, imports resources, and writes a
   new timestamped directory under `runs/repair-benchmark/`.

`REPAIR_BENCHMARK_OUTPUT` can select a separate output directory. Preserve each
run rather than overwriting evidence. `runs/repair-benchmark/latest.json`
points to the latest raw report. Large projects and evidence are local ignored
artifacts, not files included in the npm package or Git checkout.

The committed summary is `benchmarks/repair-results-2026-09-13.json`; the
methodology and exact project paths are in `docs/REPAIR-BENCHMARK-2026-09-13.md`.
`docs/DEV-LOOP.md` documents the tool schema and recovery behavior.

The current evaluation uses known inverse patches and one seeded defect per
category. It is not a held-out bug corpus, an autonomous patch-generation test,
a population false-positive estimate, or a billable-token measurement.
