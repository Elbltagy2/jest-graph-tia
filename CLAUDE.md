# CLAUDE.md — jest-graph-tia

## What this project is
A Test Impact Analysis (TIA) orchestrator for Jest. On a PR, it selects the minimal safe set of tests by taking the **union** of:
- Jest's own static-import-based selection (`--findRelatedTests --listTests`)
- Semantic impact derived from a Graphify knowledge graph (`graphify-out/graph.json`)

## The one invariant that must never break
**Graphify only adds tests. It never removes a test that Jest's static analysis selected.**
`jestRelatedTests ⊆ finalSelection` — always. There is a property test enforcing this; if you change selection logic, that test must still pass.

## Why the union (not intersection, not graph-only)
- Jest's static graph is battle-tested but blind to: dynamic imports, DI/runtime wiring, non-JS files (SQL, JSON fixtures, configs), monorepo symbol-level edges, semantic coupling (feature flags, event names).
- Graphify sees those, but its INFERRED/AMBIGUOUS edges can be wrong. A wrong extra edge = one wasted test run (cheap). A wrongly pruned test = shipped bug (fatal for trust).
- Therefore: union for v1. Pruning is a v2 experiment gated on escape-rate data.

## Architecture (do not deviate without asking)
```
packages/
  core/         # pure logic: diff → graph traversal → union → explain
  cli/          # jest-graph-tia run|explain ; shells out to git, graphify, jest
fixtures/       # deterministic mini-repo + hand-written graph.json for tests
benchmarks/     # measure-delta harness + RESULTS.md (public!)
examples/       # CI YAML stubs only
docs/SPEC.md    # detailed behavior spec — source of truth
```
- `core` never spawns processes and never imports jest. It takes file lists and a parsed graph, returns file lists + explanations.
- `cli` owns all process spawning (git, graphify, jest) and exit-code propagation.
- Graphify and Jest are invoked as external CLIs / artifacts. We never vendor or fork their code.

## Graph traversal rules
graph.json nodes include code entities and file references; edges carry a confidence tag: `EXTRACTED` (AST fact), `INFERRED` (model-derived), `AMBIGUOUS`.
Reverse-BFS from changed files toward test files with per-tier hop budgets (defaults, overridable in config):
- EXTRACTED: maxHops 6
- INFERRED: maxHops 2
- AMBIGUOUS: maxHops 1 (off by default via config `ambiguous: false`)
A path's tier is its weakest edge. Stop expanding a path when its tier budget is exhausted.
Test-file detection: Jest's testMatch patterns from the target repo's jest config; fall back to `**/*.{test,spec}.{js,jsx,ts,tsx}`.

## Fallback-to-full-suite triggers (config: `fallback.triggers`)
Run the entire suite (and say why on stdout) when any of:
- package-lock.json / yarn.lock / pnpm-lock.yaml changed
- jest.config.* or babel/tsconfig changed
- graph.json missing, unparsable, or older than `fallback.maxGraphAgeCommits` behind merge-base
- any changed file resolves to zero nodes in the graph
- `.env*` or CI workflow files changed

## Commands
- `jest-graph-tia run --changed-since <ref>` — select + execute via jest, propagate exit code
- `--dry-run` — print selection, run nothing
- `--explain` — per test: source (jest|graphify|both), edge path, hops, weakest tier
- `--fallback-full` — force full suite
- `benchmarks/measure-delta.mjs --repo <path> --commits <n>` — the go/no-go experiment

## Engineering conventions
- TypeScript strict, ESM, Node >= 20, npm workspaces
- Tests with Jest (dogfooding); fixtures are deterministic — no snapshot of live repos
- No runtime network or LLM calls; graph.json is read pre-built
- Conventional commits; keep PR-sized changes small
- `--explain` output is a first-class feature (it's how users learn to trust selection) — never let it rot

## Current phase
Phase 0: run the benchmark harness on a real repo and write benchmarks/RESULTS.md. Do not build product code until the delta result is reviewed by the maintainer.
