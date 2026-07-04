# CLAUDE.md — jest-graph-tia

## What this project is
A Test Impact Analysis (TIA) orchestrator for Jest. On a PR, it selects the minimal safe set of tests via **file expansion**:
1. `git diff` → changed files
2. Graphify knowledge graph (`graphify-out/graph.json`) expands changed files → related files (reverse-BFS, per-tier hop budgets)
3. `jest --findRelatedTests <expanded files> --listTests` maps files → tests
4. Run those tests, propagate Jest's exit code

Jest owns ALL test discovery. The graph only widens Jest's input file set.

## The one invariant that must never break
**Expansion only adds files. `changed ⊆ expanded` — always.** Since Jest's relatedness is monotonic in its input set, `findRelatedTests(changed) ⊆ findRelatedTests(expanded)` follows. A property test enforces superset-ness of `expandFiles`; if you change expansion logic, that test must still pass.

## Why expansion (not graph-selects-tests, not pruning)
- Jest's static graph is battle-tested but blind to: dynamic imports, DI/runtime wiring, non-JS files (SQL, JSON fixtures, configs), monorepo symbol-level edges, semantic coupling.
- Graphify sees those, but its INFERRED/AMBIGUOUS edges can be wrong. A wrong extra file = a few wasted test runs (cheap). A wrongly pruned test = shipped bug (fatal for trust).
- Letting Jest do the file→test mapping keeps test discovery in one battle-tested place; the graph never touches test selection directly.
- Pruning is a future experiment gated on escape-rate data.

## Architecture (do not deviate without asking)
```
packages/
  core/         # pure logic: graph parse → expansion → explain. No process spawning, no jest import.
  cli/          # jest-graph-tia run ; shells out to git, graphify, jest; owns exit codes
fixtures/       # deterministic mini Jest repo + graph.json for tests
benchmarks/     # measure-delta harness + RESULTS.md (post-MVP)
examples/       # CI YAML stubs only
docs/SPEC.md    # detailed behavior spec — source of truth
```
- Graphify and Jest are invoked as external CLIs / artifacts. We never vendor or fork their code.

## graph.json facts (verified against graphify 0.8.39 — see SPEC §3)
- networkx node-link JSON; edges under `links`, not `edges`.
- Edge direction: `source depends on target`. Dependents-of-X = incoming edges.
- Node→file via `source_file` (repo-relative). All parsing lives in `core/src/graphSchema.ts` only.
- Tiers on edges: `confidence: EXTRACTED | INFERRED | AMBIGUOUS`. Budgets: 6 / 2 / 0 (ambiguous off by default). `contains` edges are hop-free.

## Fallback-to-full-suite triggers (config: `fallback`)
Run the entire suite (and say why on stdout) when any of:
- package-lock.json / yarn.lock / pnpm-lock.yaml changed
- jest.config.* / babel / tsconfig changed
- graph.json missing, unparsable, or older than `fallback.maxGraphAgeCommits` behind merge-base
- any changed file resolves to zero nodes in the graph
- `.env*` or CI workflow files changed

## Commands
- `jest-graph-tia run --changed-since <ref>` — expand + select + execute via jest, propagate exit code
- `--dry-run` — print selection, run nothing
- `--explain` — per test: source (jest|graphify), via-file, edge path, hops, weakest tier
- `--fallback-full` — force full suite
- `--config <path>` — config file (default jest-graph-tia.config.json)

## Engineering conventions
- TypeScript strict, ESM, Node >= 20, npm workspaces
- Tests with Jest (dogfooding); fixtures deterministic — no snapshots of live repos
- No runtime network or LLM calls; graph.json is read pre-built
- Conventional commits, plain messages, no AI attribution; keep changes small
- `--explain` output is a first-class feature — never let it rot

## Current phase
MVP build (Phase 0 benchmark deferred by maintainer decision, 2026-07-04). Target: `run --changed-since main --dry-run --explain` works on the fixture repo; `run` executes the same set and propagates Jest's exit code.
